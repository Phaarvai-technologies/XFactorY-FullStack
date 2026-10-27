"""Visionary AI assistant: "Your Idea" help (step 2) and the AI Guide (between Project stage and
Manufacturing requirements).

- The model (Gemini or Anthropic, VISIONARY_AI_PROVIDER) is called from the backend only: the API
  key never reaches the browser.
- Context is built here from the signed-in Visionary's OWN saved project (ownership by user id),
  merged with the validated, still-unsaved form values the screen sends.
- The model answers through a forced tool call, so the conversational reply and the proposed
  field values arrive separately and are validated against the app's own fields and options
  before anything is shown. Nothing is applied to a field here: the screens apply a suggestion
  only after the user confirms it, through the existing save endpoints.
- History lives in the existing agent tables (agent_definitions / agent_runs / agent_messages /
  ai_usage_events): one conversation per project and screen. No schema change.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Literal
from uuid import UUID

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.identity.context import ActorContext
from app.visionary.repository import VisionaryRepository
from app.visionary.schemas import MACHINE_CATALOG, Timeline

log = logging.getLogger("xy.visionary.ai")

Panel = Literal["idea", "guide"]
AGENT_CODE, AGENT_VERSION = "visionary_guide", "1"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
HISTORY_TURNS = 16
UNAVAILABLE = "The AI assistant is not available right now. You can continue without it."

# Same machine list as the Manufacturing requirements step (StepNeeds MACHINES).
ALLOWED_MACHINES = {m.lower(): m for m in (*MACHINE_CATALOG, "Surface Grinding")}
TEXT_LIMITS = {"project": 160, "idea": 500, "product": 160, "industry": 120, "additional_requirements": 500}
# Which existing fields each screen may propose values for.
PANEL_FIELDS = {"idea": ("project", "idea", "product", "industry"),
                "guide": ("machines", "additional_requirements")}
TIMELINE_LABELS = {"immediately": "Immediately", "within_1_month": "Within 1 month",
                   "1_3_months": "1–3 months", "3_6_months": "3–6 months"}


# ---------------------------------------------------------------------------------------- input
class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class AiForm(_Model):
    """Unsaved values on the screen (None = not sent; the saved value is used)."""
    project: str | None = Field(default=None, max_length=160)
    idea: str | None = Field(default=None, max_length=500)
    product: str | None = Field(default=None, max_length=160)
    industry: str | None = Field(default=None, max_length=120)
    manufacturing_location: str | None = Field(default=None, max_length=120)
    machines: list[str] | None = Field(default=None, max_length=30)
    quantity: int | None = Field(default=None, ge=0, le=1_000_000_000)
    budget: int | None = Field(default=None, ge=0, le=1_000_000_000_000)
    timeline: Timeline | None = None
    additional_requirements: str | None = Field(default=None, max_length=500)


class AiMessageIn(_Model):
    message: str = Field(default="", max_length=1000)
    # start: opening guidance; explore: "Help me find an idea"; refine: improve what is entered.
    mode: Literal["chat", "start", "explore", "refine"] = "chat"
    form: AiForm = AiForm()
    request_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    # "Add Project" (Your idea opened blank for another project): the current project's saved
    # values are not used, and the conversation belongs to the project about to be created.
    new_project: bool = False


class AiAcceptedIn(_Model):
    message_id: UUID
    suggestion_id: str = Field(min_length=1, max_length=8)
    fields: list[str] = Field(default_factory=list, max_length=10)
    new_project: bool = False


class AiUnavailable(Exception):
    def __init__(self, message: str, busy: bool = False):
        super().__init__(message)
        self.busy = busy  # provider overloaded / rate limited (temporary): another model may answer


# Temporary provider states worth retrying: rate limit, overload, gateway errors.
RETRY_STATUSES = {429, 500, 502, 503, 504}
RETRY_DELAYS = (1.0, 3.0)  # seconds before the 2nd and 3rd attempt


# ---------------------------------------------------------------------------------------- prompt
STAGE_FOCUS = {
    "Idea Stage": "clarify the concept, the target users, the 2-4 must-have features, a cheap way to "
                  "validate demand, and simple first prototype options.",
    "Design Stage": "which drawings, dimensions and material specifications a manufacturer needs, gaps "
                    "in the design, and design-for-manufacturing (DFM) questions to ask.",
    "Prototype Stage": "what to test on the prototype, improvements before production, production-"
                       "readiness checks, and planning a pilot batch.",
    "Ready for Manufacturing": "production specifications, quantity, quality expectations, questions "
                               "to ask in a quotation, and how to choose between manufacturers.",
}

SYSTEM = """You are the X!Y AI Guide inside the XFactorY onboarding for "Visionaries": people who want
a product manufactured. Many have no manufacturing experience. Always answer by calling the
`respond` tool.

