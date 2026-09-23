import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { CheckIcon, DownloadIcon, ImagePhotoIcon, MapPinIcon } from "@/components/manufacturer/icons";
import { WizardFooter, WizardShell } from "@/components/manufacturer/WizardShell";
import type { Certification, FaqEntry } from "@/lib/manufacturer/types";

export type ProfileWizardData = {
  company: {
    name: string;
    logo: string | null;
    cover: string | null;
    about: string;
    vision: string;
    estYear: string;
    employees: string;
    businessType: string;
    orgSize: string;
  };
  location: {
    address: string;
    city: string;
    state: string;
    country: string;
    zip: string;
    pin: string | null;
    sez: string;
    serviceableAreas: string[];
  };
  certifications: Certification[];
  infra: {
    electricity: string;
    water: string;
    storage: string;
    packaging: string;
    waste: string;
    qa: string;
  };
  faqs: FaqEntry[];
};

export type ProfileCompletionFlags = {
  companyDetailsDone: boolean;
  locationDone: boolean;
  certsDone: boolean;
  infraDone: boolean;
  faqDone: boolean;
};

export const CHECKLIST_ITEMS: { key: keyof ProfileCompletionFlags; label: string }[] = [
  { key: "companyDetailsDone", label: "Company Details" },
  { key: "locationDone", label: "Location" },
  { key: "certsDone", label: "Certifications" },
  { key: "infraDone", label: "Infrastructure" },
  { key: "faqDone", label: "FAQ" },
];

export function createBlankProfileData(companyName = ""): ProfileWizardData {
  return {
    company: {
      name: companyName,
      logo: null,
      cover: null,
      about: "",
      vision: "",
      estYear: "",
      employees: "",
      businessType: "",
      orgSize: "",
    },
    location: {
      address: "",
      city: "",
      state: "",
      country: "",
      zip: "",
      pin: null,
      sez: "Not in SEZ",
      serviceableAreas: [],
    },
    certifications: [],
    infra: {
      electricity: "",
      water: "",
      storage: "",
      packaging: "",
      waste: "",
      qa: "",
    },
    faqs: [],
  };
}

/** Mirrors the demo's weighted completion score (base 15% + up to 85%). */
export function computeProfilePct(flags: ProfileCompletionFlags): number {
  const doneCount = CHECKLIST_ITEMS.filter((item) => flags[item.key]).length;
  return Math.round(15 + (doneCount / CHECKLIST_ITEMS.length) * 85);
}

type ProfileWizardProps = {
  firstName: string;
  flags: ProfileCompletionFlags;
  pct: number;
  initialStep: number;
  data: ProfileWizardData;
  onChange: (data: ProfileWizardData) => void;
  onExit: () => void;
  onFinish: () => void;
  showToast: (message: string) => void;
};

const EPIC2_TOTAL = 5;

const BUSINESS_TYPES = ["Proprietorship", "Partnership", "Private Limited", "Public Limited", "LLP", "Other"];
const ORG_SIZES = [
  "Micro (1–9 employees)",
  "Small (10–49 employees)",
  "Medium (50–249 employees)",
  "Large (250+ employees)",
];
const COUNTRIES = ["India", "United States", "United Kingdom", "United Arab Emirates", "Germany", "China", "Other"];
const SEZ_OPTIONS = ["Not in SEZ", "Within SEZ", "SEZ pending approval"];

