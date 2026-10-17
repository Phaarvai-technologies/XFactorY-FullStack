/**
 * Approval-first manufacturer onboarding: shared types and validation (the backend applies the
 * same rules in app/manufacturer_applications.py and is the authority).
 */

/** Company information (shared, one record per company). */
export const COMPANY_FIELDS = [
  { key: "companyName", label: "Company name" },
  { key: "companyType", label: "Company category" },
  { key: "country", label: "Company location" },
  { key: "companyPhone", label: "Company phone number" },
  { key: "capacity", label: "Production capacity" },
] as const;

/** Personal information (the registering user's own record). */
export const PERSONAL_FIELDS = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "personalEmail", label: "Personal email" },
  { key: "dob", label: "Date of birth" },
] as const;

export type CompanyFieldKey = (typeof COMPANY_FIELDS)[number]["key"];
export type PersonalFieldKey = (typeof PERSONAL_FIELDS)[number]["key"];
export type CorrectableField = CompanyFieldKey | PersonalFieldKey | "company";

export const FIELD_LABELS: Record<CorrectableField, string> = {
  ...(Object.fromEntries([...COMPANY_FIELDS, ...PERSONAL_FIELDS].map((f) => [f.key, f.label])) as Record<
    CompanyFieldKey | PersonalFieldKey,
    string
  >),
  company: "Selected company",
};

export type ApplicationStatus = "pending" | "changes_requested" | "approved" | "rejected";
export type AccessStatus = ApplicationStatus | "not_submitted" | "no_permission";

/** GET /manufacturer/bootstrap -> onboarding: the applicant's own application only. */
export type OnboardingState = {
  access: { unlocked: boolean; status: AccessStatus };
  application: {
    id: string;
    kind: "new_company" | "join_company" | "claim";
    status: ApplicationStatus;
    companyId: string | null;
    companyName: string | null;
    /** User-facing feedback from X!Y (never the admins' internal notes). */
    feedback: string | null;
    correctionFields: CorrectableField[];
    submittedAt: string | null;
    reviewedAt: string | null;
    values: Record<CompanyFieldKey | PersonalFieldKey, string>;
  } | null;
  draft: { values: Partial<Record<string, unknown>>; savedAt: string } | null;
  /** Reapplying after a rejection: the waiting period is configured by X!Y (not decided yet). */
  reapply: { configured: boolean; allowed: boolean; availableFrom: string | null } | null;
};

const PHONE_HINT = "Enter a valid Indian phone number, e.g. +91 98765 43210 or 044 2345 6789.";

/**
 * An Indian phone number as +91 followed by the 10-digit national number, or an error message.
 * Accepts +91 / 91 / 0 prefixes and spaces, dashes, dots or brackets.
 */
export function normalizeIndianPhone(value: string): { phone: string } | { error: string } {
  const raw = value.trim();
  if (!raw) return { error: "Enter the company phone number." };
  if (!/^\+?[0-9\s\-().]{7,20}$/.test(raw)) return { error: PHONE_HINT };
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    if (!digits.startsWith("91")) return { error: "Enter an Indian phone number (country code +91)." };
    digits = digits.slice(2);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  if (digits.length !== 10 || digits[0] === "0" || new Set(digits).size === 1) return { error: PHONE_HINT };
  return { phone: `+91${digits}` };
}

/** Display only: a mobile "+919876543210" -> "+91 98765 43210"; a landline "+914423456789" ->
 * "+91 4423456789" (area codes differ in length, so the national number is kept together). */
export function formatIndianPhone(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  const mobile = /^\+91([6-9]\d{4})(\d{5})$/.exec(v);
  if (mobile) return `+91 ${mobile[1]} ${mobile[2]}`;
  const other = /^\+91(\d{10})$/.exec(v);
  return other ? `+91 ${other[1]}` : v;
}

/** A value counts as given unless it is null / undefined, "" or whitespace only (0 is a value). */
export function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

export function personalEmailError(value: string): string | null {
  const email = value.trim();
  if (!email) return "Enter your personal email address.";
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "Enter a valid personal email address.";
  return null;
}
