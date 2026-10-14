import { useEffect, useRef, useState, type FormEvent } from "react";

import type { CompanyDetails, CompanySearchResult } from "@/lib/api";
import { FactoryMark } from "@/components/layout/Logo";
import {
  BackIcon,
  BuildingIcon,
  CalendarIcon,
  CapacityIcon,
  CategoryIcon,
  GlobeIcon,
  GridIcon,
  MailIcon,
  PhoneIcon,
  PlusCircleIcon,
  StarIcon,
  UserIcon,
} from "@/components/manufacturer/icons";
import { isValidEmail, isValidPhone } from "@/lib/manufacturer/types";

export type AccountSubmission = {
  firstName: string;
  lastName: string;
  contact: string;
  dob: string;
  companyName: string;
  companyType: string;
  country: string;
  phone: string;
  capacity: string;
  /** Database id of the company chosen from the search list; null = a new company. */
  companyId?: string | null;
};

type AccountScreenProps = {
  onBack: () => void;
  /** May return a promise; if it rejects, the form is re-enabled so the user can retry. */
  onAccountCreated: (submission: AccountSubmission) => void | Promise<void>;
  onSearchCompanies: (query: string) => Promise<CompanySearchResult[]>;
  /** Saved details of exactly the selected record (read-only; selecting grants nothing). */
  onLoadCompany?: (companyId: string) => Promise<CompanyDetails>;
  /** Prefill when correcting details already submitted for approval. */
  initial?: Partial<AccountSubmission>;
};

type PrefillKey = "companyType" | "country" | "phone" | "capacity";

const MUTED = { padding: 12, color: "#64748b" } as const;

function companyLocation(company: { city?: string | null; state?: string | null; country?: string | null }) {
  return [company.city, company.state, company.country].filter((part) => part && part.trim()).join(", ");
}

type FieldErrors = Partial<
  Record<
    | "firstName"
    | "lastName"
    | "contact"
    | "dob"
    | "companyName"
    | "companyType"
    | "country"
    | "phone"
    | "agree",
    string
  >
>;

const COMPANY_TYPES = [
  "Textile & Apparel",
  "Electronics & Hardware",
  "Food & Beverage",
  "Automotive & Machinery",
  "Furniture & Woodwork",
  "Chemicals & Plastics",
  "Pharmaceuticals & Healthcare",
  "Packaging & Printing",
  "Other",
];

const COUNTRIES = [
  "India",
  "United States",
  "United Kingdom",
  "United Arab Emirates",
  "Germany",
  "China",
  "Vietnam",
  "Bangladesh",
  "Other",
];

