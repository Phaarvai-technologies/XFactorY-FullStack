"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  AI_FIELD_LABELS,
  AiInput,
  AiMessages,
  useAiChat,
  type FieldChange,
} from "@/components/visionary/AiAssistant";
import { useVisionaryApi, type AiSuggestion } from "@/lib/visionary/api";
import type { VisionarySlide } from "@/lib/visionary/paths";
import type { VisionaryRequirements } from "@/lib/visionary/storage";
import { getVisionaryData } from "@/lib/visionary/store";
import { VISIONARY_OVERVIEW_PATH } from "@/lib/visionary/paths";

const NOT_PROVIDED = "Not provided";
const MAX_ADDITIONAL = 500;

/** Saved requirements, or an empty set (the requirements step has not been filled in yet). */
function savedRequirements(): VisionaryRequirements {
  const saved = getVisionaryData().requirements;
  return {
    machines: saved?.machines ?? [],
    manufacturing_location: saved?.manufacturing_location ?? "",
    quantity: { value: saved?.quantity?.value ?? 0, unit: "units" },
    budget: { amount: saved?.budget?.amount ?? 0, currency: "INR" },
    timeline: saved?.timeline ?? "",
    additional_requirements: saved?.additional_requirements ?? "",
  };
}

/** What an accepted guide suggestion would change in the Manufacturing requirements. */
function requirementChanges(s: AiSuggestion): FieldChange[] {
  const current = savedRequirements();
  const changes: FieldChange[] = [];
  const machines = current.machines ?? [];
  const added = (s.fields.machines ?? []).filter((m) => !machines.includes(m));
  if (added.length) {
    changes.push({ field: "machines", label: AI_FIELD_LABELS.machines, from: machines.join(", "),
                   to: [...machines, ...added].join(", ") });
  }
  const extra = s.fields.additional_requirements?.trim();
  if (extra && !current.additional_requirements.includes(extra)) {
    const to = current.additional_requirements ? `${current.additional_requirements}\n${extra}` : extra;
    changes.push({ field: "additional_requirements", label: AI_FIELD_LABELS.additional_requirements,
                   from: current.additional_requirements, to });
  }
  return changes;
}

export function StepGuide({
  onContinue,
  onToast,
}: {
  onContinue: (slide: VisionarySlide) => void;
  onToast?: (message: string) => void;
}) {
  const data = getVisionaryData();
  const idea = data.idea;
  // The stage the user saved; never assumed when missing.
  const stageDisplay = data.stage || "Not selected";
  const projectName = idea?.project?.trim() || NOT_PROVIDED;
  const productName = idea?.product?.trim() || NOT_PROVIDED;
  const industryName = idea?.industry?.trim() || NOT_PROVIDED;

  const visionaryApi = useVisionaryApi();
  const chat = useAiChat("guide");
  const logRef = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(false);

  // Saved conversation for this project; the opening guidance is requested once, when none exists.
  useEffect(() => {
    let cancelled = false;
    void chat.load().then(({ configured, count }) => {
      if (cancelled) return;
      setOpened(true);
      if (configured && count === 0) void chat.send("", "start");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [chat.messages, chat.pending, chat.error]);

  /** Accepted suggestion -> the saved Manufacturing requirements (confirmed on that step later). */
  async function addToRequirements(_s: AiSuggestion, changes: FieldChange[]) {
    const next = savedRequirements();
    for (const change of changes) {
      if (change.field === "machines") next.machines = change.to.split(", ").filter(Boolean);
      if (change.field === "additional_requirements") {
        if (change.to.length > MAX_ADDITIONAL) {
          throw new Error(`Additional requirements can be at most ${MAX_ADDITIONAL} characters. Shorten them on the next step first.`);
        }
        next.additional_requirements = change.to;
      }
    }
    await visionaryApi.saveRequirements(next, false); // PUT /visionary/project/requirements (draft)
    onToast?.("Added to your requirements. You can review them on the next step.");
  }

  return (
    <div className="view active" id="v-guide">
      <div className="guide-wrap">
        <header className="brand">
          <Link className="logo" href={VISIONARY_OVERVIEW_PATH} aria-label="XfactorY home">
            <Image
              className="logo-img"
              src="/images/xy-logo.png"
              alt="XfactorY"
              width={150}
              height={48}
              priority
            />
          </Link>
        </header>

        <aside className="left">
          <h1>Your AI guide</h1>
          <p className="sub">
            Get simple next steps for your idea, then ask anything about your project.
          </p>

          <div className="guide-card proj">
            <h3>Your project</h3>
            <dl id="summary">
              <dt>Name</dt>
              <dd>{projectName}</dd>
              <dt>Product</dt>
              <dd>{productName}</dd>
              <dt>Industry</dt>
              <dd>{industryName}</dd>
              <dt>Stage</dt>
              <dd>{stageDisplay}</dd>
            </dl>
          </div>

          <div className="guide-note">
            Your suggestions are based on the stage you picked in the previous step.
          </div>

          <div className="guide-nav">
            <button
              className="btn-prev"
              type="button"
              onClick={() => onContinue("step3")}
            >
              Previous
            </button>
            <button
              className="btn-next"
              type="button"
              id="nextBtn"
              onClick={() => onContinue("step4")}
            >
              Save &amp; Next
            </button>
          </div>
        </aside>

        <main className="guide-card chat" aria-label="AI chat">
          <div className="chat-head">
            <div className="avatar" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
                <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
              </svg>
            </div>
            <div>
              <b>XfactorY AI Guide</b>
              <span>Suggestions for your product idea</span>
            </div>
            <div className="badge" id="badge">
              {stageDisplay}
            </div>
          </div>

          <div className="chat-log" ref={logRef} id="log" aria-live="polite">
            {chat.state === "loading" && !opened ? (
              <div className="msg ai typing" aria-label="Loading">
                <i />
                <i />
                <i />
              </div>
            ) : null}
            {chat.state === "off" ? (
              <div className="msg ai">
                <p className="ai-p">
                  The AI guide is not available right now. You can continue to your manufacturing
                  requirements with Save &amp; Next.
                </p>
              </div>
            ) : null}
            {chat.changed.length > 0 && chat.messages.length > 0 && !chat.pending ? (
              <div className="msg ai">
                <p className="ai-note">
                  Your project details changed since this guidance. Some advice may need updating.
                </p>
                <div className="chips">
                  <button
                    type="button"
                    className="chip"
                    onClick={() => void chat.send("My project details changed. Please update your guidance.", "chat")}
                  >
                    Update my guidance
                  </button>
                </div>
              </div>
            ) : null}
            <AiMessages
              chat={chat}
              applyLabel={() => "Add to requirements"}
              changesFor={requirementChanges}
              onApply={addToRequirements}
              onAsk={(text) => void chat.send(text, "chat")}
            />
          </div>

          <AiInput
            chat={chat}
            formId="form"
            inputId="input"
            placeholder="Ask anything about your product or manufacturing…"
            onSend={(text) => chat.send(text, "chat")}
          />
        </main>
      </div>
    </div>
  );
}