Rules:
- Use only the CONTEXT you are given. It lists what the user entered (facts), user-approved
  suggestions, and fields that are unknown. Never invent missing values, never assume a project
  stage that is not given, and say what you are assuming.
- Be concise and practical: short paragraphs or "- " bullet lines, plain text only (no HTML, no
  markdown headings, no tables).
- Ask at most two questions at a time, and never ask for something already in the CONTEXT.
- Advice must fit THIS product and industry. Do not reuse advice for unrelated products.
- Mark any cost, price, timeline or quantity figure as an estimate. Never present certifications,
  compliance requirements, manufacturer capacity or availability as verified.
- Never name, invent or recommend specific manufacturers, prices, capacities or matching results:
  matching against real manufacturers happens later in the app ("Find a Manufacturer").
- `chips`: up to 3 short follow-up questions the user may click.
- `suggestions`: concrete proposals the user can accept. Only put values in `fields` for the
  fields allowed on this screen (listed in the CONTEXT). Keep the user's own idea: refine it, do
  not replace it with an unrelated one.
- If CONTEXT.changed_since_last_reply is not empty, say briefly which earlier advice that affects
  and put that in `refresh_note`.
"""

IDEA_SCREEN = """SCREEN: "Your idea" (step 2). Allowed suggestion fields: project (name, max 160
chars), idea (description: who it is for and what need it meets, max 500 chars), product (what to
manufacture, a few words, max 160), industry (sector, max 120).
- If the user has a clear idea: refine the description, intended users, problem solved, key
  features and what will need manufacturing. Offer at most one improved version as a suggestion.
- If the idea is partial: use what is entered, suggest practical directions and ask focused
  questions.
