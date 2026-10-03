"use client";

import { useEffect, useState } from "react";
import { FlowHeader } from "@/components/visionary/FlowChrome";
import { ApiError } from "@/lib/api";
import { errorMessage, useVisionaryApi, type RequestDraft } from "@/lib/visionary/api";
import type { VisionarySlide } from "@/lib/visionary/paths";
import {
  MACHINE_CATALOG,
  TIMELINE_LABELS,
  digitsOnly,
  formatIndianNumber,
  initials,
  type ManufacturingRequest,
  type SelectedManufacturer,
} from "@/lib/visionary/storage";
import { addVisionaryRequest, getVisionaryData } from "@/lib/visionary/store";

const DURATIONS = [
  ["1_week", "1 week"],
  ["2_weeks", "2 weeks"],
  ["1_month", "1 month"],
  ["2_months", "2 months"],
  ["3_months", "3 months"],
  ["6_months", "6 months"],
] as const;

/** The fields the API takes (names, status and ids are set by the server). */
function requestInput(data: ManufacturingRequest) {
  return {
    manufacturer_id: data.manufacturer_id,
    machine: data.machine,
    quantity: data.quantity,
    required_duration: data.required_duration,
    manufacturing_location: data.manufacturing_location,
    budget: data.budget,
    timeline: data.timeline,
    additional_requirements: data.additional_requirements,
  };
}

type DraftFields = {
  machine: string;
  quantity: string;
  required_duration: string;
  manufacturing_location: string;
  budget: string;
  timeline: string;
  additional_requirements: string;
};

function initialFields(draft: Partial<RequestDraft> | null): DraftFields {
  const requirements = getVisionaryData().requirements;
  const quantity = draft?.quantity?.value || requirements?.quantity?.value;
  const budget = draft?.budget?.amount || requirements?.budget?.amount;
  return {
    machine: draft?.machine || "",
    quantity: quantity ? formatIndianNumber(String(quantity)) : "",
    required_duration: draft?.required_duration || "",
    manufacturing_location:
      draft?.manufacturing_location || requirements?.manufacturing_location || "",
    budget: budget ? formatIndianNumber(String(budget)) : "",
    timeline: draft?.timeline || requirements?.timeline || "",
    additional_requirements:
      draft?.additional_requirements || requirements?.additional_requirements || "",
  };
}

type Loaded = { manufacturer: SelectedManufacturer | null; draft: RequestDraft | null };

/**
 * Loads the selected manufacturer (GET /visionary/manufacturers/{id}) and the saved draft
 * for it (GET .../draft) from the server, then shows the request form.
 */
