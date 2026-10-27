"""Visionary AI assistant (Your idea help + AI Guide) against a real Postgres. The model call is
replaced by a fake (no network), which records exactly what would be sent to the provider."""
import json
import uuid

import pytest

from test_e2e_local import DB, client  # noqa: F401  (shared fixture)
from test_visionary_e2e import IDEA, NEEDS, auth

pytestmark = pytest.mark.skipif(not DB, reason="E2E_DATABASE_URL not set")


class FakeModel:
    def __init__(self):
        self.calls: list[dict] = []
        self.answer: dict = {"reply": "Here is my advice."}
        self.fail = False

    async def __call__(self, settings, system, messages):
        from app.visionary.ai import AiUnavailable
        if self.fail:
            raise AiUnavailable("provider 500")
        self.calls.append({"system": system, "messages": messages})
        return self.answer, {"input_tokens": 100, "output_tokens": 50, "latency_ms": 5}

    def context(self, i=-1) -> dict:
        last = self.calls[i]["messages"][-1]["content"]
        return json.loads(last.split("CONTEXT:\n", 1)[1].split("\n\nUSER", 1)[0])


@pytest.fixture
def model(monkeypatch):
    from app.core.config import get_settings
    from app.visionary import ai
    fake = FakeModel()
    monkeypatch.setattr(ai, "call_model", fake)
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "test-key")
    return fake


def rid():
    return uuid.uuid4().hex


async def send(client, h, panel, **body):  # noqa: F811
    return await client.post(f"/visionary/ai/{panel}/messages", headers=h,
                             json={"request_id": rid(), "mode": "chat", "message": "", **body})


async def test_assistant_off_keeps_manual_onboarding(client, monkeypatch):  # noqa: F811
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")
    v = auth(client, f"vis_{uuid.uuid4().hex[:10]}")
    r = await client.get("/visionary/ai/idea", headers=v)
    assert r.status_code == 200 and r.json() == {"configured": False, "messages": [], "contextChanged": []}
    r = await send(client, v, "idea", mode="explore")
    assert r.status_code == 503 and "continue without it" in r.json()["detail"]
    assert (await client.put("/visionary/project/idea", headers=v, json=IDEA)).status_code == 200  # manual flow