- If the user has no idea yet (mode "explore"): ask about interests, target users or problems,
  preferred industry, available resources and approximate budget, one or two questions at a time.
  Once you know enough, offer exactly three product ideas as suggestions. For each, fill
  target_users, problem, why_it_fits (tie it to their answers), materials_or_processes,
  first_step and assumptions, plus the fields (project, idea, product, industry)."""

GUIDE_SCREEN = """SCREEN: "Your AI guide" (after the project stage, before manufacturing requirements).
Allowed suggestion fields: machines (only from ALLOWED_MACHINES, exact names) and
additional_requirements (max 500 chars, e.g. materials, finishes, quality checks, packaging).
Focus for the stage: {focus}
Opening reply (mode "start"): in 2-3 sentences say what you understand about the project, give
3-4 practical next steps for this stage, then ask the single most useful unanswered question.
Offer requirement suggestions only when they follow from the facts."""

RESPOND_TOOL = {
    "name": "respond",
    "description": "Answer the user. Put proposed field values only inside suggestions[].fields.",
    "input_schema": {
        "type": "object",
        "properties": {
            "reply": {"type": "string", "description": "The answer, plain text."},
            "chips": {"type": "array", "items": {"type": "string"}, "maxItems": 3},
            "suggestions": {
                "type": "array", "maxItems": 3,
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"}, "summary": {"type": "string"},
                        "target_users": {"type": "string"}, "problem": {"type": "string"},
                        "why_it_fits": {"type": "string"}, "materials_or_processes": {"type": "string"},
                        "first_step": {"type": "string"}, "assumptions": {"type": "string"},
                        "fields": {
                            "type": "object",
                            "properties": {
                                "project": {"type": "string"}, "idea": {"type": "string"},
                                "product": {"type": "string"}, "industry": {"type": "string"},
                                "machines": {"type": "array", "items": {"type": "string"}},
                                "additional_requirements": {"type": "string"},
                            },
                        },
                    },
                    "required": ["title"],
                },
            },
            "refresh_note": {"type": "string"},
        },
        "required": ["reply"],
    },
}


DEFAULT_MODELS = {"gemini": "gemini-3.5-flash-lite", "anthropic": "claude-sonnet-4-5"}


def ai_provider(settings: Settings) -> str | None:
    """The provider to use, or None when the assistant is off (no key for it)."""
    keys = {"gemini": settings.gemini_api_key, "anthropic": settings.anthropic_api_key}
    choice = settings.visionary_ai_provider
    if choice in keys:
        return choice if keys[choice] else None
    return next((p for p in ("gemini", "anthropic") if keys[p]), None)


def ai_model(settings: Settings, provider: str) -> str:
    return settings.visionary_ai_model or DEFAULT_MODELS[provider]


def _gemini_schema(schema):
    """The respond tool's JSON schema in the subset Gemini function declarations accept
    (no maxItems: the backend caps the lists itself in validate_answer)."""
    if isinstance(schema, dict):
        return {k: _gemini_schema(v) for k, v in schema.items() if k != "maxItems"}
    if isinstance(schema, list):
        return [_gemini_schema(v) for v in schema]
    return schema


async def _post(settings: Settings, url: str, headers: dict, body: dict) -> dict:
    """POST with short retries for temporary provider states ("high demand" 503, 429, ...).
    A timeout is not retried (it already used the whole time budget)."""
    response = None
    async with httpx.AsyncClient(timeout=settings.visionary_ai_timeout_seconds) as client:
        for attempt in range(len(RETRY_DELAYS) + 1):
            if attempt:
                retry_after = response.headers.get("retry-after", "") if response is not None else ""
                delay = float(retry_after) if retry_after.isdigit() else RETRY_DELAYS[attempt - 1]
                await asyncio.sleep(min(delay, 5.0))
            try:
                response = await client.post(url, headers={**headers, "content-type": "application/json"}, json=body)
            except httpx.TimeoutException as exc:
                # not retried on the same model (it already used the time budget), but an overloaded
                # model often just stops answering: the fallback model may still answer
                raise AiUnavailable(f"network: {exc.__class__.__name__}", busy=True) from exc
            except httpx.HTTPError as exc:
                if attempt == len(RETRY_DELAYS):
                    raise AiUnavailable(f"network: {exc.__class__.__name__}", busy=True) from exc
                response = None
                continue
            if response.status_code not in RETRY_STATUSES:
                break
            log.warning("AI provider busy (%s), attempt %s", response.status_code, attempt + 1)
    if response.status_code != 200:
        log.warning("AI provider answered %s: %s", response.status_code, response.text[:300])
        raise AiUnavailable(f"provider {response.status_code}", busy=response.status_code in RETRY_STATUSES)
    try:
        return response.json()
    except ValueError as exc:
        raise AiUnavailable("provider answer is not JSON") from exc


async def _call_anthropic(settings: Settings, model: str, system: str, messages: list[dict]) -> tuple[dict, dict]:
    data = await _post(settings, ANTHROPIC_URL,
                       {"x-api-key": settings.anthropic_api_key, "anthropic-version": "2023-06-01"},
                       {"model": model, "max_tokens": 1500, "system": system, "messages": messages,
                        "tools": [RESPOND_TOOL], "tool_choice": {"type": "tool", "name": "respond"}})
    tool = next((b.get("input") for b in data.get("content") or []
                 if b.get("type") == "tool_use" and b.get("name") == "respond"), None)
    usage = data.get("usage") or {}
    return tool, {"input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens"),
                  "cache_read_input_tokens": usage.get("cache_read_input_tokens")}


def _gemini_generation(model: str) -> dict:
    """Gemini 3+ (e.g. gemini-3.8-flash): Google advises the default temperature (lower values can
    loop), and reasoning tokens count toward maxOutputTokens, so the limit leaves room for them and
    reasoning is kept "low" (short structured answers). Older models keep the earlier settings."""
    version = re.match(r"gemini-(\d+)", model)
    if version and int(version.group(1)) >= 3:
        return {"maxOutputTokens": 8192, "thinkingConfig": {"thinkingLevel": "low"}}
    return {"maxOutputTokens": 2048, "temperature": 0.4}


async def _call_gemini(settings: Settings, model: str, system: str, messages: list[dict]) -> tuple[dict, dict]:
    """Gemini generateContent with the `respond` function forced (mode ANY, only that function)."""
    contents = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                for m in messages]
    data = await _post(settings, GEMINI_URL.format(model=model), {"x-goog-api-key": settings.gemini_api_key}, {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": contents,
        "tools": [{"functionDeclarations": [{"name": "respond", "description": RESPOND_TOOL["description"],
                                             "parameters": _gemini_schema(RESPOND_TOOL["input_schema"])}]}],
        "toolConfig": {"functionCallingConfig": {"mode": "ANY", "allowedFunctionNames": ["respond"]}},
        "generationConfig": _gemini_generation(model),
    })
    parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
    tool = next((p["functionCall"].get("args") for p in parts
                 if isinstance(p.get("functionCall"), dict) and p["functionCall"].get("name") == "respond"), None)
    if tool is None:
        reason = (data.get("candidates") or [{}])[0].get("finishReason") or (data.get("promptFeedback") or {}).get("blockReason")
        log.warning("Gemini gave no structured answer (%s)", reason)
    usage = data.get("usageMetadata") or {}
    return tool, {"input_tokens": usage.get("promptTokenCount"), "output_tokens": usage.get("candidatesTokenCount"),
                  "cache_read_input_tokens": usage.get("cachedContentTokenCount")}


async def call_model(settings: Settings, system: str, messages: list[dict]) -> tuple[dict, dict]:
    """One model call with the `respond` tool / function forced. Returns (tool input, usage with
    provider, model and latency). Raises AiUnavailable on any failure (no key, network, provider
    error, unusable answer)."""
    provider = ai_provider(settings)
    if provider is None:
        raise AiUnavailable("not configured")
    model = ai_model(settings, provider)
    started = time.monotonic()
    call = _call_gemini if provider == "gemini" else _call_anthropic
    try:
        tool, usage = await call(settings, model, system, messages)
    except AiUnavailable as exc:
        # still overloaded after the retries: the optional fallback model (VISIONARY_AI_FALLBACK_MODEL)
        fallback = (settings.visionary_ai_fallback_model or "").strip()
        if not (exc.busy and fallback and fallback != model):
            raise
        log.warning("AI model %s busy; using fallback %s", model, fallback)
        model = fallback
        tool, usage = await call(settings, model, system, messages)
    if not isinstance(tool, dict):
        raise AiUnavailable("no structured answer")
    usage.update(provider=provider, model=model, latency_ms=int((time.monotonic() - started) * 1000))
    return tool, usage


# ---------------------------------------------------------------------------------------- validation
def _text(value, limit: int) -> str:
    """Plain text, trimmed; control characters removed; cut at a word boundary."""
    if not isinstance(value, str):
        return ""
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value).strip()
    if len(value) <= limit:
        return value
    cut = value[:limit].rsplit(" ", 1)[0]
    return (cut or value[:limit]).rstrip() + "…"


def validate_answer(raw: dict, panel: str) -> dict:
    """The model's tool input -> what the screen may show. Proposed values are kept only for the
    fields this screen allows, within the fields' own limits and options."""
    suggestions = []
    for item in (raw.get("suggestions") or [])[:3]:
        if not isinstance(item, dict) or not _text(item.get("title"), 120):
            continue
        fields: dict = {}
        proposed = item.get("fields") if isinstance(item.get("fields"), dict) else {}
        for key in PANEL_FIELDS[panel]:
            value = proposed.get(key)
            if key == "machines":
                names = [ALLOWED_MACHINES.get(str(m).strip().lower()) for m in value] if isinstance(value, list) else []
                names = list(dict.fromkeys(n for n in names if n))
                if names:
                    fields["machines"] = names[:30]
            elif isinstance(value, str) and value.strip() and len(value.strip()) <= TEXT_LIMITS[key]:
                fields[key] = value.strip()      # too long for the field: not offered (never cut)
        suggestions.append({
            "id": f"s{len(suggestions) + 1}",
            "title": _text(item.get("title"), 120),
            "summary": _text(item.get("summary"), 400),
            **{k: _text(item.get(k), 300) for k in ("target_users", "problem", "why_it_fits",
                                                      "materials_or_processes", "first_step", "assumptions")},
            "fields": fields,
        })
    chips = [_text(c, 80) for c in (raw.get("chips") or [])[:3] if _text(c, 80)]
    return {"text": _text(raw.get("reply"), 2500) or "Sorry, I could not put together an answer. Please try again.",
            "chips": chips, "suggestions": suggestions, "refreshNote": _text(raw.get("refresh_note"), 300)}


