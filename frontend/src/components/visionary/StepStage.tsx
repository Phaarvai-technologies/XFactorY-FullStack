"use client";

import { useState } from "react";
import { FlowHeader, Progress } from "@/components/visionary/FlowChrome";
import { errorMessage, useVisionaryApi } from "@/lib/visionary/api";
import type { VisionarySlide } from "@/lib/visionary/paths";
import { getVisionaryData } from "@/lib/visionary/store";

const STAGES = [
  {
    value: "Idea Stage",
    title: "Idea Stage",
    body: "I have an idea but haven't started designing yet.",
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="#1d5fe0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="24" cy="20" r="11" />
        <path d="M19 34h10M21 40h6M24 4v3M8 20H5M43 20h-3M13 9l-2-2M35 9l2-2" />
      </svg>
    ),
  },
  {
    value: "Design Stage",
    title: "Design Stage",
    body: "I have a product design or concept.",
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="#1d5fe0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 40l3-10L32 9l7 7-21 21z" />
        <path d="M27 14l7 7M8 40l8-3" />
      </svg>
    ),
  },
  {
    value: "Prototype Stage",
    title: "Prototype Stage",
    body: "I have created or am creating a prototype.",
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="#1d5fe0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M24 5l17 8v20l-17 9-17-9V13z" />
        <path d="M24 22l17-9M24 22L7 13M24 22v20" />
      </svg>
    ),
  },
  {
    value: "Ready for Manufacturing",
    title: "Ready for Manufacturing",
    body: "My product is ready to be manufactured.",
    icon: (
      <svg viewBox="0 0 48 48" fill="none" stroke="#1d5fe0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 41V24l11 7v-7l11 7v-7l6 4V9h8v32z" />
        <path d="M14 41v-5M24 41v-5M34 41v-5" />
      </svg>
    ),
  },
] as const;

function Tick() {
  return (
    <span className="tick">
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M3 8.5l3.2 3.2L13 4.8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function StepStage({
  onContinue,
  onToast,
}: {
  onContinue: (slide: VisionarySlide) => void;
  onToast: (message: string) => void;
}) {
  const visionaryApi = useVisionaryApi();
  const [stage, setStage] = useState(() => getVisionaryData().stage);
  const [showError, setShowError] = useState(false);
  const [saving, setSaving] = useState(false);

  return (
    <div className="view active" id="v-s3">
      <FlowHeader />
      <main>
        <section className="side">
          <h1>Where is your idea today?</h1>
          <p>Tell us what stage your project is currently in.</p>
          <div className="note">Not sure? Pick the closest one. You can update it any time.</div>
        </section>
        <section>
          <Progress label="Project stage" step={3} />
          <form
            className="card"
            noValidate
            onSubmit={async (event) => {
              event.preventDefault();
              if (saving) return;
              if (!stage) {
                setShowError(true);
                return;
              }
              setSaving(true);
              try {
                await visionaryApi.saveStage(stage); // PUT /visionary/project/stage
                onContinue("step4");
              } catch (error) {
                onToast(errorMessage(error, "Couldn’t save the project stage. Please try again."));
              } finally {
                setSaving(false);
              }
            }}
          >
            <fieldset className="options">
              <legend style={{ position: "absolute", left: "-9999px" }}>Project stage</legend>
              {STAGES.map((option) => (
                <label className="opt" key={option.value}>
                  <input
                    type="radio"
                    name="stage"
                    value={option.value}
                    checked={stage === option.value}
                    onChange={() => {
                      setStage(option.value);
                      setShowError(false);
                    }}
                  />
                  <span className="face">
                    <Tick />
                    <span className="icon">{option.icon}</span>
                    <h3>{option.title}</h3>
                    <p>{option.body}</p>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className={`err${showError ? " show" : ""}`} role="alert">
              Please select the stage that fits your project best.
            </p>
            <div className="actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  if (stage) void visionaryApi.saveStage(stage).catch(() => undefined);
                  onContinue("step2");
                }}
              >
                Previous
              </button>
              <button type="submit" className="btn btn-primary" aria-busy={saving}>
                Save &amp; Next
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
