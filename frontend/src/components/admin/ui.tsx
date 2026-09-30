"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, Search, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  ACCOUNT_LABELS,
  ENTRY_LABELS,
  RECORD_LABELS,
  REVIEW_LABELS,
  accountTone,
  recordTone,
  reviewTone,
} from "@/lib/admin/format";
import type { AccountStatus, EntrySource, RecordType, ReviewStatus } from "@/lib/admin/types";

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  return <span className={`badge ${reviewTone(status)}`}>{REVIEW_LABELS[status] ?? status}</span>;
}

export function RecordBadge({ type, hideReal = false }: { type: RecordType; hideReal?: boolean }) {
  if (hideReal && type === "REAL") return null;
  return <span className={`badge ${recordTone(type)}`}>{RECORD_LABELS[type] ?? type}</span>;
}

export function EntryBadge({ source }: { source: EntrySource }) {
  return <span className="badge badge-neutral">{ENTRY_LABELS[source] ?? source}</span>;
}

export function AccountBadge({ status }: { status: AccountStatus }) {
  return <span className={`badge ${accountTone(status)}`}>{ACCOUNT_LABELS[status] ?? status}</span>;
}

/** Completeness % with a thin bar (doc formula: required completed / required × 100). */
export function EmailStatusBadge({ status }: { status: "sent" | "failed" | "skipped" }) {
  const cls = status === "sent" ? "badge-verified" : status === "failed" ? "badge-rejected" : "badge-neutral";
  return <span className={`badge ${cls}`}>{status === "sent" ? "Sent" : status === "failed" ? "Failed" : "Not sent (email off)"}</span>;
}

export function Completeness({ value, done, total }: { value: number; done?: number; total?: number }) {
  const tone = value >= 100 ? "full" : value >= 50 ? "mid" : "low";
  return (
    <div className="adm-complete" title={done !== undefined ? `${done} of ${total} required fields` : undefined}>
      <div className="adm-complete-track">
        <div className={`adm-complete-fill ${tone}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span>{value}%</span>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  onBack,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="adm-page-header">
      <div className="panel-header" style={{ marginBottom: 0 }}>
        {onBack && (
          <button type="button" className="panel-back" onClick={onBack} aria-label="Back">
            <ChevronLeft size={18} />
          </button>
        )}
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="adm-header-actions">{actions}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="adm-loading" role="status">
      <Loader2 size={20} className="adm-spin" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="adm-error" role="alert">
      <AlertTriangle size={18} />
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn-text" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ text, icon }: { text: string; icon?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon ?? <Inbox size={28} color="var(--slate-400)" />}
      <p>{text}</p>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="adm-pagination">
      <span>
        {from}–{to} of {total}
      </span>
      <div>
        <button type="button" className="icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        <span className="adm-page-num">
          {page} / {pages}
        </span>
        <button type="button" className="icon-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

/** XY modal (same look as the manufacturer site's modal-card), closable with Esc. */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop show" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal-card adm-modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="adm-modal-head">
          <h3>{title}</h3>
          <button type="button" className="adm-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Multi-select as a row of XY pill toggles. */
export function PillFilter<T extends string>({
  options,
  labels,
  value,
  onChange,
}: {
  options: T[];
  labels: Record<T, string>;
  value: T[];
  onChange: (value: T[]) => void;
}) {
  return (
    <div className="pill-group adm-pills">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={`pill-option${value.includes(o) ? " active" : ""}`}
          onClick={() => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o])}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, value, missing }: { label: string; value: ReactNode; missing?: boolean }) {
  const empty = value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  return (
    <div className={`detail-item${missing && empty ? " adm-missing" : ""}`}>
      <p className="detail-label">{label}</p>
      <div className="detail-value">
        {empty ? <span className="adm-muted">{missing ? "Missing — required" : "Not provided"}</span> : value}
      </div>
    </div>
  );
}

/**
 * Search box bound to a URL value. Typing updates the URL after a short pause;
 * URL changes from elsewhere (e.g. "Clear filters") flow back into the box.
 */
export function SearchInput({
  value,
  onCommit,
  placeholder,
  debounce = true,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder: string;
  /** false: commit on Enter only. */
  debounce?: boolean;
}) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(value);
  }
  useEffect(() => {
    if (!debounce || text.trim() === value.trim()) return;
    const t = setTimeout(() => onCommit(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text, value, onCommit, debounce]);
  return (
    <div className="input-wrap adm-search">
      <span className="input-icon">
        <Search size={16} />
      </span>
      <input
        type="text"
        className="has-icon"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onCommit(text.trim())}
        aria-label={placeholder}
      />
    </div>
  );
}
