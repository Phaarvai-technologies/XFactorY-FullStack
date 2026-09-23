import { useRef, useState } from "react";
import { ImagePhotoIcon } from "@/components/manufacturer/icons";
import { WizardFooter, WizardShell } from "@/components/manufacturer/WizardShell";
import type { MachineryListing } from "@/lib/manufacturer/types";

const EPIC3_TOTAL = 7;
const STEP_LABELS = [
  "Machinery details",
  "Images",
  "Raw materials",
  "Labor",
  "Logistics",
  "Pricing & insurance",
  "Publish",
];

const INDUSTRIES = [
  "Textile & Apparel",
  "Electronics & Hardware",
  "Food & Beverage",
  "Automotive & Machinery",
  "Furniture & Woodwork",
  "Chemicals & Plastics",
  "Other",
];
const CONDITIONS = ["New", "Excellent", "Good", "Fair"];

type MachineryDraft = Omit<MachineryListing, "id" | "status">;

function blankDraft(): MachineryDraft {
  return {
    industry: "",
    subcategory: "",
    type: "",
    capacity: "",
    age: "",
    condition: "",
    technical: "",
    images: [],
    rawMatStatus: "Available",
    materialDetails: "",
    laborType: "Skilled",
    workerCount: "",
    workerRoles: "",
    logistics: ["Local"],
    logisticsPartner: "",
    pricing: { hour: "", day: "", month: "", unit: "", batch: "" },
    insurance: "",
  };
}

type MachineryWizardProps = {
  onClose: () => void;
  onPublish: (draft: MachineryDraft, status: "Draft" | "Published") => void;
  showToast: (message: string) => void;
};

