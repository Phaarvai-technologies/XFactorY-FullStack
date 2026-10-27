"use client";

/**
 * Visionary AI assistant (optional): shared chat logic + pieces used by the AI Guide step and
 * the "Your idea" help panel. Replies come from the backend (POST /visionary/ai/{panel}/messages);
 * they are rendered as plain text (never as HTML). Suggested values are applied to the existing
 * fields only after the user confirms the exact changes shown.
 */
import { useRef, useState } from "react";
import {
  errorMessage,
  useVisionaryApi,
  type AiFields,
  type AiForm,
  type AiMessage,
  type AiPanel,
  type AiSendBody,
  type AiSuggestion,
} from "@/lib/visionary/api";
import { ApiError } from "@/lib/api";

export const AI_FIELD_LABELS: Record<keyof AiFields, string> = {
  project: "Project / Product name",
  idea: "Describe your idea",
  product: "What do you want to manufacture?",
  industry: "Industry / Sector",
  machines: "Machine",
  additional_requirements: "Additional requirements",
};

const FAILED = "The AI assistant didn't answer. Your input is kept: please try again.";

function newRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().replace(/-/g, "");
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Conversation state for one screen ("idea" or "guide"). newProject: Your idea opened by
 * "Add Project" (a blank screen for the next project, not the current one). */
