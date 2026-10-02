"use client";

import { useState } from "react";
import { FlowHeader, Progress } from "@/components/visionary/FlowChrome";
import { errorMessage, useVisionaryApi } from "@/lib/visionary/api";
import type { VisionarySlide } from "@/lib/visionary/paths";
import {
  TIMELINE_LABELS,
  digitsOnly,
  formatIndianNumber,
  type VisionaryRequirements,
} from "@/lib/visionary/storage";
import { getVisionaryData } from "@/lib/visionary/store";

const TIMELINES = Object.entries(TIMELINE_LABELS);

type FormState = {
  manufacturing_location: string;
  quantity: string;
  budget: string;
  timeline: string;
  additional_requirements: string;
};

function fromStored(): FormState {
  const stored: Partial<VisionaryRequirements> | null = getVisionaryData().requirements;
  if (!stored) {
    return {
      manufacturing_location: "",
      quantity: "",
      budget: "",
      timeline: "",
      additional_requirements: "",
    };
  }
  return {
    manufacturing_location: stored.manufacturing_location || "",
    quantity: stored.quantity?.value ? formatIndianNumber(String(stored.quantity.value)) : "",
    budget: stored.budget?.amount ? formatIndianNumber(String(stored.budget.amount)) : "",
    timeline: stored.timeline || "",
    additional_requirements: stored.additional_requirements || "",
  };
}

export function StepNeeds({
  onContinue,
  onToast,
}: {
  onContinue: (slide: VisionarySlide) => void;
  onToast: (message: string) => void;
}) {
  const visionaryApi = useVisionaryApi();
  const [form, setForm] = useState<FormState>(fromStored);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  function setNumeric(key: "quantity" | "budget", raw: string, caretFromEnd: number) {
    const formatted = formatIndianNumber(raw);
    setForm((current) => ({ ...current, [key]: formatted }));
    setErrors((current) => ({ ...current, [key]: false }));
    requestAnimationFrame(() => {
      const input = document.getElementById(key) as HTMLInputElement | null;
      if (!input) return;
      const position = Math.max(0, formatted.length - caretFromEnd);
      input.setSelectionRange(position, position);
    });
  }

  function payload(): VisionaryRequirements {
    return {
      manufacturing_location: form.manufacturing_location.trim(),
      quantity: { value: parseInt(digitsOnly(form.quantity) || "0", 10), unit: "units" },
      budget: { amount: parseInt(digitsOnly(form.budget) || "0", 10), currency: "INR" },
      timeline: form.timeline,
      additional_requirements: form.additional_requirements.trim(),
    };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const data = payload();
    const nextErrors = {
      manufacturing_location: !data.manufacturing_location,
      quantity: data.quantity.value < 1,
      budget: data.budget.amount < 1,
      timeline: !data.timeline,
    };
    setErrors(nextErrors);
    const first = (["manufacturing_location", "quantity", "budget", "timeline"] as const).find(
      (key) => nextErrors[key],
    );
    if (first) {
      if (first === "timeline") {
        document.querySelector<HTMLInputElement>('input[name="timeline"]')?.focus();
      } else {
        document.getElementById(first)?.focus();
      }
      return;
    }
    setSaving(true);
    try {
      await visionaryApi.saveRequirements(data, true); // PUT /visionary/project/requirements
      onContinue("results");
    } catch (error) {
      onToast(errorMessage(error, "Couldn’t save your requirements. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="view active" id="v-s4">
      <FlowHeader />
      <main>
        <section className="side">
          <h1>Tell us about your manufacturing needs</h1>
          <p className="lead">These details help us connect your project with suitable manufacturers.</p>
          <div className="info" role="note">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="8.5" stroke="#1d5fe0" strokeWidth="1.8" />
              <path d="M10 9v5M10 6.2v.1" stroke="#1d5fe0" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>We’ll use these requirements to help you find manufacturers that match your needs.</span>
          </div>
        </section>
        <section>
          <Progress label="Manufacturing requirements" step={4} />
          <form className="card" noValidate onSubmit={submit}>
            <div className={`field${errors.manufacturing_location ? " error" : ""}`}>
              <label htmlFor="manufacturing_location">Manufacturing location</label>
              <p className="hint">City or region where you want the product made.</p>
              <input
                type="text"
                id="manufacturing_location"
                autoComplete="off"
                placeholder="e.g. Chennai"
                value={form.manufacturing_location}
                onChange={(event) => {
                  setForm((current) => ({ ...current, manufacturing_location: event.target.value }));
                  setErrors((current) => ({ ...current, manufacturing_location: false }));
                }}
              />
              <p className="err">Please enter a manufacturing location.</p>
            </div>
            <div className="row">
              <div className={`field${errors.quantity ? " error" : ""}`}>
                <label htmlFor="quantity">Quantity</label>
                <p className="hint">How many units for your first order?</p>
                <div className="affix suffix">
                  <input
                    type="text"
                    inputMode="numeric"
                    id="quantity"
                    autoComplete="off"
                    placeholder="e.g. 1,000"
                    value={form.quantity}
                    onChange={(event) => {
                      const caretFromEnd = event.target.value.length - (event.target.selectionStart ?? 0);
                      setNumeric("quantity", event.target.value, caretFromEnd);
                    }}
                  />
                  <span className="sym">units</span>
                </div>
                <p className="err">Enter a quantity greater than 0.</p>
              </div>
              <div className={`field${errors.budget ? " error" : ""}`}>
                <label htmlFor="budget">Budget</label>
                <p className="hint">Your total budget for this order.</p>
                <div className="affix">
                  <span className="sym">₹</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    id="budget"
                    autoComplete="off"
                    placeholder="e.g. 2,00,000"
                    value={form.budget}
                    onChange={(event) => {
                      const caretFromEnd = event.target.value.length - (event.target.selectionStart ?? 0);
                      setNumeric("budget", event.target.value, caretFromEnd);
                    }}
                  />
                </div>
                <p className="err">Enter a budget greater than 0.</p>
              </div>
            </div>
            <div className={`field${errors.timeline ? " error" : ""}`}>
              <span className="lbl" id="tl-label">
                Desired timeline
              </span>
              <p className="hint">When do you need the products?</p>
              <fieldset className="pills" role="radiogroup" aria-labelledby="tl-label">
                {TIMELINES.map(([value, label]) => (
                  <label className="pill" key={value}>
                    <input
                      type="radio"
                      name="timeline"
                      value={value}
                      checked={form.timeline === value}
                      onChange={() => {
                        setForm((current) => ({ ...current, timeline: value }));
                        setErrors((current) => ({ ...current, timeline: false }));
                      }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              <p className="err">Please choose a timeline.</p>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="additional_requirements">
                Additional requirements <span className="opt-tag">Optional</span>
              </label>
              <p className="hint">Anything else manufacturers should know, such as certifications or packaging.</p>
              <textarea
                id="additional_requirements"
                maxLength={500}
                placeholder="Tell us anything else that matters for your project"
                value={form.additional_requirements}
                onChange={(event) =>
                  setForm((current) => ({ ...current, additional_requirements: event.target.value }))
                }
              />
              <div className="count">
                <span>{form.additional_requirements.length}</span>/500
              </div>
            </div>
            <div className="actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  void visionaryApi.saveRequirements(payload(), false).catch(() => undefined);
                  onContinue("step3");
                }}
              >
                Previous
              </button>
              <button type="submit" className="btn btn-primary" aria-busy={saving}>
                Find a Manufacturer
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