# ---------------------------------------------------------------------------------------- service
class VisionaryAi:
    def __init__(self, session: AsyncSession, settings: Settings):
        self.db = session
        self.settings = settings
        self.repo = VisionaryRepository(session)

    # ------------------------------------------------------------ context
    async def _context(self, user_id: UUID, panel: str, form: AiForm | None,
                       new_project: bool = False) -> tuple[dict, dict, dict | None]:
        """(context for the model, flat snapshot of the facts, project row). Saved values of the
        CURRENT project (the newest, as the flow uses) merged with the screen's unsaved values; only
        what helps guidance (no name, email, phone or intro). new_project: no saved project values."""
        profile = await self.repo.profile(user_id) or {}
        project = None if new_project else await self.repo.project(user_id)
        form = form or AiForm()
        saved = project or {}

        def pick(form_value, saved_value):
            value = form_value if form_value is not None else saved_value
            return value.strip() if isinstance(value, str) else value

        facts = {
            "role": profile.get("role_title"), "organization": profile.get("organization_name"),
            "based_in": profile.get("location"),
            "project_name": pick(form.project, saved.get("project_name")),
            "idea_description": pick(form.idea, saved.get("idea_description")),
            "product_to_manufacture": pick(form.product, saved.get("product")),
            "industry": pick(form.industry, saved.get("industry")),
            "project_stage": saved.get("project_stage") or None,
            "manufacturing_location": pick(form.manufacturing_location, saved.get("manufacturing_location")),
            "required_machines": pick(form.machines, list(saved.get("required_machines") or [])) or None,
            "quantity_units": pick(form.quantity, saved.get("quantity")) or None,
            "budget_inr": pick(form.budget, int(saved["budget_amount"]) if saved.get("budget_amount") else None) or None,
            "timeline": TIMELINE_LABELS.get(pick(form.timeline, saved.get("timeline")) or "") or None,
            "additional_requirements": pick(form.additional_requirements, saved.get("additional_requirements")),
        }
        snapshot = {k: v for k, v in facts.items() if v not in (None, "", [])}
        context = {
            "screen": panel,
            "facts_entered_by_user": snapshot,
            "unknown": [k for k, v in facts.items() if v in (None, "", [])],
            "allowed_suggestion_fields": list(PANEL_FIELDS[panel]),
        }
        if panel == "guide":
            context["ALLOWED_MACHINES"] = sorted(ALLOWED_MACHINES.values())
        return context, snapshot, project

    # ------------------------------------------------------------ runs / messages
    async def _agent_definition(self) -> UUID:
        await self.db.execute(text("""
            INSERT INTO agent_definitions(code, name, purpose, version, allowed_tools, default_tier)
            VALUES (:c, 'Visionary AI Guide', 'Idea help and stage guidance for Visionaries', :v, '{}', 'default')
            ON CONFLICT (code, version) DO NOTHING
        """), {"c": AGENT_CODE, "v": AGENT_VERSION})
        return await self.db.scalar(text("SELECT id FROM agent_definitions WHERE code=:c AND version=:v"),
                                    {"c": AGENT_CODE, "v": AGENT_VERSION})

    @staticmethod
    def _refs(user_id: UUID, panel: str, project: dict | None) -> tuple[str | None, str]:
        """(project-scoped ref, pre-project ref). Before a project exists (no name typed yet) the
        idea conversation belongs to the user's next project; it moves to the project once created."""
        pre = f"visionary_user:{user_id}:new_project:{panel}"
        return (f"visionary_project:{project['id']}:{panel}" if project else None), pre

    async def _run(self, user_id: UUID, panel: str, project: dict | None, create: bool) -> UUID | None:
        ref, pre = self._refs(user_id, panel, project)
        if ref is None and panel == "guide":
            raise HTTPException(409, "Tell us about your idea first.")
        await self.db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
                              {"k": f"xy-ai:{user_id}:{panel}"})
        if ref:
            run = await self.db.scalar(text("""SELECT id FROM agent_runs WHERE user_id=:u AND result_ref=:r
                                                ORDER BY started_at LIMIT 1"""), {"u": user_id, "r": ref})
            if run:
                return run
            # adopt the conversation started before THIS project existed (never an older project:
            # a conversation from an abandoned "Add Project" stays with the next new project)
            adopted = await self.db.scalar(text("""UPDATE agent_runs SET result_ref=:r
                                                    WHERE user_id=:u AND result_ref=:p AND started_at <= :created
                                                    RETURNING id"""),
                                           {"u": user_id, "r": ref, "p": pre, "created": project["created_at"]})
            if adopted:
                return adopted
        else:
            run = await self.db.scalar(text("SELECT id FROM agent_runs WHERE user_id=:u AND result_ref=:p"),
                                       {"u": user_id, "p": pre})
            if run or not create:
                return run
        if not create:
            return None
        return await self.db.scalar(text("""
            INSERT INTO agent_runs(user_id, organization_id, agent_definition_id, status, model_tier, result_ref)
            VALUES (:u, :o, :d, 'running', 'default', :r) RETURNING id
        """), {"u": user_id, "o": await self.repo.organization_id(user_id),
               "d": await self._agent_definition(), "r": ref or pre})

    async def _messages(self, run_id: UUID | None) -> list[dict]:
        if run_id is None:
            return []
        rows = (await self.db.execute(text("""
            SELECT id, role, content_ref, created_at FROM agent_messages WHERE agent_run_id=:r
            ORDER BY created_at, id
        """), {"r": run_id})).mappings().all()
        out = []
        for row in rows:
            try:
                body = json.loads(row["content_ref"] or "{}")
            except json.JSONDecodeError:
                body = {}
            out.append({"id": str(row["id"]), "role": row["role"], "body": body, "created_at": row["created_at"]})
        return out

    async def _add(self, run_id: UUID, role: str, body: dict) -> UUID:
        return await self.db.scalar(text("""
            INSERT INTO agent_messages(agent_run_id, role, content_classification, content_ref, created_at)
            VALUES (:r, :role, 'restricted', :c, clock_timestamp()) RETURNING id
        """), {"r": run_id, "role": role, "c": json.dumps(body, ensure_ascii=False)})

    @staticmethod
    def _view(messages: list[dict]) -> list[dict]:
        """What the screen shows: user and assistant turns; accepted suggestions marked."""
        accepted: dict[str, set] = {}
        for m in messages:
            if m["role"] == "tool" and m["body"].get("accepted"):
                a = m["body"]["accepted"]
                accepted.setdefault(a.get("message_id"), set()).add(a.get("suggestion_id"))
        view = []
        for m in messages:
            b = m["body"]
            if m["role"] == "user":
                view.append({"id": m["id"], "role": "user", "text": b.get("text", ""), "mode": b.get("mode", "chat"),
                             "createdAt": m["created_at"].isoformat()})
            elif m["role"] == "assistant":
                view.append({"id": m["id"], "role": "assistant", "text": b.get("text", ""),
                             "chips": b.get("chips", []), "suggestions": b.get("suggestions", []),
                             "refreshNote": b.get("refreshNote", ""),
                             "accepted": sorted(accepted.get(m["id"], set())),
                             "createdAt": m["created_at"].isoformat()})
        return view

    @staticmethod
    def _changed(messages: list[dict], snapshot: dict) -> list[str]:
        last = next((m["body"].get("context") for m in reversed(messages)
                     if m["role"] == "assistant" and isinstance(m["body"].get("context"), dict)), None)
        if last is None:
            return []
        return sorted(k for k in set(last) | set(snapshot) if last.get(k) != snapshot.get(k))

    # ------------------------------------------------------------ API
    async def history(self, actor: ActorContext, panel: str, new_project: bool = False) -> dict:
        context, snapshot, project = await self._context(actor.user_id, panel, None, new_project and panel == "idea")
        if panel == "guide" and project is None:
            raise HTTPException(409, "Tell us about your idea first.")
        run = await self._run(actor.user_id, panel, project, create=False)
        messages = await self._messages(run)
        await self.db.commit()
        return {"configured": ai_provider(self.settings) is not None, "messages": self._view(messages),
                "contextChanged": self._changed(messages, snapshot)}

    async def send(self, actor: ActorContext, panel: str, body: AiMessageIn) -> dict:
        if body.mode == "chat" and not body.message:
            raise HTTPException(422, "Type a message first.")
        if ai_provider(self.settings) is None:
            raise HTTPException(503, UNAVAILABLE)
        context, snapshot, project = await self._context(actor.user_id, panel, body.form,
                                                          body.new_project and panel == "idea")
        run = await self._run(actor.user_id, panel, project, create=True)
        messages = await self._messages(run)

        # The same request sent twice (double click, network retry): the first answer, no new call.
        for i, m in enumerate(messages):
            if m["role"] == "user" and m["body"].get("request_id") == body.request_id:
                answer = next((x for x in messages[i + 1:] if x["role"] == "assistant"), None)
                await self.db.commit()
                return {"messages": self._view([m] + ([answer] if answer else []))}

        # user-approved suggestions for this project (from earlier acceptances)
        approved = [m["body"]["accepted"] for m in messages if m["role"] == "tool" and m["body"].get("accepted")]
        context["user_approved_suggestions"] = [{"title": a.get("title"), "fields": a.get("fields")} for a in approved]
        context["changed_since_last_reply"] = self._changed(messages, snapshot)
        context["mode"] = body.mode

        history: list[dict] = []
        for m in messages[-HISTORY_TURNS:]:
            if m["role"] == "user":
                content = m["body"].get("text") or f"({m['body'].get('mode', 'chat')} request)"
            elif m["role"] == "assistant":
                titles = [s.get("title") for s in m["body"].get("suggestions", [])]
                content = m["body"].get("text", "") + (f"\n[Suggestions offered: {'; '.join(titles)}]" if titles else "")
            else:
                continue
            role = "user" if m["role"] == "user" else "assistant"
            if history and history[-1]["role"] == role:
                history[-1]["content"] += "\n" + content
            else:
                history.append({"role": role, "content": content})
        if history and history[0]["role"] != "user":
            history.insert(0, {"role": "user", "content": "(earlier conversation)"})
        request_text = body.message or {"start": "Please give me your opening guidance.",
                                        "explore": "I don't have an idea yet. Help me find one.",
                                        "refine": "Please help me refine what I have entered."}.get(body.mode, "")
        turn = f"CONTEXT:\n{json.dumps(context, ensure_ascii=False, default=str)}\n\nUSER ({body.mode}): {request_text}"
        if history and history[-1]["role"] == "user":
            history[-1]["content"] += "\n\n" + turn
        else:
            history.append({"role": "user", "content": turn})

        stage = snapshot.get("project_stage")
        system = SYSTEM + "\n" + (IDEA_SCREEN if panel == "idea" else GUIDE_SCREEN.format(
            focus=STAGE_FOCUS.get(stage, "the stage is not known yet: ask which stage the project is in "
                                          "(Idea, Design, Prototype or Ready for Manufacturing).")))
        await self.db.commit()  # no transaction or lock held during the provider call
        try:
            raw, usage = await call_model(self.settings, system, history)
        except AiUnavailable as exc:
            log.warning("Visionary AI unavailable: %s", exc)
            raise HTTPException(502, UNAVAILABLE) from exc
        answer = validate_answer(raw, panel)

        # Store the turn (re-checked under the lock: a parallel duplicate may have finished first).
        run = await self._run(actor.user_id, panel, project, create=True)
        dup = await self.db.scalar(text("""
            SELECT id FROM agent_messages WHERE agent_run_id=:r AND role='user'
              AND (content_ref::jsonb)->>'request_id' = :q LIMIT 1
        """), {"r": run, "q": body.request_id})
        if dup:
            messages = await self._messages(run)
            await self.db.commit()
            i = next(i for i, m in enumerate(messages) if m["id"] == str(dup))
            answer_msg = next((x for x in messages[i + 1:] if x["role"] == "assistant"), None)
            return {"messages": self._view([messages[i]] + ([answer_msg] if answer_msg else []))}
        user_id = await self._add(run, "user", {"text": body.message, "mode": body.mode, "request_id": body.request_id})
        reply_id = await self._add(run, "assistant", {**answer, "context": snapshot})
        await self.db.execute(text("""
            INSERT INTO ai_usage_events(agent_run_id, organization_id, provider, model_name, input_tokens,
                                        cached_input_tokens, output_tokens, latency_ms)
            VALUES (:r, :o, :p, :m, :i, :c, :out, :l)
        """), {"r": run, "o": await self.repo.organization_id(actor.user_id),
               "p": usage.get("provider") or "unknown", "m": usage.get("model") or "unknown",
               "i": int(usage.get("input_tokens") or 0), "c": int(usage.get("cache_read_input_tokens") or 0),
               "out": int(usage.get("output_tokens") or 0), "l": usage.get("latency_ms")})
        messages = await self._messages(run)
        await self.db.commit()
        return {"messages": self._view([m for m in messages if m["id"] in (str(user_id), str(reply_id))])}

    async def accepted(self, actor: ActorContext, panel: str, body: AiAcceptedIn) -> dict:
        """Records that the user applied a suggestion (after confirming it on screen). The values
        themselves were saved by the screen through the existing idea / requirements saves."""
        _, _, project = await self._context(actor.user_id, panel, None, body.new_project and panel == "idea")
        run = await self._run(actor.user_id, panel, project, create=False)
        messages = await self._messages(run)
        target = next((m for m in messages if m["id"] == str(body.message_id) and m["role"] == "assistant"), None)
        suggestion = next((s for s in (target or {}).get("body", {}).get("suggestions", [])
                           if s.get("id") == body.suggestion_id), None)
        if suggestion is None:
            raise HTTPException(404, "Suggestion not found")
        fields = [f for f in body.fields if f in suggestion.get("fields", {})]
        await self._add(run, "tool", {"accepted": {"message_id": str(body.message_id), "suggestion_id": body.suggestion_id,
                                                   "title": suggestion.get("title"),
                                                   "fields": {f: suggestion["fields"][f] for f in fields}}})
        await self.db.commit()
        return {"accepted": True}
