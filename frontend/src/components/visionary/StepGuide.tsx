"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { VisionarySlide } from "@/lib/visionary/paths";
import { getVisionaryData } from "@/lib/visionary/store";
import { VISIONARY_OVERVIEW_PATH } from "@/lib/visionary/paths";

type StageKey = "idea" | "design" | "prototype" | "ready";

const STAGES: Record<StageKey, string> = {
  idea: "Idea Stage",
  design: "Design Stage",
  prototype: "Prototype Stage",
  ready: "Ready for Manufacturing",
};

const PLAN: Record<
  StageKey,
  { intro: string; tips: string[]; chips: string[] }
> = {
  idea: {
    intro:
      "You are at the idea stage, so the goal now is to make the idea clear and testable.",
    tips: [
      "Write one line: who will use <b>{product}</b> and what problem it solves.",
      "Decide 2–3 must-have features (size, material, finish, print or branding).",
      "Check 3–5 similar products to see their price and what customers complain about.",
      "Set a rough budget and a target quantity for the first batch.",
    ],
    chips: [
      "How do I validate my idea?",
      "What materials can I use?",
      "How much will it cost?",
    ],
  },
  design: {
    intro:
      "You already have a design, so now we make sure it can actually be manufactured.",
    tips: [
      "Share drawings or a 3D file (STEP, STL or PDF) with dimensions.",
      "Mark the material, colour, finish and any printing or branding areas.",
      "Ask a manufacturer for a design-for-manufacturing (DFM) review before you finalise.",
      "List tolerances that really matter. Fewer tight tolerances means lower cost.",
    ],
    chips: [
      "What files do manufacturers need?",
      "What is a DFM review?",
      "How do I reduce cost?",
    ],
  },
  prototype: {
    intro:
      "A prototype is the best proof you can show. Next, test it and plan the first production run.",
    tips: [
      "Test the prototype for strength, safety and how it feels to use.",
      "Note every change needed before production and update your drawings.",
      "Check the rules for your product, such as food-contact safety for {industry}.",
      "Decide a pilot batch size and the minimum order quantity (MOQ) you can accept.",
    ],
    chips: [
      "What is a pilot batch?",
      "What certifications do I need?",
      "How do I choose a manufacturer?",
    ],
  },
  ready: {
    intro:
      "You are ready to manufacture, so let's get your request in front of the right manufacturers.",
    tips: [
      "Prepare final drawings, material specs and your target quantity.",
      "Decide your budget per unit and your delivery timeline.",
      "Ask for samples and quotes from at least 2–3 manufacturers.",
      "Confirm MOQ, lead time and quality checks before you commit.",
    ],
    chips: [
      "How do I compare quotes?",
      "What is MOQ?",
      "How long does production take?",
    ],
  },
};

const KB: Array<{ k: string[]; a: string; c: string[] | null }> = [
  {
    k: ["validate", "test idea", "demand", "market"],
    a: "To validate <b>{product}</b> cheaply: show a sketch or mock-up to 10–15 target users, ask what they would pay, and collect pre-orders or sign-ups before spending on tooling.",
    c: ["How much will it cost?", "What materials can I use?"],
  },
  {
    k: ["material", "made of", "steel", "plastic", "ceramic", "glass"],
    a: "Common choices for {industry}: stainless steel (durable, reusable), ceramic or glass (premium feel), BPA-free plastic or PP (low cost), and paper with a PE or PLA lining (disposable). Pick by use, price and safety rules. Food-contact products need food-grade material.",
    c: ["What certifications do I need?", "How do I reduce cost?"],
  },
  {
    k: ["cost", "price", "budget", "cheap", "expensive", "reduce"],
    a: "Cost depends on material, size, finish, printing and quantity. To keep it low: keep the shape simple, use standard sizes, limit colours, and order a bigger batch. Tell me your quantity and I will suggest how to plan the budget.",
    c: ["What is MOQ?", "What is a pilot batch?"],
  },
  {
    k: ["file", "drawing", "cad", "3d", "stl", "step"],
    a: "Manufacturers usually want a 2D drawing (PDF) with dimensions and a 3D file (STEP or STL). If you only have a sketch, a freelance designer or the manufacturer's design team can convert it.",
    c: ["What is a DFM review?", "How do I choose a manufacturer?"],
  },
  {
    k: ["dfm", "design for manufacturing"],
    a: "A DFM review is when a manufacturer checks your design and points out anything hard or costly to make, like thin walls, tight tolerances or tricky shapes, so you can fix it before production.",
    c: ["How do I reduce cost?", "What is a pilot batch?"],
  },
  {
    k: ["pilot", "small batch", "trial"],
    a: "A pilot batch is a small first run (often 50–500 units) to check quality, fit and cost before full production. It lowers your risk, though the per-unit price is higher.",
    c: ["What is MOQ?", "How long does production take?"],
  },
  {
    k: ["moq", "minimum order"],
    a: "MOQ is the minimum order quantity a manufacturer accepts. It varies by product and process. Ask for MOQ upfront and see whether a smaller trial order is possible.",
    c: ["What is a pilot batch?", "How do I compare quotes?"],
  },
  {
    k: ["certif", "safety", "standard", "fssai", "bis", "iso", "food grade"],
    a: "For {industry} products, check food-contact safety rules and quality standards (for example FSSAI for food-related items in India, and ISO 9001 for the manufacturer's quality system). The exact list depends on your product, so confirm with the manufacturer.",
    c: ["How do I choose a manufacturer?"],
  },
  {
    k: ["choose", "select", "find", "manufacturer", "supplier", "compare", "quote"],
    a: "Compare manufacturers on capability for your product, past work, MOQ, lead time, location and sample quality. Get quotes from 2–3 and compare the full picture, not only the lowest price. You can do this in the next step, <b>Find a Manufacturer</b>.",
    c: ["What is MOQ?", "How long does production take?"],
  },
  {
    k: ["time", "long", "lead", "days", "weeks", "timeline", "duration"],
    a: "Typical timeline: samples in 1–3 weeks, a pilot batch in 3–6 weeks, and mass production in 4–10 weeks depending on complexity and quantity. Share your target date and manufacturers can confirm.",
    c: ["What is a pilot batch?", "How do I compare quotes?"],
  },
  {
    k: ["next", "what now", "start", "begin", "step"],
    a: "Your next step for the <b>{stage}</b>: {firstTip}",
    c: null,
  },
];