async def test_no_idea_yet_three_suggestions_validated_and_kept_after_the_project_exists(client, model):  # noqa: F811
    v = auth(client, f"vis_{uuid.uuid4().hex[:10]}")
    assert (await client.put("/visionary/profile", headers=v, json={
        "name": "Private Person", "role": "Student", "org": "", "location": "Coimbatore",
        "intro": "my phone is 99999"})).status_code == 200
    # no project, no idea fields: questions first
    model.answer = {"reply": "Which problems or people interest you?", "chips": ["Kitchen", "Farming", "Toys", "x"]}
    r = await send(client, v, "idea", mode="explore", message="Help me find an idea")
    assert r.status_code == 200, r.text
    user, reply = r.json()["messages"]
    assert user["text"] == "Help me find an idea" and reply["chips"] == ["Kitchen", "Farming", "Toys"]
    ctx = model.context()
    assert ctx["facts_entered_by_user"] == {"role": "Student", "based_in": "Coimbatore"}  # no name / intro
    assert "project_name" in ctx["unknown"] and "project_stage" in ctx["unknown"]
    assert "Private Person" not in json.dumps(model.calls) and "99999" not in json.dumps(model.calls)

    # enough context: three ideas; only this screen's fields, within limits, are offered
    ideas = [{"title": f"Idea {i}", "summary": "s", "target_users": "cooks", "problem": "p", "why_it_fits": "w",
              "materials_or_processes": "steel", "first_step": "f", "assumptions": "a",
              "fields": {"project": f"Project {i}", "idea": "An idea", "product": "A product",
                         "industry": "Food & Beverage", "budget": "5 lakh", "machines": ["CNC Machining"]}}
             for i in range(3)]
    ideas[2]["fields"]["project"] = "x" * 161                                   # too long: not offered
    model.answer = {"reply": "Three ideas:", "suggestions": ideas + [{"title": "fourth"}]}
    r = await send(client, v, "idea", mode="chat", message="I like kitchens, budget about 2 lakh")
    reply = r.json()["messages"][1]
    assert [s["id"] for s in reply["suggestions"]] == ["s1", "s2", "s3"]
    assert reply["suggestions"][0]["fields"] == {"project": "Project 0", "idea": "An idea", "product": "A product",
                                                 "industry": "Food & Beverage"}
    assert "project" not in reply["suggestions"][2]["fields"]
    assert reply["suggestions"][0]["target_users"] == "cooks"
    assert [m["role"] for m in model.calls[-1]["messages"]] == ["user", "assistant", "user"]  # history sent

    # the user accepts idea 1 (screen saves the fields through the existing idea save)
    r = await client.post("/visionary/ai/idea/accepted", headers=v, json={
        "message_id": reply["id"], "suggestion_id": "s1", "fields": ["project", "idea", "product", "industry", "budget"]})
    assert r.status_code == 200
    r = await client.put("/visionary/project/idea", headers=v, json={
        "project": "Project 0", "idea": "An idea", "product": "A product", "industry": "Food & Beverage", "complete": False})
    assert r.status_code == 200
    # the conversation now belongs to the new project and is restored (refresh / sign-in)
    hist = (await client.get("/visionary/ai/idea", headers=v)).json()
    assert [m["role"] for m in hist["messages"]] == ["user", "assistant", "user", "assistant"]
    assert hist["messages"][3]["accepted"] == ["s1"]
    await send(client, v, "idea", message="ok")
    assert model.context()["user_approved_suggestions"][0]["fields"] == {
        "project": "Project 0", "idea": "An idea", "product": "A product", "industry": "Food & Beverage"}


async def test_unsaved_form_values_and_changes_reach_the_model(client, model):  # noqa: F811
    v = auth(client, f"vis_{uuid.uuid4().hex[:10]}")
    assert (await client.put("/visionary/project/idea", headers=v, json=IDEA)).status_code == 200
    r = await send(client, v, "idea", mode="refine", form={"idea": "Branded cups for offices, unsaved edit"})
    assert r.status_code == 200
    facts = model.context()["facts_entered_by_user"]
    assert facts["idea_description"] == "Branded cups for offices, unsaved edit"   # current form wins
    assert facts["project_name"] == IDEA["project"] and facts["industry"] == IDEA["industry"]
    assert model.context()["changed_since_last_reply"] == []
    # a saved change after that reply is reported as changed (advice may need refreshing)
    assert (await client.put("/visionary/project/idea", headers=v,
                             json={**IDEA, "product": "Ceramic mugs"})).status_code == 200
    assert (await client.get("/visionary/ai/idea", headers=v)).json()["contextChanged"] == [
        "idea_description", "product_to_manufacture"]
    await send(client, v, "idea", message="what now?")
    assert model.context()["changed_since_last_reply"] == ["idea_description", "product_to_manufacture"]


@pytest.mark.parametrize("stage, focus", [("Idea Stage", "validate demand"), ("Design Stage", "drawings"),
                                          ("Prototype Stage", "pilot batch"),
                                          ("Ready for Manufacturing", "quotation")])