export function useAiChat(panel: AiPanel, newProject = false) {
  const api = useVisionaryApi();
  const [state, setState] = useState<"loading" | "ready" | "off" | "error">("loading");
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [changed, setChanged] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const failed = useRef<AiSendBody | null>(null);
  const busy = useRef(false);

  /** Saved conversation for this project (restores it after refresh / back / sign-in). */
  async function load(): Promise<{ configured: boolean; count: number }> {
    try {
      const history = await api.aiHistory(panel, newProject);
      setMessages(history.messages);
      setChanged(history.contextChanged ?? []);
      setState(history.configured ? "ready" : "off");
      return { configured: history.configured, count: history.messages.length };
    } catch (caught) {
      setState("error");
      setError(errorMessage(caught, "The AI assistant could not be loaded. You can continue without it."));
      return { configured: false, count: 0 };
    }
  }

  async function run(body: AiSendBody): Promise<boolean> {
    if (busy.current) return false; // one request at a time (no duplicate submissions)
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const reply = await api.aiSend(panel, body);
      setMessages((current) => [
        ...current,
        ...reply.messages.filter((m) => !current.some((c) => c.id === m.id)),
      ]);
      failed.current = null;
      setChanged([]);
      setState("ready");
      return true;
    } catch (caught) {
      failed.current = body; // "Try again" re-sends the same request (same id: answered once)
      if (caught instanceof ApiError && caught.status === 503) setState("off");
      // 502 / 503 carry the backend's own wording ("not available right now ... continue without it").
      const unavailable = caught instanceof ApiError && (caught.status === 502 || caught.status === 503) && caught.message;
      setError(unavailable ? `${caught.message} Your input is kept.` : errorMessage(caught, FAILED));
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return {
    state,
    messages,
    changed,
    pending,
    error,
    load,
    canRetry: () => failed.current !== null,
    send: (message: string, mode: AiSendBody["mode"], form?: AiForm) =>
      run({ message, mode, form, request_id: newRequestId(), ...(newProject ? { new_project: true } : {}) }),
    retry: () => (failed.current ? run(failed.current) : Promise.resolve(false)),
    /** Records an applied suggestion (best effort: the values themselves are already saved). */
    markAccepted: (messageId: string, suggestion: AiSuggestion, fields: string[]) => {
      setMessages((current) =>
        current.map((m) =>
          m.id === messageId ? { ...m, accepted: [...(m.accepted ?? []), suggestion.id] } : m,
        ),
      );
      void api
        .aiAccepted(panel, {
          message_id: messageId,
          suggestion_id: suggestion.id,
          fields,
          ...(newProject ? { new_project: true } : {}),
        })
        .catch(() => undefined);
    },
  };
}

export type AiChat = ReturnType<typeof useAiChat>;

/** Model text as plain text: lines starting with "- " / "• " become a list, others paragraphs. */
export function AiText({ text }: { text: string }) {
  const blocks: ({ list: string[] } | { para: string })[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const item = /^([-•*]|\d+[.)])\s+/.exec(line);
    if (item) {
      const last = blocks[blocks.length - 1];
      const content = line.slice(item[0].length);
      if (last && "list" in last) last.list.push(content);
      else blocks.push({ list: [content] });
    } else {
      blocks.push({ para: line });
    }
  }
  return (
    <>
      {blocks.map((block, i) =>
        "list" in block ? (
          <ul key={i}>
            {block.list.map((li, j) => (
              <li key={j}>{li}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="ai-p">
            {block.para}
          </p>
        ),
      )}
    </>
  );
}

export type FieldChange = { field: keyof AiFields; label: string; from: string; to: string };

const DETAILS: [keyof AiSuggestion, string][] = [
  ["target_users", "Who it is for"],
  ["problem", "Problem solved"],
  ["why_it_fits", "Why it fits"],
  ["materials_or_processes", "Likely materials / processes"],
  ["first_step", "First step"],
  ["assumptions", "Assumptions"],
];

function SuggestionCard({
  messageId,
  suggestion,
  accepted,
  applyLabel,
  changesFor,
  onApply,
  onRefine,
  onDismiss,
  chat,
}: {
  messageId: string;
  suggestion: AiSuggestion;
  accepted: boolean;
  applyLabel: (s: AiSuggestion) => string;
  changesFor: (s: AiSuggestion) => FieldChange[];
  onApply: (s: AiSuggestion, changes: FieldChange[]) => Promise<void>;
  onRefine: (s: AiSuggestion) => void;
  onDismiss: () => void;
  chat: AiChat;
}) {
  const [confirming, setConfirming] = useState<FieldChange[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const canApply = Object.keys(suggestion.fields ?? {}).length > 0;

  async function apply() {
    if (!confirming || applying) return;
    setApplying(true);
    setApplyError("");
    try {
      await onApply(suggestion, confirming);
      chat.markAccepted(messageId, suggestion, confirming.map((c) => c.field));
      setConfirming(null);
    } catch (caught) {
      setApplyError(errorMessage(caught, "Couldn’t save the change. Please try again."));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="ai-sugg">
      <b className="ai-sugg-title">{suggestion.title}</b>
      {suggestion.summary ? <p className="ai-p">{suggestion.summary}</p> : null}
      {DETAILS.some(([key]) => suggestion[key]) ? (
        <dl className="ai-sugg-details">
          {DETAILS.filter(([key]) => suggestion[key]).map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{String(suggestion[key])}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {confirming ? (
        <div className="ai-confirm" role="group" aria-label="Confirm changes">
          <p className="ai-p">
            <b>This will change:</b>
          </p>
          <ul>
            {confirming.map((c) => (
              <li key={c.field}>
                {c.label}: {c.from ? `“${c.from}” → ` : ""}“{c.to}”
              </li>
            ))}
          </ul>
          {applyError ? <p className="ai-error-text">{applyError}</p> : null}
          <div className="ai-actions">
            <button type="button" className="chip" onClick={() => void apply()} disabled={applying}>
              {applying ? "Applying…" : "Apply"}
            </button>
            <button type="button" className="chip" onClick={() => setConfirming(null)} disabled={applying}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="ai-actions">
          {accepted ? (
            <span className="ai-applied">Applied ✓</span>
          ) : canApply ? (
            <button
              type="button"
              className="chip"
              onClick={() => {
                const changes = changesFor(suggestion);
                if (changes.length) setConfirming(changes);
                else setApplyError("These values are already in your form.");
              }}
            >
              {applyLabel(suggestion)}
            </button>
          ) : null}
          <button type="button" className="chip" onClick={() => onRefine(suggestion)} disabled={chat.pending}>
            Refine this suggestion
          </button>
          <button type="button" className="chip" onClick={onDismiss}>
            Dismiss
          </button>
          {applyError && !confirming ? <p className="ai-error-text">{applyError}</p> : null}
        </div>
      )}
    </div>
  );
}

/** The conversation: messages (plain text), suggestions with confirm-before-apply, chips. */
export function AiMessages({
  chat,
  applyLabel,
  changesFor,
  onApply,
  onAsk,
  onRegenerate,
}: {
  chat: AiChat;
  applyLabel: (s: AiSuggestion) => string;
  changesFor: (s: AiSuggestion) => FieldChange[];
  onApply: (s: AiSuggestion, changes: FieldChange[]) => Promise<void>;
  onAsk: (text: string) => void;
  onRegenerate?: () => void;
}) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  return (
    <>
      {chat.messages.map((m, index) =>
        m.role === "user" ? (
          m.text ? (
            <div className="msg me" key={m.id}>
              {m.text}
            </div>
          ) : null
        ) : (
          <div className="msg ai" key={m.id}>
            <AiText text={m.text} />
            {m.refreshNote ? <p className="ai-note">{m.refreshNote}</p> : null}
            {(m.suggestions ?? [])
              .filter((s) => !dismissed.includes(`${m.id}:${s.id}`))
              .map((s) => (
                <SuggestionCard
                  key={s.id}
                  chat={chat}
                  messageId={m.id}
                  suggestion={s}
                  accepted={(m.accepted ?? []).includes(s.id)}
                  applyLabel={applyLabel}
                  changesFor={changesFor}
                  onApply={onApply}
                  onRefine={(sugg) => onAsk(`Refine this suggestion: ${sugg.title}`)}
                  onDismiss={() => setDismissed((current) => [...current, `${m.id}:${s.id}`])}
                />
              ))}
            {onRegenerate && (m.suggestions ?? []).length > 1 && index === chat.messages.length - 1 ? (
              <div className="ai-actions">
                <button type="button" className="chip" onClick={onRegenerate} disabled={chat.pending}>
                  Suggest different ideas
                </button>
              </div>
            ) : null}
            {m.chips && m.chips.length > 0 && index === chat.messages.length - 1 ? (
              <div className="chips">
                {m.chips.map((chip) => (
                  <button key={chip} type="button" className="chip" onClick={() => onAsk(chip)} disabled={chat.pending}>
                    {chip}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ),
      )}
      {chat.pending ? (
        <div className="msg ai typing" aria-label="AI is answering">
          <i />
          <i />
          <i />
        </div>
      ) : null}
      {chat.error ? (
        <div className="msg ai ai-error" role="alert">
          <p className="ai-p">{chat.error}</p>
          {chat.canRetry() && chat.state !== "off" ? (
            <div className="chips">
              <button type="button" className="chip" onClick={() => void chat.retry()} disabled={chat.pending}>
                Try again
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** Message box + Send. The typed text is kept until the assistant has answered. */
export function AiInput({
  chat,
  onSend,
  placeholder,
  formClass = "chat-form",
  inputClass = "chat-input",
  sendClass = "chat-send",
  formId,
  inputId,
}: {
  chat: AiChat;
  onSend: (text: string) => Promise<boolean>;
  placeholder: string;
  formClass?: string;
  inputClass?: string;
  sendClass?: string;
  formId?: string;
  inputId?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className={formClass}
      id={formId}
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        const text = value.trim();
        if (!text || chat.pending) return;
        void onSend(text).then((ok) => {
          if (ok) setValue("");
        });
      }}
    >
      <input
        id={inputId}
        className={inputClass}
        type="text"
        maxLength={1000}
        placeholder={placeholder}
        aria-label="Your question"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={chat.state === "off"}
      />
      <button className={sendClass} type="submit" disabled={chat.pending || chat.state === "off"}>
        Send
      </button>
    </form>
  );
}

type IdeaValues = { project: string; idea: string; product: string; industry: string };

/**
 * "Your idea" (step 2): optional AI help below the form. Collapsed until the user asks for it;
 * the form, its validation and Save & Next work exactly as before without it.
 */
export function IdeaAssistant({
  values,
  onApply,
  newProject = false,
}: {
  values: IdeaValues;
  onApply: (fields: Partial<IdeaValues>) => Promise<void>;
  newProject?: boolean;
}) {
  const chat = useAiChat("idea", newProject);
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const loaded = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const hasInput = Object.values(values).some((v) => v.trim());

  async function start(mode?: "explore" | "refine") {
    setOpen(true);
    setStarted(true);
    if (!loaded.current) {
      loaded.current = true;
      const { configured } = await chat.load();
      if (!configured) return;
    }
    if (mode === "explore") await chat.send("Help me find an idea", "explore", values);
    if (mode === "refine") await chat.send("Please help me refine my idea.", "refine", values);
    window.requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
  }

  function changesFor(s: AiSuggestion): FieldChange[] {
    return (["project", "idea", "product", "industry"] as const)
      .filter((key) => typeof s.fields[key] === "string" && s.fields[key] !== values[key].trim())
      .map((key) => ({ field: key, label: AI_FIELD_LABELS[key], from: values[key].trim(), to: s.fields[key] as string }));
  }

  return (
    <section className="xy-ai" aria-label="AI help with your idea">
      <div className="xy-ai-head">
        <div>
          <b>Need help with your idea?</b>
          <p>
            Optional: the AI assistant can refine what you entered or help you find an idea.
            Nothing in the form changes until you apply a suggestion.
          </p>
        </div>
        {open ? (
          <button type="button" className="chip" onClick={() => setOpen(false)}>
            Close
          </button>
        ) : null}
      </div>
      <div className="ai-actions">
        <button type="button" className="chip" onClick={() => void start("explore")} disabled={chat.pending}>
          Help me find an idea
        </button>
        <button type="button" className="chip" onClick={() => void start("refine")} disabled={chat.pending || !hasInput}>
          Refine my idea
        </button>
        {!open && started ? (
          <button type="button" className="chip" onClick={() => void start()}>
            Show conversation
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="xy-ai-chat">
          <div className="chat-log" ref={logRef} aria-live="polite">
            {chat.state === "loading" && !chat.pending ? (
              <div className="msg ai typing" aria-label="Loading">
                <i />
                <i />
                <i />
              </div>
            ) : null}
            {chat.state === "off" ? (
              <div className="msg ai">
                <p className="ai-p">The AI assistant is not available right now. You can fill in the form yourself.</p>
              </div>
            ) : null}
            <AiMessages
              chat={chat}
              applyLabel={(s) => (Object.keys(s.fields).length === 1 && s.fields.idea ? "Apply description" : "Use this idea")}
              changesFor={changesFor}
              onApply={async (s, changes) => {
                await onApply(Object.fromEntries(changes.map((c) => [c.field, c.to])) as Partial<IdeaValues>);
              }}
              onAsk={(text) => void chat.send(text, "chat", values)}
              onRegenerate={() => void chat.send("Please suggest three different ideas.", "explore", values)}
            />
          </div>
          <AiInput
            chat={chat}
            placeholder="Answer or ask the AI assistant…"
            onSend={(text) => chat.send(text, "chat", values)}
          />
        </div>
      ) : null}
    </section>
  );
}