export function ProfileWizard({
  firstName,
  flags,
  pct,
  initialStep,
  data,
  onChange,
  onExit,
  onFinish,
  showToast,
}: ProfileWizardProps) {
  const [step, setStep] = useState(initialStep);
  const [company, setCompany] = useState(data.company);
  const [location, setLocation] = useState(data.location);
  const [certifications, setCertifications] = useState(data.certifications);
  const [infra, setInfra] = useState(data.infra);
  const [faqs, setFaqs] = useState(data.faqs);

  // Local validation state
  const [companyErrors, setCompanyErrors] = useState<{ name?: string; about?: string }>({});
  const [locationErrors, setLocationErrors] = useState<{ address?: string; city?: string; country?: string }>({});
  const [certError, setCertError] = useState("");
  const [faqError, setFaqError] = useState("");

  // Step 4 inputs
  const [certName, setCertName] = useState("");
  const [certBody, setCertBody] = useState("");
  const [certFileName, setCertFileName] = useState("");
  // Step 5 inputs
  const [faqQ, setFaqQ] = useState("");
  const [faqA, setFaqA] = useState("");

  const tagInputRef = useRef<HTMLInputElement>(null);

  function persist(next: Partial<{ company: typeof company; location: typeof location; certifications: Certification[]; infra: typeof infra; faqs: FaqEntry[] }> = {}) {
    onChange({
      company: next.company ?? company,
      location: next.location ?? location,
      certifications: next.certifications ?? certifications,
      infra: next.infra ?? infra,
      faqs: next.faqs ?? faqs,
    });
  }

  function readFile(file: File, apply: (dataUrl: string) => void) {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === "string") {
        apply(event.target.result);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleCompanyFile(event: ChangeEvent<HTMLInputElement>, key: "logo" | "cover") {
    const file = event.target.files?.[0];
    if (!file) return;
    readFile(file, (dataUrl) => {
      setCompany((current) => ({ ...current, [key]: dataUrl }));
    });
  }

  function validateStep(current: number): boolean {
    if (current === 2) {
      const errors: { name?: string; about?: string } = {};
      if (!company.name.trim()) errors.name = "Company name is required.";
      if (!company.about.trim()) errors.about = "Tell buyers a little about your company.";
      setCompanyErrors(errors);
      return Object.keys(errors).length === 0;
    }
    if (current === 3) {
      const errors: { address?: string; city?: string; country?: string } = {};
      if (!location.address.trim()) errors.address = "Facility address is required.";
      if (!location.city.trim()) errors.city = "City is required.";
      if (!location.country) errors.country = "Please select a country.";
      setLocationErrors(errors);
      return Object.keys(errors).length === 0;
    }
    return true;
  }

  function goNext() {
    if (!validateStep(step)) return;
    const nextData: ProfileWizardData = { company, location, certifications, infra, faqs };
    persist(nextData);
    if (step < EPIC2_TOTAL) {
      setStep(step + 1);
    } else {
      onExit();
      showToast("Company profile updated.");
      onFinish();
    }
  }

  function skip() {
    if (step < EPIC2_TOTAL) {
      setStep(step + 1);
    } else {
      onExit();
      showToast("Skipped — you can finish this anytime from the checklist.");
      onFinish();
    }
  }

  function handleBack() {
    if (step > 1) {
      setStep(step - 1);
    } else {
      persist();
      onExit();
      showToast("Progress saved — pick up where you left off any time.");
    }
  }

  function addCertification() {
    if (!certName.trim() || !certBody.trim()) {
      setCertError("Certification name and issuing body are both required.");
      return;
    }
    setCertError("");
    const next: Certification[] = [
      ...certifications,
      { name: certName.trim(), body: certBody.trim(), fileName: certFileName, status: "Pending" as const },
    ];
    setCertifications(next);
    setCertName("");
    setCertBody("");
    setCertFileName("");
    persist({ certifications: next });
    showToast("Certification added — pending review.");
  }

  function removeCertification(index: number) {
    const next = certifications.filter((_, i) => i !== index);
    setCertifications(next);
    persist({ certifications: next });
  }

  function addFaq() {
    if (!faqQ.trim() || !faqA.trim()) {
      setFaqError("Please fill in both a question and an answer.");
      return;
    }
    setFaqError("");
    const next: FaqEntry[] = [...faqs, { q: faqQ.trim(), a: faqA.trim() }];
    setFaqs(next);
    setFaqQ("");
    setFaqA("");
    persist({ faqs: next });
    showToast("FAQ added.");
  }

  function removeFaq(index: number) {
    const next = faqs.filter((_, i) => i !== index);
    setFaqs(next);
    persist({ faqs: next });
  }

  function handleTagKeydown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      const value = event.currentTarget.value.trim().replace(/,$/, "");
      if (value && !location.serviceableAreas.includes(value)) {
        const next = { ...location, serviceableAreas: [...location.serviceableAreas, value] };
        setLocation(next);
        persist({ location: next });
      }
      event.currentTarget.value = "";
    } else if (event.key === "Backspace" && !event.currentTarget.value && location.serviceableAreas.length) {
      const next = {
        ...location,
        serviceableAreas: location.serviceableAreas.slice(0, -1),
      };
      setLocation(next);
      persist({ location: next });
    }
  }

  function removeTag(index: number) {
    const next = {
      ...location,
      serviceableAreas: location.serviceableAreas.filter((_, i) => i !== index),
    };
    setLocation(next);
    persist({ location: next });
  }

  function pinMapLocation() {
    const lat = (12.5 + Math.random() * 3).toFixed(4);
    const lng = (78 + Math.random() * 3).toFixed(4);
    const next = { ...location, pin: `${lat}, ${lng}` };
    setLocation(next);
    persist({ location: next });
    showToast("Location pinned on the map.");
  }

  function setSez(value: string) {
    const next = { ...location, sez: value };
    setLocation(next);
    persist({ location: next });
  }

  const doneCount = CHECKLIST_ITEMS.filter((item) => flags[item.key]).length;

  return (
    <WizardShell
      title="Company & Facility Profile"
      badge={`${pct}% complete`}
      stepLabel={`Step ${step} of ${EPIC2_TOTAL}`}
      progressPct={`${Math.round((doneCount / EPIC2_TOTAL) * 100)}% Complete`}
      total={EPIC2_TOTAL}
      step={step}
      footer={
        <WizardFooter
          showPrevious
          onPrevious={handleBack}
          onSkip={skip}
          onNext={goNext}
          nextLabel={
            step === 1 ? "Get started" : step === EPIC2_TOTAL ? "Finish" : "Save & Next"
          }
        />
      }
    >
      {step === 1 ? (
        <section className="wiz-panel">
          <h2>Welcome{firstName ? `, ${firstName}` : ""} to your Company Profile</h2>
          <p className="wiz-intro">
            A complete profile helps buyers trust and find you faster. Here&apos;s where things
            stand.
          </p>
          {CHECKLIST_ITEMS.map((item) => (
            <div className="wiz-check-row" key={item.key}>
              <div className={`wiz-check-icon${flags[item.key] ? " done" : ""}`}>
                {flags[item.key] ? <CheckIcon size={12} /> : null}
              </div>
              <div className="wiz-check-text">
                <b>{item.label}</b>
                <span>{STEP_DESCRIPTIONS[item.key]}</span>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {step === 2 ? (
        <section className="wiz-panel">
          <h2>Company details</h2>
          <p className="wiz-intro">Tell buyers who you are.</p>
          <div className="form-grid">
            <div className="col-span-2">
              <label htmlFor="cd-name">Company name</label>
              <input
                type="text"
                id="cd-name"
                placeholder="Acme Manufacturing Co."
                className={companyErrors.name ? "error" : ""}
                value={company.name}
                onChange={(e) => setCompany({ ...company, name: e.target.value })}
              />
              {companyErrors.name ? <p className="field-error">{companyErrors.name}</p> : null}
            </div>
            <div>
              <label>Logo</label>
              <div
                className="upload-box"
                onClick={() => document.getElementById("cd-logo")?.click()}
              >
                <div className="upload-thumb">
                  {company.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={company.logo} alt="" />
                  ) : (
                    <ChartMark />
                  )}
                </div>
                <div className="upload-text">
                  <b>Upload logo</b>
                  <span>PNG or JPG, square works best</span>
                </div>
                <input
                  type="file"
                  id="cd-logo"
                  accept="image/*"
                  onChange={(e) => handleCompanyFile(e, "logo")}
                />
              </div>
            </div>
            <div>
              <label>Cover image</label>
              <div
                className="upload-box"
                onClick={() => document.getElementById("cd-cover")?.click()}
              >
                <div className="upload-thumb">
                  {company.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={company.cover} alt="" />
                  ) : (
                    <ImagePhotoIcon size={18} />
                  )}
                </div>
                <div className="upload-text">
                  <b>Upload cover image</b>
                  <span>Shown at the top of your public profile</span>
                </div>
                <input
                  type="file"
                  id="cd-cover"
                  accept="image/*"
                  onChange={(e) => handleCompanyFile(e, "cover")}
                />
              </div>
            </div>
            <div className="col-span-2">
              <label htmlFor="cd-about">About company</label>
              <textarea
                id="cd-about"
                rows={3}
                placeholder="What you make, who you serve, and what sets you apart."
                className={companyErrors.about ? "error" : ""}
                value={company.about}
                onChange={(e) => setCompany({ ...company, about: e.target.value })}
              />
              {companyErrors.about ? <p className="field-error">{companyErrors.about}</p> : null}
            </div>
            <div className="col-span-2">
              <label htmlFor="cd-vision">Vision &amp; Mission</label>
              <textarea
                id="cd-vision"
                rows={2}
                placeholder="Your company's vision and mission statement."
                value={company.vision}
                onChange={(e) => setCompany({ ...company, vision: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="cd-est-year">Establishment year</label>
              <input
                type="number"
                id="cd-est-year"
                placeholder="e.g. 2010"
                min={1900}
                max={2026}
                value={company.estYear}
                onChange={(e) => setCompany({ ...company, estYear: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="cd-employees">Employees</label>
              <input
                type="number"
                id="cd-employees"
                placeholder="e.g. 120"
                min={0}
                value={company.employees}
                onChange={(e) => setCompany({ ...company, employees: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="cd-business-type">Business type</label>
              <select
                id="cd-business-type"
                className={company.businessType ? "" : "placeholder-shown"}
                value={company.businessType}
                onChange={(e) => setCompany({ ...company, businessType: e.target.value })}
              >
                <option value="" disabled>
                  Select a type
                </option>
                {BUSINESS_TYPES.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cd-org-size">Organization size</label>
              <select
                id="cd-org-size"
                className={company.orgSize ? "" : "placeholder-shown"}
                value={company.orgSize}
                onChange={(e) => setCompany({ ...company, orgSize: e.target.value })}
              >
                <option value="" disabled>
                  Select a size
                </option>
                {ORG_SIZES.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </div>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="wiz-panel">
          <h2>Location</h2>
          <p className="wiz-intro">Buyers use this to gauge proximity and logistics.</p>
          <div className="form-grid">
            <div className="col-span-2">
              <label htmlFor="loc-address">Company address</label>
              <input
                type="text"
                id="loc-address"
                placeholder="Street address"
                className={locationErrors.address ? "error" : ""}
                value={location.address}
                onChange={(e) => setLocation({ ...location, address: e.target.value })}
              />
              {locationErrors.address ? (
                <p className="field-error">{locationErrors.address}</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="loc-city">City</label>
              <input
                type="text"
                id="loc-city"
                className={locationErrors.city ? "error" : ""}
                value={location.city}
                onChange={(e) => setLocation({ ...location, city: e.target.value })}
              />
              {locationErrors.city ? <p className="field-error">{locationErrors.city}</p> : null}
            </div>
            <div>
              <label htmlFor="loc-state">State</label>
              <input
                type="text"
                id="loc-state"
                value={location.state}
                onChange={(e) => setLocation({ ...location, state: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="loc-country">Country</label>
              <select
                id="loc-country"
                className={`${location.country ? "" : "placeholder-shown"}${locationErrors.country ? " error" : ""}`}
                value={location.country}
                onChange={(e) => setLocation({ ...location, country: e.target.value })}
              >
                <option value="" disabled>
                  Select a country
                </option>
                {COUNTRIES.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              {locationErrors.country ? (
                <p className="field-error">{locationErrors.country}</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="loc-zip">ZIP / postal code</label>
              <input
                type="text"
                id="loc-zip"
                value={location.zip}
                onChange={(e) => setLocation({ ...location, zip: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <label>Map location</label>
              <div className="upload-box" style={{ cursor: "default" }}>
                <div className="upload-thumb" style={{ background: "var(--blue-50)", color: "var(--blue-600)" }}>
                  <MapPinIcon size={18} />
                </div>
                <div className="upload-text" style={{ flex: 1 }}>
                  <b>{location.pin ? `Pinned at ${location.pin}` : "No location pinned yet"}</b>
                  <span>Drop a pin so buyers can see you on the map</span>
                </div>
                <button type="button" className="btn-ghost" onClick={pinMapLocation}>
                  Pin current address
                </button>
              </div>
            </div>
            <div className="col-span-2">
              <label>SEZ status</label>
              <div className="pill-group">
                {SEZ_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`pill-option${location.sez === option ? " active" : ""}`}
                    onClick={() => setSez(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div className="col-span-2">
              <label htmlFor="serviceable-input">Serviceable areas</label>
              <div
                className="tag-input-box"
                onClick={() => tagInputRef.current?.focus()}
              >
                <div>
                  {location.serviceableAreas.map((tag, index) => (
                    <span className="tag-chip" key={`${tag}-${index}`}>
                      {tag}
                      <button type="button" onClick={() => removeTag(index)} aria-label={`Remove ${tag}`}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  id="serviceable-input"
                  ref={tagInputRef}
                  placeholder="Type a city/region and press Enter"
                  onKeyDown={handleTagKeydown}
                />
              </div>
              <p className="field-hint">e.g. Chennai, Tamil Nadu, South India</p>
            </div>
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="wiz-panel">
          <h2>Certifications</h2>
          <p className="wiz-intro">
            Add certifications so buyers know your quality standards are verified (optional).
          </p>
          <div>
            {certifications.map((cert, index) => (
              <div className="cert-item" key={`${cert.name}-${index}`}>
                <div className="cert-item-main">
                  <b>{cert.name}</b>
                  <span>
                    {cert.body}
                    {cert.fileName ? ` · ${cert.fileName}` : ""}
                  </span>
                </div>
                <div className="item-actions">
                  <span className="badge badge-pending">{cert.status}</span>
                  <button type="button" className="btn-danger-ghost" onClick={() => removeCertification(index)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="card" style={{ background: "var(--slate-50)", boxShadow: "none" }}>
            <div className="form-grid">
              <div>
                <label htmlFor="cert-name">Certification name</label>
                <input
                  type="text"
                  id="cert-name"
                  placeholder="ISO 9001:2015"
                  value={certName}
                  onChange={(e) => setCertName(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="cert-body">Issuing body</label>
                <input
                  type="text"
                  id="cert-body"
                  value={certBody}
                  onChange={(e) => setCertBody(e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <label>Upload document</label>
                <div className="upload-box" onClick={() => document.getElementById("cert-file")?.click()}>
                  <div className="upload-thumb">
                    <DownloadIcon size={18} />
                  </div>
                  <div className="upload-text">
                    <b>{certFileName || "Upload certificate (PDF or image)"}</b>
                    <span>Reviewed by our team before it shows as verified</span>
                  </div>
                  <input
                    type="file"
                    id="cert-file"
                    accept="application/pdf,image/*"
                    onChange={(e) => setCertFileName(e.target.files?.[0]?.name ?? "")}
                  />
                </div>
              </div>
            </div>
            {certError ? <p className="field-error">{certError}</p> : null}
            <button
              type="button"
              className="btn-secondary-full"
              style={{ marginTop: 16 }}
              onClick={addCertification}
            >
              + Add certification
            </button>
          </div>
        </section>
      ) : null}

      {step === 5 ? (
        <section className="wiz-panel">
          <h2>Infrastructure &amp; FAQ</h2>
          <p className="wiz-intro">
            Describe your facility&apos;s infrastructure, then answer questions buyers commonly ask.
          </p>
          <p className="wiz-subhead">Infrastructure</p>
          <div className="form-grid">
            <div>
              <label htmlFor="infra-electricity">Electricity</label>
              <select
                id="infra-electricity"
                className={infra.electricity ? "" : "placeholder-shown"}
                value={infra.electricity}
                onChange={(e) => setInfra({ ...infra, electricity: e.target.value })}
              >
                <option value="" disabled>
                  Select
                </option>
                {["Grid + backup generator", "Grid only", "Solar + grid", "Not available"].map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="infra-water">Water</label>
              <select
                id="infra-water"
                className={infra.water ? "" : "placeholder-shown"}
                value={infra.water}
                onChange={(e) => setInfra({ ...infra, water: e.target.value })}
              >
                <option value="" disabled>
                  Select
                </option>
                {["Municipal supply", "Borewell", "Municipal + borewell", "Not available"].map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="infra-storage">Storage</label>
              <select
                id="infra-storage"
                className={infra.storage ? "" : "placeholder-shown"}
                value={infra.storage}
                onChange={(e) => setInfra({ ...infra, storage: e.target.value })}
              >
                <option value="" disabled>
                  Select
                </option>
                {["Cold storage", "Dry storage", "Both cold & dry storage", "None"].map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="infra-packaging">Packaging</label>
              <select
                id="infra-packaging"
                className={infra.packaging ? "" : "placeholder-shown"}
                value={infra.packaging}
                onChange={(e) => setInfra({ ...infra, packaging: e.target.value })}
              >
                <option value="" disabled>
                  Select
                </option>
                {["In-house packaging", "Outsourced", "Not offered"].map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="infra-waste">Waste disposal</label>
              <select
                id="infra-waste"
                className={infra.waste ? "" : "placeholder-shown"}
                value={infra.waste}
                onChange={(e) => setInfra({ ...infra, waste: e.target.value })}
              >
                <option value="" disabled>
                  Select
                </option>
                {["Licensed waste vendor", "Municipal disposal", "On-site treatment", "Not applicable"].map(
                  (option) => (
                    <option key={option}>{option}</option>
                  ),
                )}
              </select>
            </div>
            <div>
              <label htmlFor="infra-qa">Quality assurance</label>
              <input
                type="text"
                id="infra-qa"
                placeholder="e.g. In-house QA lab, batch testing"
                value={infra.qa}
                onChange={(e) => setInfra({ ...infra, qa: e.target.value })}
              />
            </div>
          </div>
          <div className="wiz-divider" />
          <p className="wiz-subhead">Frequently asked questions</p>
          <div>
            {faqs.map((faq, index) => (
              <div className="faq-item" key={`${faq.q}-${index}`}>
                <div className="faq-item-main">
                  <b>{faq.q}</b>
                  <p>{faq.a}</p>
                </div>
                <div className="item-actions">
                  <button type="button" className="btn-danger-ghost" onClick={() => removeFaq(index)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="card" style={{ background: "var(--slate-50)", boxShadow: "none" }}>
            <div className="form-grid">
              <div className="col-span-2">
                <label htmlFor="faq-q">Question</label>
                <input
                  type="text"
                  id="faq-q"
                  placeholder="e.g. What is your minimum order quantity?"
                  value={faqQ}
                  onChange={(e) => setFaqQ(e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <label htmlFor="faq-a">Answer</label>
                <textarea
                  id="faq-a"
                  rows={2}
                  placeholder="Your answer"
                  value={faqA}
                  onChange={(e) => setFaqA(e.target.value)}
                />
              </div>
            </div>
            {faqError ? <p className="field-error">{faqError}</p> : null}
            <button type="button" className="btn-secondary-full" style={{ marginTop: 16 }} onClick={addFaq}>
              + Add FAQ
            </button>
          </div>
        </section>
      ) : null}
    </WizardShell>
  );
}

const STEP_DESCRIPTIONS: Record<keyof ProfileCompletionFlags, string> = {
  companyDetailsDone: "Name, logo, cover image, about, vision & mission",
  locationDone: "Address, map location, SEZ status, serviceable areas",
  certsDone: "Add and upload your certifications for verification",
  infraDone: "Electricity, water, storage, packaging, waste, QA",
  faqDone: "Answer common questions buyers ask",
};

function ChartMark() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 16l5-6 4 4 7-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