function normStage(v: string | null | undefined): StageKey {
  const s = String(v || "").toLowerCase();
  if (s.includes("ready") || s.includes("manufactur")) return "ready";
  if (s.includes("proto")) return "prototype";
  if (s.includes("design")) return "design";
  return "idea";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type ChatMessage = {
  id: string;
  role: "ai" | "me";
  html: string;
  chips?: string[];
};

export function StepGuide({
  onContinue,
  onToast,
}: {
  onContinue: (slide: VisionarySlide) => void;
  onToast?: (message: string) => void;
}) {
  const data = getVisionaryData();
  const idea = data.idea;
  const stageKey: StageKey = normStage(data.stage);
  const stageDisplay = STAGES[stageKey];

  const projectName = idea?.project?.trim() || "Customized Bottle";
  const productName = idea?.product?.trim() || "Customized coffee cup";
  const industryName = idea?.industry?.trim() || "Food & Beverage";

  const plan = PLAN[stageKey];

  const fillText = (s: string) =>
    s
      .replace(/{product}/g, escapeHtml(productName.toLowerCase()))
      .replace(/{industry}/g, escapeHtml(industryName))
      .replace(/{stage}/g, escapeHtml(stageDisplay))
      .replace(
        /{firstTip}/g,
        plan.tips[0]
          .replace(/{product}/g, escapeHtml(productName.toLowerCase()))
          .replace(/{industry}/g, escapeHtml(industryName)),
      );

  const initialHtml = useMemo(() => {
    const lead = `Hi! I looked at your project <b>${escapeHtml(projectName)}</b>. `;
    const tipsList = plan.tips.map((t) => `<li>${fillText(t)}</li>`).join("");
    return (
      lead +
      plan.intro +
      "<h4 style='margin-top:10px;font-weight:700'>Suggested next steps</h4>" +
      `<ul>${tipsList}</ul>` +
      "<div style='margin-top:10px'>Ask me anything or pick a question below.</div>"
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName, stageKey]);

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: "init",
      role: "ai",
      html: initialHtml,
      chips: plan.chips,
    },
  ]);
  const [typing, setTyping] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages, typing]);

  function localAnswer(query: string) {
    const s = query.toLowerCase();
    for (const e of KB) {
      if (e.k.some((w) => s.includes(w))) {
        return {
          a: fillText(e.a),
          c: e.c || plan.chips,
        };
      }
    }
    return {
      a:
        "Good question. I do not have a specific answer for that yet, but here is how to think about it for <b>" +
        escapeHtml(productName.toLowerCase()) +
        "</b>: write down what you already know, what you are unsure about, and share it with a manufacturer for their view. You can also try asking about materials, cost, MOQ, timeline or certifications.",
      c: plan.chips,
    };
  }

  async function askQuestion(text: string) {
    const trimmed = text.trim();
    if (!trimmed || typing) return;

    const userMessage: ChatMessage = {
      id: `me-${Date.now()}-${Math.random()}`,
      role: "me",
      html: escapeHtml(trimmed),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputVal("");
    setTyping(true);

    await new Promise((resolve) => setTimeout(resolve, 600));

    const answer = localAnswer(trimmed);
    const aiMessage: ChatMessage = {
      id: `ai-${Date.now()}-${Math.random()}`,
      role: "ai",
      html: answer.a,
      chips: answer.c || undefined,
    };

    setMessages((prev) => [...prev, aiMessage]);
    setTyping(false);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    void askQuestion(inputVal);
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
            {messages.map((m) => (
              <div className={`msg ${m.role}`} key={m.id}>
                <div dangerouslySetInnerHTML={{ __html: m.html }} />
                {m.chips && m.chips.length > 0 && (
                  <div className="chips">
                    {m.chips.map((chipText) => (
                      <button
                        key={chipText}
                        type="button"
                        className="chip"
                        onClick={() => void askQuestion(chipText)}
                      >
                        {chipText}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {typing && (
              <div className="msg ai typing" aria-label="AI is answering">
                <i />
                <i />
                <i />
              </div>
            )}
          </div>

          <form className="chat-form" id="form" autoComplete="off" onSubmit={handleSubmit}>
            <input
              id="input"
              className="chat-input"
              type="text"
              placeholder="Ask anything about your product or manufacturing…"
              aria-label="Your question"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
            />
            <button className="chat-send" type="submit" disabled={typing}>
              Send
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}