async def test_guide_uses_the_saved_stage(client, model, stage, focus):  # noqa: F811
    v = auth(client, f"vis_{uuid.uuid4().hex[:10]}")
    assert (await client.get("/visionary/ai/guide", headers=v)).status_code == 409   # no project yet
    assert (await client.put("/visionary/project/idea", headers=v, json=IDEA)).status_code == 200
    assert (await client.put("/visionary/project/stage", headers=v, json={"stage": stage})).status_code == 200
    model.answer = {"reply": "Opening", "suggestions": [{"title": "Add machines", "fields": {
        "machines": ["cnc machining", "Laser Welding Pro", "Injection Moulding"], "project": "nope",
        "additional_requirements": "Food-grade PP, matte finish"}}]}
    r = await send(client, v, "guide", mode="start")
    assert r.status_code == 200, r.text
    assert focus in model.calls[-1]["system"]
    assert model.context()["facts_entered_by_user"]["project_stage"] == stage
    s = r.json()["messages"][1]["suggestions"][0]
    assert s["fields"] == {"machines": ["CNC Machining", "Injection Moulding"],
                           "additional_requirements": "Food-grade PP, matte finish"}
    assert r.json()["messages"][0]["mode"] == "start"


async def test_guide_without_a_stage_does_not_assume_one(client, model):  # noqa: F811
    v = auth(client, f"vis_{uuid.uuid4().hex[:10]}")
    assert (await client.put("/visionary/project/idea", headers=v, json=IDEA)).status_code == 200
    await send(client, v, "guide", mode="start")
    assert "stage is not known yet" in model.calls[-1]["system"]
    assert "project_stage" in model.context()["unknown"]


async def test_requirements_entered_later_are_in_the_context(client, model):  # noqa: F811
    v = auth(client, f"vis_{uuid.uuid4().hex[:10]}")
    assert (await client.put("/visionary/project/idea", headers=v, json=IDEA)).status_code == 200
    assert (await client.put("/visionary/project/requirements", headers=v,
                             json={**NEEDS, "machines": ["Injection Moulding"]})).status_code == 200
    await send(client, v, "guide", message="what should I ask in a quote?")
    facts = model.context()["facts_entered_by_user"]
    assert facts["manufacturing_location"] == "Chennai" and facts["quantity_units"] == 1000
    assert facts["budget_inr"] == 200000 and facts["timeline"] == "1–3 months"
    assert facts["required_machines"] == ["Injection Moulding"]


async def test_duplicates_failures_and_other_users(client, model):  # noqa: F811
    v = auth(client, f"vis_{uuid.uuid4().hex[:10]}")
    assert (await client.put("/visionary/project/idea", headers=v, json=IDEA)).status_code == 200
    body = {"request_id": rid(), "mode": "chat", "message": "hello"}
    first = (await client.post("/visionary/ai/guide/messages", headers=v, json=body)).json()
    again = (await client.post("/visionary/ai/guide/messages", headers=v, json=body)).json()
    assert len(model.calls) == 1 and first == again                   # one model call, same stored turn
    assert (await client.post("/visionary/ai/guide/messages", headers=v,
                              json={**body, "request_id": "bad id!"})).status_code == 422
    assert (await client.post("/visionary/ai/guide/messages", headers=v,
                              json={"request_id": rid(), "mode": "chat", "message": ""})).status_code == 422
    # provider failure: error, nothing stored, saved work untouched
    model.fail = True
    r = await send(client, v, "guide", message="will fail")
    assert r.status_code == 502 and "continue without it" in r.json()["detail"]
    assert len((await client.get("/visionary/ai/guide", headers=v)).json()["messages"]) == 2
    assert (await client.get("/visionary/me", headers=v)).json()["idea"] == IDEA
    # another Visionary sees nothing and cannot act on this conversation
    w = auth(client, f"vis_{uuid.uuid4().hex[:10]}")
    assert (await client.put("/visionary/project/idea", headers=w, json=IDEA)).status_code == 200
    assert (await client.get("/visionary/ai/guide", headers=w)).json()["messages"] == []
    r = await client.post("/visionary/ai/guide/accepted", headers=w, json={
        "message_id": first["messages"][1]["id"], "suggestion_id": "s1", "fields": []})
    assert r.status_code == 404
    assert (await client.get("/visionary/ai/guide", headers={"Authorization": ""})).status_code == 401
    assert (await client.get("/visionary/ai/other", headers=v)).status_code == 422