export function AccountScreen({ onBack, onAccountCreated, onSearchCompanies, onLoadCompany, initial }: AccountScreenProps) {
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  const [contact, setContact] = useState(initial?.contact ?? "");
  const [dob, setDob] = useState(initial?.dob ?? "");
  const [companyName, setCompanyName] = useState(initial?.companyName ?? "");
  const [companySuggestions, setCompanySuggestions] = useState<CompanySearchResult[]>([]);
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false);
  const [companySearchLoading, setCompanySearchLoading] = useState(false);
  
  const companySearchRef = useRef<HTMLDivElement>(null);
  const [companyType, setCompanyType] = useState(
    initial?.companyType && COMPANY_TYPES.includes(initial.companyType) ? initial.companyType : "");
  const [country, setCountry] = useState(initial?.country && COUNTRIES.includes(initial.country) ? initial.country : "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [capacity, setCapacity] = useState(initial?.capacity ?? "");
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showFormError, setShowFormError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [companySearchError, setCompanySearchError] = useState("");
  /** The company picked from the list (its database id). Cleared whenever the text changes. */
  /** The text whose search finished (so "no matches" is never shown before a search ran). */
  const [searchedQuery, setSearchedQuery] = useState("");
  const [selectedCompany, setSelectedCompany] = useState<{ id: string; name: string } | null>(
    initial?.companyId && initial.companyName ? { id: initial.companyId, name: initial.companyName } : null);
  const [companyDetailsStatus, setCompanyDetailsStatus] = useState<"idle" | "loading" | "error">("idle");
  /** Values copied from the selected record, so they can be removed again when it changes. */
  const prefilled = useRef<Partial<Record<PrefillKey, string>>>({});
  /** Ignores a details response that arrives after the selection changed. */
  const detailsRequest = useRef(0);

  const fieldSetters: Record<PrefillKey, (value: string) => void> = {
    companyType: setCompanyType,
    country: setCountry,
    phone: setPhone,
    capacity: setCapacity,
  };
  const currentValues: Record<PrefillKey, string> = { companyType, country, phone, capacity };

  /** Drop the previous selection and any details that came from it (user edits are kept). */
  function clearCompanySelection() {
    detailsRequest.current += 1;
    for (const [key, value] of Object.entries(prefilled.current) as [PrefillKey, string][]) {
      if (currentValues[key] === value) fieldSetters[key]("");
    }
    prefilled.current = {};
    setSelectedCompany(null);
    setCompanyDetailsStatus("idle");
  }

  async function selectCompany(company: CompanySearchResult) {
    clearCompanySelection();
    setCompanyName(company.companyName);
    setCompanyDropdownOpen(false);
    setSelectedCompany({ id: company.id, name: company.companyName });
    if (!onLoadCompany) return;
    const requestId = ++detailsRequest.current;
    setCompanyDetailsStatus("loading");
    try {
      const details = await onLoadCompany(company.id);
      if (requestId !== detailsRequest.current) return; // selection changed meanwhile
      const next: Partial<Record<PrefillKey, string>> = {};
      if (COMPANY_TYPES.includes(details.companyType)) next.companyType = details.companyType;
      if (COUNTRIES.includes(details.country)) next.country = details.country;
      if (details.phone) next.phone = details.phone;
      if (details.capacity) next.capacity = details.capacity;
      for (const [key, value] of Object.entries(next) as [PrefillKey, string][]) fieldSetters[key](value);
      prefilled.current = next;
      setCompanyDetailsStatus("idle");
    } catch {
      if (requestId !== detailsRequest.current) return;
      // Never keep a selection whose saved details could not be read.
      setSelectedCompany(null);
      setCompanyDetailsStatus("error");
    }
  }

  useEffect(() => {
  const query = companyName.trim();

  if (query.length < 2 || !companyDropdownOpen) {
    return;
  }

  let cancelled = false;

  const timer = window.setTimeout(async () => {
  setCompanySearchLoading(true);
  setCompanySearchError("");

  try {
    const companies = await onSearchCompanies(query);

    if (!cancelled) {
      // Each result is a separate record (same name in another location stays separate).
      setCompanySuggestions(companies);
      setSearchedQuery(query);
    }
  } catch {
    if (!cancelled) {
      setCompanySuggestions([]);
      setCompanySearchError("Unable to search companies.");
    }
  } finally {
    if (!cancelled) {
      setCompanySearchLoading(false);
    }
  }
}, 300);

return () => {
  cancelled = true;
  window.clearTimeout(timer);
};
}, [companyName, companyDropdownOpen, onSearchCompanies]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: FieldErrors = {};
    if (!firstName.trim()) nextErrors.firstName = "First name is required.";
    if (!lastName.trim()) nextErrors.lastName = "Last name is required.";
    if (!contact.trim()) {
      nextErrors.contact = "Enter your email or phone number.";
    } else if (!isValidEmail(contact.trim()) && !isValidPhone(contact.replace(/\D/g, ""))) {
      nextErrors.contact = "Enter a valid email address or 10-digit phone number.";
    }
    if (!dob) nextErrors.dob = "Enter your date of birth.";
    if (!companyName.trim()) nextErrors.companyName = "Enter your company name.";
    else if (companyDetailsStatus === "loading") nextErrors.companyName = "Loading the selected company's details…";
    if (!companyType) nextErrors.companyType = "Select a company category.";
    if (!country) nextErrors.country = "Select your country.";
    if (phone.trim() && !/^[0-9+\-\s()]{7,15}$/.test(phone.trim())) {
      nextErrors.phone = "Enter a valid phone number.";
    }
    if (!agree) nextErrors.agree = "You must agree to continue.";

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setShowFormError(true);
      return;
    }
    setShowFormError(false);
    setSubmitting(true);

    // Matches the demo's short "Creating account…" pause before entering the dashboard.
    window.setTimeout(() => {
      Promise.resolve(onAccountCreated({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        contact: contact.trim(),
        dob,
        companyName: companyName.trim(),
        companyType,
        country,
        phone: phone.trim(),
        capacity: capacity.trim(),
        companyId: selectedCompany?.id ?? null,
      })).catch(() => setSubmitting(false));
    }, 700);
  }

  return (
    <div className="account-profile-page">
      <aside className="account-side-panel">
        <div className="account-side-logo">
          <FactoryMark className="account-side-factory-mark" />
          <span>X!Y</span>
        </div>

        <div className="account-side-content">
          <span className="account-side-eyebrow">Manufacturer</span>
          <h1 className="account-side-title">Join the ecosystem</h1>
          <p className="account-side-desc">
            Set up your Manufacturer account to get discovered by buyers, connect
            with suppliers, and access production opportunities matched to what you
            make.
          </p>

          <ul className="account-benefits">
            <li className="account-benefit">
              <div className="account-benefit-icon">
                <StarIcon size={16} />
              </div>
              <div>
                <h4>Get discovered</h4>
                <p>Buyers and vendors find you based on your capabilities.</p>
              </div>
            </li>
            <li className="account-benefit">
              <div className="account-benefit-icon">
                <GridIcon size={16} />
              </div>
              <div>
                <h4>List your capacity</h4>
                <p>Show what you can produce and at what volume.</p>
              </div>
            </li>
            <li className="account-benefit">
              <div className="account-benefit-icon">
                <PlusCircleIcon size={16} />
              </div>
              <div>
                <h4>One account, every role</h4>
                <p>Add Vendor, Investor, or other roles anytime.</p>
              </div>
            </li>
          </ul>
        </div>
      </aside>

      <main className="account-form-panel">
        <button
          className="icon-btn"
          type="button"
          title="Back"
          aria-label="Back"
          onClick={onBack}
          style={{ position: "absolute", top: 20, left: 20 }}
        >
          <BackIcon size={16} />
        </button>

        <div className="account-form-wrap">
          <div className="account-form-header">
            <p className="account-form-eyebrow">Create account</p>
            <h1 className="account-form-title">Set up your Manufacturer profile</h1>
            <p className="account-form-subtitle">
              It takes about 2 minutes. You can complete your full profile after
              signing up.
            </p>
            <p className="account-required-note">
              Only the fields marked as required are needed to continue — everything
              else can be added later.
            </p>
          </div>

          <form className="account-card" noValidate onSubmit={handleSubmit}>
            <section className="account-section">
              <div className="account-section-heading">
                <span className="account-section-num">1</span>
                <h2>Personal info</h2>
              </div>
              <div className="form-grid">
                <div>
                  <label htmlFor="acc-first">First name</label>
                  <div className="account-input-wrap">
                    <span className="input-icon">
                      <UserIcon size={16} />
                    </span>
                    <input
                      type="text"
                      id="acc-first"
                      placeholder="Jordan"
                      className={errors.firstName ? "error" : ""}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  {errors.firstName ? (
                    <p className="field-error">{errors.firstName}</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="acc-last">Last name</label>
                  <div className="account-input-wrap">
                    <span className="input-icon">
                      <UserIcon size={16} />
                    </span>
                    <input
                      type="text"
                      id="acc-last"
                      placeholder="Lee"
                      className={errors.lastName ? "error" : ""}
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                  {errors.lastName ? (
                    <p className="field-error">{errors.lastName}</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="acc-contact">Email or phone number</label>
                  <div className="account-input-wrap">
                    <span className="input-icon">
                      <MailIcon size={16} />
                    </span>
                    <input
                      type="text"
                      id="acc-contact"
                      placeholder="you@company.com or 10-digit phone"
                      autoComplete="email"
                      className={errors.contact ? "error" : ""}
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                    />
                  </div>
                  {errors.contact ? (
                    <p className="field-error">{errors.contact}</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="acc-dob">Date of birth</label>
                  <div className="account-input-wrap">
                    <span className="input-icon">
                      <CalendarIcon size={16} />
                    </span>
                    <input
                      type="date"
                      id="acc-dob"
                      className={errors.dob ? "error" : ""}
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                    />
                  </div>
                  {errors.dob ? <p className="field-error">{errors.dob}</p> : null}
                </div>
              </div>
            </section>

            <div className="account-divider" />

            <section className="account-section">
              <div className="account-section-heading">
                <span className="account-section-num">2</span>
                <h2>Company info</h2>
              </div>
              <div className="form-grid">
                <div className="col-span-2">
  <label htmlFor="acc-company">Company name</label>

  <div
    className="company-search-container"
    ref={companySearchRef}
    style={{ position: "relative" }}
  >
    <div className="account-input-wrap">
      <span className="input-icon">
        <BuildingIcon size={16} />
      </span>

      <input
        type="text"
        id="acc-company"
        placeholder="Acme Manufacturing Co."
        className={errors.companyName ? "error" : ""}
        value={companyName}
        autoComplete="off"
        onFocus={() => setCompanyDropdownOpen(true)}
        onChange={(e) => {
          // Any edit makes it a new search: forget the selected company and its details,
          // and do not show the previous text's results while the new ones load.
          if (selectedCompany || companyDetailsStatus !== "idle") clearCompanySelection();
          setCompanyName(e.target.value);
          setCompanyDropdownOpen(true);
          setCompanySuggestions([]);
          setCompanySearchError("");
          setCompanySearchLoading(e.target.value.trim().length >= 2);
        }}
      />
    </div>

    {companyDropdownOpen && companyName.trim().length >= 2 && (
      <div
        className="company-suggestions"
        style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          zIndex: 50,
          background: "#fff",
          border: "1px solid #dbe3ef",
          borderRadius: 8,
          marginTop: 4,
          boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
          maxHeight: 220,
          overflowY: "auto",
        }}
      >
        {companySearchLoading && (
          <div style={MUTED}>
            Searching companies...
          </div>
        )}

        {!companySearchLoading && !companySearchError && companySuggestions.length === 0 &&
          searchedQuery === companyName.trim() && (
          <div style={MUTED}>No matching companies found.</div>
        )}

        {!companySearchLoading &&
          companySuggestions.map((company) => (
            <button
              key={company.id}
              type="button"
              onClick={() => void selectCompany(company)}
              style={{
                display: "block",
                width: "100%",
                padding: "12px",
                textAlign: "left",
                background: "#fff",
                border: 0,
                cursor: "pointer",
              }}
            >
              {company.companyName}
              {companyLocation(company) ? (
                <span style={{ display: "block", fontSize: 12, color: "#64748b" }}>
                  {companyLocation(company)}
                </span>
              ) : null}
            </button>
          ))}

        {!companySearchLoading &&
          !companySearchError &&
          !companySuggestions.some(
            (company) =>
              company.companyName.toLowerCase() ===
              companyName.trim().toLowerCase()
          ) && (
            <button
              type="button"
              onClick={() => {
                // A new company (not one of the listed records).
                clearCompanySelection();
                setCompanyName(companyName.trim());
                setCompanyDropdownOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "12px",
                textAlign: "left",
                background: "#fff",
                border: 0,
                borderTop: "1px solid #e2e8f0",
                cursor: "pointer",
              }}
            >
              {companyName.trim()}
            </button>
          )}

        {companySearchError && (
          <div style={{ padding: 12, color: "#b91c1c" }}>
            {companySearchError}
          </div>
        )}
      </div>
    )}
  </div>

  {errors.companyName ? (
    <p className="field-error">{errors.companyName}</p>
  ) : companyDetailsStatus === "error" ? (
    <p className="field-error">Couldn’t load this company’s saved details. Select it again to retry.</p>
  ) : companyDetailsStatus === "loading" ? (
    <p style={{ ...MUTED, padding: "6px 0 0", margin: 0 }}>Loading company details…</p>
  ) : null}
</div>
                <div>
                  <label htmlFor="acc-company-type">Company type / category</label>
                  <div className="account-input-wrap">
                    <span className="input-icon">
                      <CategoryIcon size={16} />
                    </span>
                    <select
                      id="acc-company-type"
                      className={`${companyType ? "" : "placeholder-shown"}${errors.companyType ? " error" : ""}`}
                      value={companyType}
                      onChange={(e) => setCompanyType(e.target.value)}
                    >
                      <option value="" disabled>
                        Select a category
                      </option>
                      {COMPANY_TYPES.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                  {errors.companyType ? (
                    <p className="field-error">{errors.companyType}</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="acc-country">Country / location</label>
                  <div className="account-input-wrap">
                    <span className="input-icon">
                      <GlobeIcon size={16} />
                    </span>
                    <select
                      id="acc-country"
                      className={`${country ? "" : "placeholder-shown"}${errors.country ? " error" : ""}`}
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                    >
                      <option value="" disabled>
                        Select your country
                      </option>
                      {COUNTRIES.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                  {errors.country ? (
                    <p className="field-error">{errors.country}</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="acc-phone">
                    Phone number <span className="optional">(optional)</span>
                  </label>
                  <div className="account-input-wrap">
                    <span className="input-icon">
                      <PhoneIcon size={16} />
                    </span>
                    <input
                      type="tel"
                      id="acc-phone"
                      placeholder="+1 555 000 1234"
                      className={errors.phone ? "error" : ""}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                  {errors.phone ? <p className="field-error">{errors.phone}</p> : null}
                </div>
                <div>
                  <label htmlFor="acc-capacity">
                    Production capacity <span className="optional">(optional)</span>
                  </label>
                  <div className="account-input-wrap">
                    <span className="input-icon">
                      <CapacityIcon size={16} />
                    </span>
                    <input
                      type="text"
                      id="acc-capacity"
                      placeholder="e.g. 5,000 units / month"
                      value={capacity}
                      onChange={(e) => setCapacity(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </section>

            <div className="account-divider" />

            <section className="account-section">
              <div className="account-section-heading">
                <span className="account-section-num">3</span>
                <h2>Terms &amp; conditions</h2>
              </div>
              <div className="terms-box">
                <div className="terms-row">
                  <input
                    type="checkbox"
                    id="acc-agree"
                    checked={agree}
                    onChange={(e) => setAgree(e.target.checked)}
                  />
                  <label htmlFor="acc-agree">
                    I agree to the <a href="/terms">Terms &amp; Conditions</a> and{" "}
                    <a href="/privacy-policy">Privacy Policy</a>.
                  </label>
                </div>
              </div>
              {errors.agree ? <p className="field-error">{errors.agree}</p> : null}
            </section>

            <button
              type="submit"
              className="btn-primary account-submit"
              disabled={submitting}
            >
              {submitting ? "Creating account…" : "Create Manufacturer account"}
            </button>
            {showFormError ? (
              <p className="account-form-error">Please fix the highlighted fields above.</p>
            ) : null}
          </form>
        </div>
      </main>
    </div>
  );
}
