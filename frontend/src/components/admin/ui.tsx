"use client";

import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Inbox, Loader2, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ACCOUNT_LABELS,
  ENTRY_LABELS,
  RECORD_LABELS,
  REVIEW_LABELS,
  accountTone,
  recordTone,
  reviewTone,
  roleLabel,
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
  // entry_source: an admin-editable classification, NOT the company's onboarding source
  return (
    <span className="badge badge-neutral" title="Entry source (admin classification) — not the onboarding source">
      {ENTRY_LABELS[source] ?? source}
    </span>
  );
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
  closable = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** false: no close button, Esc and backdrop clicks do nothing (a required step). */
  closable?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closable) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, closable]);
  return (
    <div className="modal-backdrop show" onMouseDown={(e) => closable && e.target === e.currentTarget && onClose()}>
      <div className={`modal-card adm-modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="adm-modal-head">
          <h3>{title}</h3>
          {closable && (
            <button type="button" className="adm-modal-close" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export type DataScope = "real" | "demo" | "all";
const DATA_SCOPE_OPTIONS: { value: DataScope; label: string; title: string }[] = [
  { value: "real", label: "Real", title: "Real data only (no demo or test records)" },
  { value: "demo", label: "Demo", title: "Demo and test records only" },
  { value: "all", label: "Real + demo", title: "Real and demo data together" },
];

/** Data filter: Real / Demo / Real + demo, as one segmented control. `value` null = a custom
 * record-type combination (nothing highlighted). Counts are shown when given. */
export function DataScopeFilter({
  value,
  onChange,
  counts,
}: {
  value: DataScope | null;
  onChange: (value: DataScope) => void;
  counts?: Partial<Record<DataScope, number>> | null;
}) {
  return (
    <div className="adm-seg" role="group" aria-label="Data">
      <span className="adm-seg-label" aria-hidden>Data</span>
      {DATA_SCOPE_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`adm-seg-btn${value === o.value ? " on" : ""}`}
          aria-pressed={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {counts && typeof counts[o.value] === "number" && <span className="adm-seg-count">{counts[o.value]}</span>}
        </button>
      ))}
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

/* ------------------------------------------------------------------ Actions menu */
export type ActionItem = {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Not shown at all (e.g. an action that does not apply to this record). */
  hidden?: boolean;
  /** Starts a new group (a divider above it). */
  group?: boolean;
};

const MENU_WIDTH = 224;

/**
 * One labelled "Actions" button per row instead of a row of unlabelled icons. The menu is
 * rendered in a fixed layer (portal), so table containers with overflow never clip it.
 * Keyboard: Enter / Space / ArrowDown opens and focuses the first item; ArrowUp / ArrowDown /
 * Home / End move; Escape closes and returns focus to the button; Tab closes.
 */
export function ActionsMenu({ items, label = "Actions", context }: { items: ActionItem[]; label?: string; context?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  /** Where the menu layer is rendered: the admin root (keeps its styles), found when opening. */
  const [host, setHost] = useState<Element | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const shown = items.filter((i) => !i.hidden);

  const close = useCallback((focusButton: boolean) => {
    setOpen(false);
    setPos(null);
    if (focusButton) button.current?.focus();
  }, []);

  // Position next to the button, flipped above it when there is no room below. Returns false
  // when the button is no longer on screen (then the menu closes).
  const place = useCallback(() => {
    if (!button.current) return false;
    const r = button.current.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
    const height = menu.current?.offsetHeight ?? 0;
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    const below = r.bottom + 4;
    const top = below + height > window.innerHeight - 8 && r.top - height - 4 > 8 ? r.top - height - 4 : below;
    setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
    return true;
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, shown.length, place]);

  useEffect(() => {
    if (!open) return;
    const first = menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close(false);
    };
    // The page or a table scrolled (e.g. the row was scrolled into view): follow the button;
    // close only when it left the screen. Scrolling inside the menu itself is ignored.
    const onMove = (e: Event) => {
      if (e.target instanceof Node && menu.current?.contains(e.target)) return;
      if (!place()) close(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, close, place]);

  function onMenuKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const list = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") list[(i + 1) % list.length]?.focus();
    else if (e.key === "ArrowUp") list[(i - 1 + list.length) % list.length]?.focus();
    else if (e.key === "Home") list[0]?.focus();
    else if (e.key === "End") list[list.length - 1]?.focus();
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") return close(false);
    else return;
    e.preventDefault();
  }

  function openMenu() {
    setHost(button.current?.closest(".adm-root") ?? document.body);
    setOpen(true);
  }

  if (shown.length === 0) return null;
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`adm-actions-btn${open ? " open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={context ? `${label} for ${context}` : label}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        {label} <ChevronDown size={14} aria-hidden />
      </button>
      {open &&
        host &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label={context ? `${label} for ${context}` : label}
            className="adm-menu"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: MENU_WIDTH }}
            onKeyDown={onMenuKey}
          >
            {shown.map((item, i) => (
              <button
                key={`${item.label}-${i}`}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                className={`adm-menu-item${item.danger ? " danger" : ""}${item.group && i > 0 ? " group" : ""}`}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>,
          host,
        )}
    </>
  );
}

/* ------------------------------------------------------------------ expandable row details */
/** "Details" toggle for a table row; the details render in a full-width row below it. */
export function DetailsToggle({ open, onToggle, controls, label }: { open: boolean; onToggle: () => void; controls: string; label: string }) {
  return (
    <button
      type="button"
      className={`adm-expand${open ? " open" : ""}`}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`${open ? "Hide" : "Show"} details for ${label}`}
      title={open ? "Hide details" : "Show details"}
      onClick={onToggle}
    >
      <ChevronRight size={15} aria-hidden />
    </button>
  );
}

export function DetailsRow({ id, colSpan, items }: { id: string; colSpan: number; items: [string, ReactNode][] }) {
  return (
    <tr className="adm-details-row" id={id}>
      <td colSpan={colSpan}>
        <dl className="adm-details-grid">
          {items.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v === null || v === undefined || v === "" ? <span className="adm-muted">—</span> : v}</dd>
            </div>
          ))}
        </dl>
      </td>
    </tr>
  );
}

/** Long text in a cell: shortened to one line, the full value on hover / for screen readers. */
export function Truncate({ text, className = "" }: { text: string | null | undefined; className?: string }) {
  if (!text) return <span className="adm-muted">—</span>;
  return (
    <span className={`adm-truncate ${className}`} title={text}>
      {text}
    </span>
  );
}

export function RoleBadges({ roles }: { roles: string[] }) {
  if (!roles.length) return <span className="adm-muted">No role yet</span>;
  return (
    <span className="adm-role-list">
      {roles.map((r) => (
        <span key={r} className={`badge ${r === "manufacturer" ? "badge-info" : r === "demand_requester" ? "badge-purple" : "badge-neutral"}`}>
          {roleLabel(r)}
        </span>
      ))}
    </span>
  );
}