# ---------------------------------------------------------------- providers (Gemini / Anthropic)
class _Settings:
    def __init__(self, **kw):
        self.visionary_ai_provider = kw.get("provider", "auto")
        self.gemini_api_key = kw.get("gemini", "")
        self.anthropic_api_key = kw.get("anthropic", "")
        self.visionary_ai_model = kw.get("model", "")
        self.visionary_ai_timeout_seconds = 5
        self.visionary_ai_fallback_model = ""


def test_provider_choice():
    from app.visionary.ai import ai_model, ai_provider
    assert ai_provider(_Settings()) is None                                        # no key: off
    assert ai_provider(_Settings(gemini="g")) == "gemini"
    assert ai_provider(_Settings(anthropic="a")) == "anthropic"
    assert ai_provider(_Settings(gemini="g", anthropic="a")) == "gemini"          # auto: Gemini first
    assert ai_provider(_Settings(provider="anthropic", gemini="g", anthropic="a")) == "anthropic"
    assert ai_provider(_Settings(provider="anthropic", gemini="g")) is None        # chosen one has no key
    assert ai_model(_Settings(), "gemini") == "gemini-3.5-flash-lite"
    assert ai_model(_Settings(model="gemini-2.5-pro"), "gemini") == "gemini-2.5-pro"


@pytest.fixture
def gemini_server(monkeypatch):
    """A local stand-in speaking the Gemini generateContent format."""
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    from app.visionary import ai
    seen: dict = {}
    replies: list = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):  # noqa: N802
            seen["path"], seen["headers"] = self.path, {k.lower(): v for k, v in self.headers.items()}
            seen["body"] = json.loads(self.rfile.read(int(self.headers["content-length"])))
            status, body = replies.pop(0)
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(body).encode())

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(ai, "GEMINI_URL", f"http://127.0.0.1:{server.server_port}/v1beta/models/{{model}}:generateContent")
    monkeypatch.delenv("HTTPS_PROXY", raising=False)
    monkeypatch.delenv("HTTP_PROXY", raising=False)
    monkeypatch.setenv("NO_PROXY", "127.0.0.1")
    yield seen, replies
    server.shutdown()