export function MachineryWizard({ onClose, onPublish, showToast }: MachineryWizardProps) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<MachineryDraft>(blankDraft);
  const [errors, setErrors] = useState<{ industry?: string; type?: string }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  function update(patch: Partial<MachineryDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function handleImages(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result;
        if (typeof result !== "string") return;
        setDraft((current) => ({
          ...current,
          images: [
            ...current.images,
            { src: result, primary: current.images.length === 0 },
          ],
        }));
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function setPrimary(index: number) {
    setDraft((current) => ({
      ...current,
      images: current.images.map((img, i) => ({ ...img, primary: i === index })),
    }));
  }

  function removeImage(index: number) {
    setDraft((current) => {
      const images = current.images.filter((_, i) => i !== index);
      if (images.length && !images.some((img) => img.primary)) {
        images[0] = { ...images[0], primary: true };
      }
      return { ...current, images };
    });
  }

  function toggleLogistics(value: string) {
    setDraft((current) => ({
      ...current,
      logistics: current.logistics.includes(value)
        ? current.logistics.filter((entry) => entry !== value)
        : [...current.logistics, value],
    }));
  }

  function validateStep(current: number): boolean {
    if (current === 1) {
      const nextErrors: { industry?: string; type?: string } = {};
      if (!draft.industry) nextErrors.industry = "Please select an industry.";
      if (!draft.type.trim()) nextErrors.type = "Machinery type is required.";
      setErrors(nextErrors);
      return Object.keys(nextErrors).length === 0;
    }
    return true;
  }

  function goNext() {
    if (!validateStep(step)) return;
    if (step < EPIC3_TOTAL) setStep(step + 1);
  }

  function skip() {
    if (step < EPIC3_TOTAL) setStep(step + 1);
  }

  function handleBack() {
    if (step > 1) {
      setStep(step - 1);
    } else {
      onClose();
      showToast("Draft discarded — nothing was saved.");
    }
  }

  function finish(status: "Draft" | "Published") {
    onPublish(draft, status);
  }

  const summaryRows: { label: string; value: string }[] = [
    {
      label: "Industry / type",
      value: [draft.industry, draft.type].filter(Boolean).join(" — ") || "—",
    },
    {
      label: "Capacity / condition",
      value: [draft.capacity, draft.condition].filter(Boolean).join(" · ") || "—",
    },
    { label: "Images", value: `${draft.images.length} uploaded` },
    { label: "Raw materials", value: draft.rawMatStatus || "—" },
    {
      label: "Labor",
      value:
        [draft.laborType, draft.workerCount ? `${draft.workerCount} workers` : ""]
          .filter(Boolean)
          .join(" · ") || "—",
    },
    { label: "Logistics", value: draft.logistics.join(", ") || "—" },  { label: "Pricing",
      value:
        Object.entries(draft.pricing)
          .filter(([, value]) => value)
          .map(([key, value]) => `${value}/${key}`)
          .join(", ") || "Not set",
    },
  ];

  return (
    <WizardShell
      title="Add Machinery / Service"
      stepLabel={`Step ${step} of ${EPIC3_TOTAL}`}
      progressPct={STEP_LABELS[step - 1]}
      total={EPIC3_TOTAL}
      step={step}
      footer={
        <WizardFooter
          showPrevious
          onPrevious={handleBack}
          onSkip={skip}
          onNext={goNext}
          nextLabel="Save & Next"
        />
      }
    >
      {step === 1 ? (
        <section className="wiz-panel">
          <h2>Machinery details</h2>
          <p className="wiz-intro">Tell buyers exactly what this machine or service is.</p>
          <div className="form-grid">
            <div>
              <label htmlFor="m-industry">Industry</label>
              <select
                id="m-industry"
                className={`${draft.industry ? "" : "placeholder-shown"}${errors.industry ? " error" : ""}`}
                value={draft.industry}
                onChange={(e) => update({ industry: e.target.value })}
              >
                <option value="" disabled>
                  Select
                </option>
                {INDUSTRIES.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              {errors.industry ? <p className="field-error">{errors.industry}</p> : null}
            </div>
            <div>
              <label htmlFor="m-subcategory">Subcategory</label>
              <input
                type="text"
                id="m-subcategory"
                placeholder="e.g. CNC Machining"
                value={draft.subcategory}
                onChange={(e) => update({ subcategory: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="m-type">Machinery type</label>
              <input
                type="text"
                id="m-type"
                placeholder="e.g. 5-axis CNC mill"
                className={errors.type ? "error" : ""}
                value={draft.type}
                onChange={(e) => update({ type: e.target.value })}
              />
              {errors.type ? <p className="field-error">{errors.type}</p> : null}
            </div>
            <div>
              <label htmlFor="m-capacity">Capacity</label>
              <input
                type="text"
                id="m-capacity"
                placeholder="e.g. 200 units/day"
                value={draft.capacity}
                onChange={(e) => update({ capacity: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="m-age">Age</label>
              <input
                type="text"
                id="m-age"
                placeholder="e.g. 3 years"
                value={draft.age}
                onChange={(e) => update({ age: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="m-condition">Condition</label>
              <select
                id="m-condition"
                className={draft.condition ? "" : "placeholder-shown"}
                value={draft.condition}
                onChange={(e) => update({ condition: e.target.value })}
              >
                <option value="" disabled>
                  Select
                </option>
                {CONDITIONS.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label htmlFor="m-technical">Technical details</label>
              <textarea
                id="m-technical"
                rows={3}
                placeholder="Specifications, tolerances, power requirements, etc."
                value={draft.technical}
                onChange={(e) => update({ technical: e.target.value })}
              />
            </div>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="wiz-panel">
          <h2>Add images</h2>
          <p className="wiz-intro">
            Upload photos of the machine. Set one as the primary image.
          </p>
          <div className="upload-box" onClick={() => fileInputRef.current?.click()}>
            <div className="upload-thumb">
              <ImagePhotoIcon size={18} />
            </div>
            <div className="upload-text">
              <b>Upload machinery images</b>
              <span>You can add several — click a thumbnail to set as primary</span>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              multiple
              onChange={(e) => handleImages(e.target.files)}
            />
          </div>
          <div className="img-grid">
            {draft.images.map((img, index) => (
              <div className={`img-thumb${img.primary ? " primary" : ""}`} key={index}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.src} alt="" />
                {img.primary ? (
                  <span className="img-thumb-badge">Primary</span>
                ) : (
                  <button
                    type="button"
                    className="img-thumb-setprimary"
                    onClick={() => setPrimary(index)}
                  >
                    Set primary
                  </button>
                )}
                <button
                  type="button"
                  className="img-thumb-remove"
                  onClick={() => removeImage(index)}
                  aria-label="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <p
            className="field-hint"
            style={{ marginTop: 10 }}
          >
            {draft.images.length === 0
              ? "No images added yet — optional, but listings with photos get more responses."
              : ""}
          </p>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="wiz-panel">
          <h2>Raw materials</h2>
          <p className="wiz-intro">Can you also supply the raw materials for this job?</p>
          <div className="pill-group">
            {["Available", "Not Available", "Partial"].map((option) => (
              <button
                key={option}
                type="button"
                className={`pill-option${draft.rawMatStatus === option ? " active" : ""}`}
                onClick={() => update({ rawMatStatus: option })}
              >
                {option}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 18 }}>
            <label htmlFor="m-material-details">Material details</label>
            <textarea
              id="m-material-details"
              rows={3}
              placeholder="Which materials, grades, or sources are available."
              value={draft.materialDetails}
              onChange={(e) => update({ materialDetails: e.target.value })}
            />
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="wiz-panel">
          <h2>Labor</h2>
          <p className="wiz-intro">What staffing comes with this machine or service?</p>
          <div className="form-grid">
            <div>
              <label>Labor type</label>
              <div className="pill-group">
                {["Skilled", "Unskilled", "Both"].map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`pill-option${draft.laborType === option ? " active" : ""}`}
                    onClick={() => update({ laborType: option })}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="m-worker-count">Number of workers</label>
              <input
                type="number"
                id="m-worker-count"
                min={0}
                placeholder="e.g. 4"
                value={draft.workerCount}
                onChange={(e) => update({ workerCount: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <label htmlFor="m-worker-roles">Worker roles</label>
              <input
                type="text"
                id="m-worker-roles"
                placeholder="e.g. Machine operator, QC inspector, helper"
                value={draft.workerRoles}
                onChange={(e) => update({ workerRoles: e.target.value })}
              />
            </div>
          </div>
        </section>
      ) : null}

      {step === 5 ? (
        <section className="wiz-panel">
          <h2>Logistics</h2>
          <p className="wiz-intro">How far can you ship or deliver?</p>
          <label>Coverage</label>
          <div className="pill-group">
            {["Local", "Outstation", "International"].map((option) => (
              <button
                key={option}
                type="button"
                className={`pill-option${draft.logistics.includes(option) ? " active" : ""}`}
                onClick={() => toggleLogistics(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 18 }}>
            <label htmlFor="m-logistics-partner">
              Logistics partner <span className="optional">(optional)</span>
            </label>
            <input
              type="text"
              id="m-logistics-partner"
              placeholder="e.g. In-house fleet, BlueDart, self-arranged"
              value={draft.logisticsPartner}
              onChange={(e) => update({ logisticsPartner: e.target.value })}
            />
          </div>
        </section>
      ) : null}

      {step === 6 ? (
        <section className="wiz-panel">
          <h2>Pricing &amp; insurance</h2>
          <p className="wiz-intro">
            Set the rates buyers will see. Leave any unused fields blank.
          </p>
          <div className="form-grid">
            <div>
              <label htmlFor="price-hour">Hourly rate</label>
              <input
                type="text"
                id="price-hour"
                placeholder="₹ per hour"
                value={draft.pricing.hour}
                onChange={(e) => update({ pricing: { ...draft.pricing, hour: e.target.value } })}
              />
            </div>
            <div>
              <label htmlFor="price-day">Daily rate</label>
              <input
                type="text"
                id="price-day"
                placeholder="₹ per day"
                value={draft.pricing.day}
                onChange={(e) => update({ pricing: { ...draft.pricing, day: e.target.value } })}
              />
            </div>
            <div>
              <label htmlFor="price-month">Monthly rate</label>
              <input
                type="text"
                id="price-month"
                placeholder="₹ per month"
                value={draft.pricing.month}
                onChange={(e) => update({ pricing: { ...draft.pricing, month: e.target.value } })}
              />
            </div>
            <div>
              <label htmlFor="price-unit">Per-unit rate</label>
              <input
                type="text"
                id="price-unit"
                placeholder="₹ per unit"
                value={draft.pricing.unit}
                onChange={(e) => update({ pricing: { ...draft.pricing, unit: e.target.value } })}
              />
            </div>
            <div className="col-span-2">
              <label htmlFor="price-batch">Per-batch rate</label>
              <input
                type="text"
                id="price-batch"
                placeholder="₹ per batch"
                value={draft.pricing.batch}
                onChange={(e) => update({ pricing: { ...draft.pricing, batch: e.target.value } })}
              />
            </div>
            <div className="col-span-2">
              <label htmlFor="m-insurance">Insurance &amp; liability details</label>
              <textarea
                id="m-insurance"
                rows={3}
                placeholder="Coverage details, liability terms, certificates on request."
                value={draft.insurance}
                onChange={(e) => update({ insurance: e.target.value })}
              />
            </div>
          </div>
        </section>
      ) : null}

      {step === 7 ? (
        <section className="wiz-panel">
          <h2>Publish listing</h2>
          <p className="wiz-intro">Review your choice, then save it the way you&apos;d like.</p>
          <div className="details-grid">
            {summaryRows.map((row) => (
              <div className="detail-item" key={row.label}>
                <p className="detail-label">{row.label}</p>
                <p className="detail-value">{row.value}</p>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 26 }}>
            <button
              type="button"
              className="btn-secondary-full"
              style={{ width: "auto", flex: 1 }}
              onClick={() => finish("Draft")}
            >
              Save as Draft
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ flex: 1 }}
              onClick={() => finish("Published")}
            >
              Publish
            </button>
          </div>
        </section>
      ) : null}
    </WizardShell>
  );
}

export type { MachineryDraft };