export function ManufacturingRequestForm({
  manufacturerId,
  onContinue,
  onToast,
}: {
  manufacturerId: string | null;
  onContinue: (slide: VisionarySlide) => void;
  onToast: (message: string) => void;
}) {
  const visionaryApi = useVisionaryApi();
  const [loaded, setLoaded] = useState<Loaded | null>(
    manufacturerId ? null : { manufacturer: null, draft: null },
  );

  useEffect(() => {
    if (!manufacturerId) return;
    let cancelled = false;
    Promise.all([visionaryApi.manufacturer(manufacturerId), visionaryApi.draft(manufacturerId)])
      .then(([{ record }, draft]) => {
        if (cancelled) return;
        setLoaded({
          manufacturer: {
            id: record.id,
            name: record.name,
            location: record.location,
            machines: record.machines.length ? record.machines : MACHINE_CATALOG,
            logo: record.logo,
          },
          draft,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Unknown or no longer listed manufacturer: same as "No manufacturer selected".
        if (!(error instanceof ApiError && error.status === 404)) {
          onToast(errorMessage(error, "Couldn’t load the manufacturer. Please try again."));
        }
        setLoaded({ manufacturer: null, draft: null });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manufacturerId]);

  if (!loaded) return null;
  return (
    <RequestForm
      manufacturer={loaded.manufacturer}
      draft={loaded.draft}
      onContinue={onContinue}
      onToast={onToast}
    />
  );
}

function RequestForm({
  manufacturer,
  draft,
  onContinue,
  onToast,
}: {
  manufacturer: SelectedManufacturer | null;
  draft: RequestDraft | null;
  onContinue: (slide: VisionarySlide) => void;
  onToast: (message: string) => void;
}) {
  const visionaryApi = useVisionaryApi();
  const project = getVisionaryData().idea?.project || "—";
  const label = manufacturer
    ? manufacturer.name + (manufacturer.location ? ` — ${manufacturer.location}` : "")
    : "";
  const [form, setForm] = useState<DraftFields>(() => initialFields(draft));
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [manufacturerError, setManufacturerError] = useState(false);
  const [sending, setSending] = useState(false);

  function setNumeric(key: "quantity" | "budget", raw: string, caretFromEnd: number) {
    const formatted = formatIndianNumber(raw);
    setForm((current) => ({ ...current, [key]: formatted }));
    setErrors((current) => ({ ...current, [key]: false }));
    requestAnimationFrame(() => {
      const input = document.getElementById(key === "quantity" ? "mr-quantity" : "mr-budget");
      if (!(input instanceof HTMLInputElement)) return;
      const position = Math.max(0, formatted.length - caretFromEnd);
      input.setSelectionRange(position, position);
    });
  }

  function payload(status: string): ManufacturingRequest | null {
    if (!manufacturer) return null;
    return {
      manufacturer_id: manufacturer.id,
      manufacturer_name: manufacturer.name,
      project_name: project,
      visionary: getVisionaryData().profile?.name || "",
      machine: form.machine,
      quantity: { value: parseInt(digitsOnly(form.quantity) || "0", 10), unit: "units" },
      required_duration: form.required_duration,
      manufacturing_location: form.manufacturing_location.trim(),
      budget: { amount: parseInt(digitsOnly(form.budget) || "0", 10), currency: "INR" },
      timeline: form.timeline,
      additional_requirements: form.additional_requirements.trim(),
      status,
    };
  }

  const any = Boolean(
    form.machine ||
      digitsOnly(form.quantity) ||
      form.required_duration ||
      form.manufacturing_location.trim() ||
      digitsOnly(form.budget) ||
      form.timeline ||
      form.additional_requirements.trim(),
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    if (!manufacturer) {
      setManufacturerError(true);
      return;
    }
    const data = payload("submitted");
    if (!data) {
      setManufacturerError(true);
      return;
    }
    const nextErrors = {
      machine: !data.machine,
      quantity: data.quantity.value < 1,
      required_duration: !data.required_duration,
      manufacturing_location: !data.manufacturing_location,
      budget: data.budget.amount < 1,
      timeline: !data.timeline,
    };
    setErrors(nextErrors);
    const first = (
      ["machine", "quantity", "required_duration", "manufacturing_location", "budget", "timeline"] as const
    ).find((key) => nextErrors[key]);
    if (first) {
      const id =
        first === "timeline"
          ? "mr-tl-immediately"
          : first === "quantity"
            ? "mr-quantity"
            : first === "budget"
              ? "mr-budget"
              : first === "machine"
                ? "mr-machine"
                : first === "required_duration"
                  ? "mr-required_duration"
                  : "mr-manufacturing_location";
      document.getElementById(id)?.focus();
      return;
    }
    setSending(true);
    try {
      // POST /visionary/requests: stored in the database; the manufacturer sees it in its
      // dashboard, and the saved draft for this manufacturer is removed.
      const saved = await visionaryApi.sendRequest(requestInput(data));
      addVisionaryRequest(saved);
      onContinue("submitted");
    } catch (error) {
      onToast(errorMessage(error, "Could not send the request. Please try again."));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="view active" id="v-mr">
      <FlowHeader />
      <main>
        <button type="button" className="back" onClick={() => onContinue("results")}>
          ← Back to manufacturers
        </button>
        <h1>Create Manufacturing Request</h1>
        <div className="context">
          <div className="ctx">
            {manufacturer?.logo ? (
              <img className="logo" src={manufacturer.logo} alt="" />
            ) : (
              <span className="ic">{manufacturer ? initials(manufacturer.name) : "—"}</span>
            )}
            <div>
              {manufacturer ? (
                <>
                  <small>Selected manufacturer</small>
                  <b>{label}</b>
                </>
              ) : (
                <>
                  <small>Manufacturer</small>
                  <b>No manufacturer selected</b>
                  <span className="miss">Go back to manufacturers to select a manufacturer.</span>
                  <button type="button" className="btn btn-ghost pick" onClick={() => onContinue("results")}>
                    Choose Manufacturer
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="ctx">
            <span className="ic" aria-hidden="true">
              P
            </span>
            <div>
              <small>Project</small>
              <b>{project}</b>
            </div>
          </div>
        </div>
        {manufacturerError ? (
          <p className="need" role="alert">
            Please select a manufacturer before creating the request.
          </p>
        ) : null}
        <div className="layout">
          <form className="card" noValidate onSubmit={submit}>
            <div className={`field${errors.machine ? " error" : ""}`}>
              <label htmlFor="mr-machine">Machine</label>
              <p className="hint">Choose from the machines this manufacturer has available.</p>
              <select
                id="mr-machine"
                className={form.machine ? undefined : "empty"}
                required
                disabled={!manufacturer}
                value={manufacturer ? form.machine : ""}
                onChange={(event) => {
                  setForm((current) => ({ ...current, machine: event.target.value }));
                  setErrors((current) => ({ ...current, machine: false }));
                }}
              >
                <option value="">
                  {manufacturer ? "Select available machine" : "Select a manufacturer first"}
                </option>
                {(manufacturer?.machines ?? []).map((machine) => (
                  <option key={machine} value={machine}>
                    {machine}
                  </option>
                ))}
              </select>
              <p className="err">Please select a machine.</p>
            </div>
            <div className="row">
              <div className={`field${errors.quantity ? " error" : ""}`}>
                <label htmlFor="mr-quantity">Quantity</label>
                <p className="hint">Number of units you need.</p>
                <div className="affix suffix">
                  <input
                    type="text"
                    inputMode="numeric"
                    id="mr-quantity"
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
              <div className={`field${errors.required_duration ? " error" : ""}`}>
                <label htmlFor="mr-required_duration">Required duration</label>
                <p className="hint">How long you need the machine for.</p>
                <select
                  id="mr-required_duration"
                  className={form.required_duration ? undefined : "empty"}
                  required
                  value={form.required_duration}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, required_duration: event.target.value }));
                    setErrors((current) => ({ ...current, required_duration: false }));
                  }}
                >
                  <option value="">Select duration</option>
                  {DURATIONS.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
                <p className="err">Please select a duration.</p>
              </div>
            </div>
            <div className="row">
              <div className={`field${errors.manufacturing_location ? " error" : ""}`}>
                <label htmlFor="mr-manufacturing_location">Manufacturing location</label>
                <p className="hint">Where the product should be made.</p>
                <input
                  type="text"
                  id="mr-manufacturing_location"
                  autoComplete="off"
                  placeholder="e.g. Chennai"
                  value={form.manufacturing_location}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, manufacturing_location: event.target.value }));
                    setErrors((current) => ({ ...current, manufacturing_location: false }));
                  }}
                />
                <p className="err">Please enter a location.</p>
              </div>
              <div className={`field${errors.budget ? " error" : ""}`}>
                <label htmlFor="mr-budget">Budget</label>
                <p className="hint">Your total budget for this request.</p>
                <div className="affix">
                  <span className="sym">₹</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    id="mr-budget"
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
              <span className="lbl" id="mr-tl-label">
                Target timeline
              </span>
              <p className="hint">When do you need the products?</p>
              <fieldset className="pills" role="radiogroup" aria-labelledby="mr-tl-label">
                {Object.entries(TIMELINE_LABELS).map(([value, text]) => (
                  <label className="pill" key={value}>
                    <input
                      id={value === "immediately" ? "mr-tl-immediately" : undefined}
                      type="radio"
                      name="timeline"
                      value={value}
                      checked={form.timeline === value}
                      onChange={() => {
                        setForm((current) => ({ ...current, timeline: value }));
                        setErrors((current) => ({ ...current, timeline: false }));
                      }}
                    />
                    <span>{text}</span>
                  </label>
                ))}
              </fieldset>
              <p className="err">Please choose a timeline.</p>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="mr-additional_requirements">
                Additional requirements <span className="opt-tag">Optional</span>
              </label>
              <p className="hint">Anything else the manufacturer should know.</p>
              <textarea
                id="mr-additional_requirements"
                maxLength={500}
                placeholder="Tell us anything else that matters for this request"
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
                  const draft = payload("draft");
                  if (!manufacturer || !draft) {
                    setManufacturerError(true);
                    return;
                  }
                  // PUT /visionary/manufacturers/{id}/draft
                  const { manufacturer_id: id, ...fields } = requestInput(draft);
                  visionaryApi.saveDraft(id, fields).then(
                    () => onToast("Saved."),
                    (error: unknown) => onToast(errorMessage(error, "Could not save. Please try again.")),
                  );
                }}
              >
                Save
              </button>
              <button type="submit" className="btn btn-primary" aria-busy={sending}>
                Send Request to Manufacturer
              </button>
            </div>
          </form>
          <aside className="side">
            <div className="card summary">
              <h2>Request summary</h2>
              <dl className="sum">
                <div hidden={!any}>
                  <dt>Project</dt>
                  <dd>{project}</dd>
                </div>
                <div>
                  <dt>Manufacturer</dt>
                  <dd className={manufacturer ? undefined : "none"}>
                    {manufacturer ? label : "No manufacturer selected"}
                  </dd>
                </div>
                <div hidden={!form.machine}>
                  <dt>Machine</dt>
                  <dd>{form.machine}</dd>
                </div>
                <div hidden={!digitsOnly(form.quantity)}>
                  <dt>Quantity</dt>
                  <dd>{Number(digitsOnly(form.quantity) || 0).toLocaleString("en-IN")} units</dd>
                </div>
                <div hidden={!digitsOnly(form.budget)}>
                  <dt>Budget</dt>
                  <dd>₹{Number(digitsOnly(form.budget) || 0).toLocaleString("en-IN")}</dd>
                </div>
                <div hidden={!form.timeline}>
                  <dt>Timeline</dt>
                  <dd>{TIMELINE_LABELS[form.timeline]}</dd>
                </div>
              </dl>
              <div className="note" role="note">
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <circle cx="10" cy="10" r="8.5" stroke="#1d5fe0" strokeWidth="1.8" />
                  <path d="M10 9v5M10 6.2v.1" stroke="#1d5fe0" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span>Your request will be sent to the selected manufacturer for review.</span>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