async def test_gemini_request_and_answer(gemini_server):
    from app.visionary.ai import AiUnavailable, call_model
    seen, replies = gemini_server
    settings = _Settings(gemini="g-key")
    replies.append((200, {"candidates": [{"content": {"role": "model", "parts": [
        {"text": "thinking out loud"},
        {"functionCall": {"name": "respond", "args": {"reply": "Hi from Gemini", "chips": ["Q1"]}}}]}}],
        "usageMetadata": {"promptTokenCount": 120, "candidatesTokenCount": 30}}))
    tool, usage = await call_model(settings, "SYSTEM RULES", [
        {"role": "user", "content": "first"}, {"role": "assistant", "content": "answer"}, {"role": "user", "content": "next"}])
    assert tool == {"reply": "Hi from Gemini", "chips": ["Q1"]}
    assert (usage["provider"], usage["model"], usage["input_tokens"], usage["output_tokens"]) == (
        "gemini", "gemini-3.5-flash-lite", 120, 30)
    assert seen["path"] == "/v1beta/models/gemini-3.5-flash-lite:generateContent"
    assert seen["headers"]["x-goog-api-key"] == "g-key"                              # key in a header, not the URL
    body = seen["body"]
    assert body["systemInstruction"] == {"parts": [{"text": "SYSTEM RULES"}]}
    assert [c["role"] for c in body["contents"]] == ["user", "model", "user"]
    assert body["toolConfig"] == {"functionCallingConfig": {"mode": "ANY", "allowedFunctionNames": ["respond"]}}
    # Gemini 3: default temperature, room for reasoning tokens, low reasoning
    assert body["generationConfig"] == {"maxOutputTokens": 8192, "thinkingConfig": {"thinkingLevel": "low"}}
    declaration = body["tools"][0]["functionDeclarations"][0]
    assert declaration["name"] == "respond" and "maxItems" not in json.dumps(declaration)

    replies.append((200, {"candidates": [{"finishReason": "SAFETY", "content": {"parts": []}}]}))   # blocked
    with pytest.raises(AiUnavailable, match="no structured answer"):
        await call_model(settings, "S", [{"role": "user", "content": "x"}])
    from app.visionary import ai
    ai.RETRY_DELAYS, delays = (0.0, 0.0), ai.RETRY_DELAYS
    replies.extend([(429, {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED"}})] * 3)          # quota (retried)
    try:
        with pytest.raises(AiUnavailable, match="provider 429"):
            await call_model(settings, "S", [{"role": "user", "content": "x"}])
    finally:
        ai.RETRY_DELAYS = delays


async def test_gemini_end_to_end_through_the_api(client, gemini_server, monkeypatch):  # noqa: F811
    from app.core.config import get_settings
    seen, replies = gemini_server
    monkeypatch.setattr(get_settings(), "gemini_api_key", "g-key")
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "")
    v = auth(client, f"vis_{uuid.uuid4().hex[:10]}")
    assert (await client.put("/visionary/project/idea", headers=v, json=IDEA)).status_code == 200
    assert (await client.get("/visionary/ai/guide", headers=v)).json()["configured"] is True
    replies.append((200, {"candidates": [{"content": {"parts": [{"functionCall": {"name": "respond", "args": {
        "reply": "Opening guidance", "suggestions": [{"title": "Add moulding", "fields": {"machines": ["injection moulding"]}}]}}}]}}],
        "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5}}))
    r = await send(client, v, "guide", mode="start")
    assert r.status_code == 200, r.text
    assert r.json()["messages"][1]["suggestions"][0]["fields"] == {"machines": ["Injection Moulding"]}
    usage = await client.sql("""SELECT provider, model_name, input_tokens FROM ai_usage_events e
                                JOIN agent_runs r ON r.id = e.agent_run_id JOIN users u ON u.id = r.user_id
                                ORDER BY e.created_at DESC LIMIT 1""")
    assert tuple(usage[0]) == ("gemini", "gemini-3.5-flash-lite", 10)


async def test_add_project_does_not_use_or_move_the_current_project(client, model):  # noqa: F811
    """"Add Project": Your idea opens blank for another project. The assistant must not see the
    current project's saved values, and that conversation goes to the new project, not the old one."""
    v = auth(client, f"vis_{uuid.uuid4().hex[:10]}")
    assert (await client.put("/visionary/project/idea", headers=v, json=IDEA)).status_code == 200
    r = await send(client, v, "idea", mode="refine", message="old project chat")
    assert r.status_code == 200
    old_chat = (await client.get("/visionary/ai/idea", headers=v)).json()["messages"]
    assert len(old_chat) == 2

    # blank "Add Project" screen: nothing from the current project, separate conversation
    hist = (await client.get("/visionary/ai/idea?new_project=true", headers=v)).json()
    assert hist["messages"] == []
    r = await send(client, v, "idea", mode="explore", new_project=True, message="Help me find an idea",
                   form={"project": "", "idea": "", "product": "", "industry": ""})
    assert r.status_code == 200, r.text
    facts = model.context()["facts_entered_by_user"]
    assert "project_name" not in facts and "idea_description" not in facts and "industry" not in facts
    assert IDEA["project"] not in json.dumps(model.calls[-1])
    # the current project's conversation is unchanged
    assert (await client.get("/visionary/ai/idea", headers=v)).json()["messages"] == old_chat

    # the new project is created (Save & Next on the blank screen): the new conversation is its own
    r = await client.put("/visionary/project/idea", headers=v, json={
        "project": "Second project", "idea": "Another idea", "product": "Trays",
        "industry": "Food & Beverage", "complete": True, "create_new": True})
    assert r.status_code == 200, r.text
    hist = (await client.get("/visionary/ai/idea", headers=v)).json()
    assert [m["text"] for m in hist["messages"] if m["role"] == "user"] == ["Help me find an idea"]
    await send(client, v, "idea", message="refine it")
    assert model.context()["facts_entered_by_user"]["project_name"] == "Second project"


async def test_an_old_new_project_chat_never_moves_onto_an_older_project(client, model):  # noqa: F811
    v = auth(client, f"vis_{uuid.uuid4().hex[:10]}")
    assert (await client.put("/visionary/project/idea", headers=v, json=IDEA)).status_code == 200
    # abandoned "Add Project" conversation, started after the current project existed
    assert (await send(client, v, "idea", new_project=True, message="maybe later")).status_code == 200
    # the current (older) project does not take it
    assert (await client.get("/visionary/ai/idea", headers=v)).json()["messages"] == []
    # opening Add Project again shows it (it belongs to the next new project)
    hist = (await client.get("/visionary/ai/idea?new_project=true", headers=v)).json()
    assert [m["text"] for m in hist["messages"] if m["role"] == "user"] == ["maybe later"]


def test_older_gemini_models_keep_their_settings():
    from app.visionary.ai import _gemini_generation
    assert _gemini_generation("gemini-2.5-flash") == {"maxOutputTokens": 2048, "temperature": 0.4}
    assert "temperature" not in _gemini_generation("gemini-3.5-flash-lite")


async def test_gemini_busy_is_retried_then_falls_back(gemini_server, monkeypatch):
    """"High demand" 503: retried; still busy -> the fallback model; other errors are not retried."""
    from app.visionary import ai
    monkeypatch.setattr(ai, "RETRY_DELAYS", (0.0, 0.0))
    seen, replies = gemini_server
    ok = (200, {"candidates": [{"content": {"parts": [{"functionCall": {"name": "respond", "args": {"reply": "ok"}}}]}}]})
    busy = (503, {"error": {"code": 503, "message": "This model is currently experiencing high demand."}})
    # busy once, then answered: same model
    replies.extend([busy, ok])
    tool, usage = await ai.call_model(_Settings(gemini="k"), "S", [{"role": "user", "content": "q"}])
    assert tool == {"reply": "ok"} and usage["model"] == "gemini-3.5-flash-lite"
    # busy on every retry -> fallback model answers
    settings = _Settings(gemini="k")
    settings.visionary_ai_fallback_model = "gemini-3.1-flash-lite"
    replies.extend([busy, busy, busy, ok])
    tool, usage = await ai.call_model(settings, "S", [{"role": "user", "content": "q"}])
    assert usage["model"] == "gemini-3.1-flash-lite" and seen["path"].endswith("gemini-3.1-flash-lite:generateContent")
    # no fallback configured: unavailable (the screen keeps the input and offers Try again)
    replies.extend([busy, busy, busy])
    with pytest.raises(ai.AiUnavailable):
        await ai.call_model(_Settings(gemini="k"), "S", [{"role": "user", "content": "q"}])
    # a real error (bad key) is not retried
    replies.extend([(403, {"error": {"code": 403}}), ok])
    with pytest.raises(ai.AiUnavailable):
        await ai.call_model(_Settings(gemini="k"), "S", [{"role": "user", "content": "q"}])
    replies.clear()


async def test_timeout_moves_to_the_fallback_model(monkeypatch):
    from app.visionary import ai
    calls = []

    async def fake(settings, model, system, messages):
        calls.append(model)
        if model == "gemini-3.5-flash-lite":
            raise ai.AiUnavailable("network: ReadTimeout", busy=True)
        return {"reply": "ok"}, {}
    monkeypatch.setattr(ai, "_call_gemini", fake)
    settings = _Settings(gemini="k")
    settings.visionary_ai_fallback_model = "gemini-3.1-flash-lite"
    tool, usage = await ai.call_model(settings, "S", [{"role": "user", "content": "q"}])
    assert calls == ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"] and usage["model"] == "gemini-3.1-flash-lite"
