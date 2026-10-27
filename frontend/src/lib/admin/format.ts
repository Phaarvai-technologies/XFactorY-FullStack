import type { AccountStatus, EntrySource, OnboardingSource, RecordType, RegistrationChannel, ReviewStatus, StagedSource } from "@/lib/admin/types";

export const REVIEW_LABELS: Record<ReviewStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  NEEDS_CORRECTION: "Needs correction",
  // REVIEWED is stored as an approval (manufacturer_onboarding.status = 'approved').
  REVIEWED: "Approved",
  REJECTED: "Rejected",
};
export const REVIEW_ORDER: ReviewStatus[] = ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "NEEDS_CORRECTION", "REVIEWED", "REJECTED"];

export const RECORD_LABELS: Record<RecordType, string> = { REAL: "Real", DEMO: "Demo", TEST: "Test" };
export const RECORD_ORDER: RecordType[] = ["REAL", "DEMO", "TEST"];

export const ENTRY_LABELS: Record<EntrySource, string> = {
  MANUFACTURER: "Self-completed",
  ADMIN_ASSISTED: "Admin-assisted",
  IMPORTED: "Imported",
};
export const ENTRY_ORDER: EntrySource[] = ["MANUFACTURER", "ADMIN_ASSISTED", "IMPORTED"];

/** Company onboarding source (how the company first came onto XfactorY), read from the backend.
 * Never derived from how a person signs in, and never an approval status. */
export const ONBOARDING_SOURCE_LABELS: Record<OnboardingSource, string> = {
  database_import: "Database Import",
  web_dashboard: "Web Dashboard",
  ai_voice_call: "AI Voice Call",
  ground_sales: "Ground Sales",
  admin_entry: "Admin Entry",
};
export const SOURCE_UNKNOWN = "Unknown";
export const SOURCE_NOT_APPLICABLE = "Not applicable";
export function onboardingSourceLabel(source: OnboardingSource | string | null | undefined): string {
  if (!source) return SOURCE_UNKNOWN;
  return ONBOARDING_SOURCE_LABELS[source as OnboardingSource] ?? source;
}

const STAGED_STATUS: Record<StagedSource["status"], string> = {
  draft: "draft, not submitted",
  pending: "awaiting approval",
  changes_requested: "corrections requested",
  rejected: "not approved",
  approved: "approved",
};
/** The company's stored source; for a new company not approved yet, the source on its staged
 * submission marked as such (it is copied to the company on approval); otherwise Unknown. */
export function sourceText(source: string | null | undefined, staged?: StagedSource | null): string {
  if (source) return onboardingSourceLabel(source);
  if (staged?.source) return `${onboardingSourceLabel(staged.source)} (${STAGED_STATUS[staged.status] ?? staged.status})`;
  return onboardingSourceLabel(null);
}

/** How a person registered (channel) — separate from the sign-in method and from company sources. */
export const REGISTRATION_CHANNEL_LABELS: Record<RegistrationChannel, string> = {
  web_signup: "Website sign-up",
  legacy_account: "Existing account (before sign-up was required)",
  admin_portal: "Admin portal (staff account)",
};
export function registrationLabel(channel: string | null | undefined, method: string | null | undefined): string {
  if (!channel) return "Not registered / unknown";
  const base = REGISTRATION_CHANNEL_LABELS[channel as RegistrationChannel] ?? channel;
  const how = method === "google" ? "Google" : method === "manual" ? "email & password" : null;
  return how ? `${base} · ${how}` : base;
}

/** Visionary project / request values stored as codes. */
export const TIMELINE_LABELS: Record<string, string> = {
  immediately: "Immediately",
  within_1_month: "Within 1 month",
  "1_3_months": "1–3 months",
  "3_6_months": "3–6 months",
};
export const DURATION_LABELS: Record<string, string> = {
  "1_week": "1 week",
  "2_weeks": "2 weeks",
  "1_month": "1 month",
  "2_months": "2 months",
  "3_months": "3 months",
  "6_months": "6 months",
};
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export function fmtMoney(amount: number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined) return "—";
  return `${currency === "INR" || !currency ? "₹" : `${currency} `}${inr.format(amount)}`;
}

export const ACCOUNT_LABELS: Record<AccountStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  deactivated: "Deleted",
};

/** Badge colour (XY badge variants + two admin-only ones). */
export function reviewTone(status: ReviewStatus): string {
  switch (status) {
    case "REVIEWED":
      return "badge-verified";
    case "SUBMITTED":
      return "badge-info";
    case "NEEDS_CORRECTION":
    case "REJECTED":
      return "badge-rejected";
    case "IN_PROGRESS":
      return "badge-pending";
    default:
      return "badge-neutral";
  }
}

export function recordTone(type: RecordType): string {
  return type === "REAL" ? "badge-info" : "badge-purple";
}

export function accountTone(status: AccountStatus): string {
  return status === "active" ? "badge-verified" : status === "suspended" ? "badge-rejected" : "badge-neutral";
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

/** "3 hours ago" style, falling back to a date after a week. */
export function fmtAgo(value: string | null | undefined): string {
  if (!value) return "Never";
  const d = new Date(value);
  const diff = Date.now() - d.getTime();
  if (Number.isNaN(diff)) return "—";
  const min = Math.round(diff / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d ago`;
  return dateFmt.format(d);
}

export function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part * 100) / whole)}%`;
}

export function initials(name: string | null | undefined, email?: string | null): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Marketplace roles as admins know them (Visionaries record the demand_requester persona). */
export const ROLE_LABELS: Record<string, string> = {
  manufacturer: "Manufacturer",
  demand_requester: "Visionary",
  vendor: "Vendor",
  labor_supplier: "Labour supplier",
  market_lead: "Market lead",
  logistics_provider: "Logistics",
  investor: "Investor",
  legal_compliance: "Legal & compliance",
};
export const roleLabel = (role: string) => ROLE_LABELS[role] ?? role.replace(/_/g, " ");

export function machineTone(status: string): string {
  return status === "Published" ? "badge-verified" : status === "Archived" ? "badge-neutral" : "badge-pending";
}

export const MEMBERSHIP_LABELS: Record<string, string> = {
  active: "Active",
  suspended: "Suspended",
  removed: "Removed",
  // an applicant listed under the company while their application is reviewed (not a member yet)
  pending: "Pending approval",
};
