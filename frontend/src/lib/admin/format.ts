import type { AccountStatus, EntrySource, RecordType, ReviewStatus } from "@/lib/admin/types";

export const REVIEW_LABELS: Record<ReviewStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  NEEDS_CORRECTION: "Needs correction",
  REVIEWED: "Reviewed",
};
export const REVIEW_ORDER: ReviewStatus[] = ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "NEEDS_CORRECTION", "REVIEWED"];

export const RECORD_LABELS: Record<RecordType, string> = { REAL: "Real", DEMO: "Demo", TEST: "Test" };
export const RECORD_ORDER: RecordType[] = ["REAL", "DEMO", "TEST"];

export const ENTRY_LABELS: Record<EntrySource, string> = {
  MANUFACTURER: "Self-completed",
  ADMIN_ASSISTED: "Admin-assisted",
  IMPORTED: "Imported",
};
export const ENTRY_ORDER: EntrySource[] = ["MANUFACTURER", "ADMIN_ASSISTED", "IMPORTED"];

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
      return "badge-rejected";
    case "IN_PROGRESS":
      return "badge-pending";
    default:
      return "badge-neutral";
  }
}

export function recordTone(type: RecordType): string {
  return type === "REAL" ? "badge-neutral" : "badge-purple";
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
