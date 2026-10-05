"use client";

import { Archive, ArchiveRestore, Eye, Pencil, SlidersHorizontal } from "lucide-react";
import { useCallback, useState } from "react";
import { useToast } from "@/components/admin/AdminShell";
import {
  Completeness,
  EntryBadge,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  PillFilter,
  RecordBadge,
  ReviewBadge,
  SearchInput,
} from "@/components/admin/ui";
import { jsonBody, toQuery, useAdminApi, useAdminHost, useResource, useUrlFilters } from "@/lib/admin/api";
import {
  ENTRY_LABELS,
  ENTRY_ORDER,
  RECORD_LABELS,
  RECORD_ORDER,
  REVIEW_LABELS,
  REVIEW_ORDER,
  fmtAgo,
} from "@/lib/admin/format";
import type { EntrySource, ManufacturerList, ManufacturerRow, RecordType, ReviewStatus } from "@/lib/admin/types";

export function Manufacturers() {
  const { go } = useAdminHost();
  const call = useAdminApi();
  const toast = useToast();
  const f = useUrlFilters("/admin/manufacturers");
  const [showFilters, setShowFilters] = useState(() =>
    ["industry", "process", "location", "completeness", "review_status", "record_type", "entry_source", "archived", "assigned"].some(
      (k) => f.search.has(k),
    ),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{ ids: string[]; archive: boolean; batch: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const params = {
    q: f.get("q"),
    industry: f.get("industry"),
    process: f.get("process"),
    location: f.get("location"),
    completeness: f.get("completeness"),
    review_status: f.getAll("review_status"),
    record_type: f.getAll("record_type"),
    entry_source: f.getAll("entry_source"),
    archived: f.get("archived") || "active",
    assigned: f.get("assigned"),
    sort: f.get("sort") || "updated",
    page: f.get("page") || "1",
    page_size: "25",
  };
  const path = `/manufacturers${toQuery({ ...params, archived: params.archived === "active" ? null : params.archived })}`;
  const { data, error, loading, reload } = useResource<ManufacturerList>(path);
  const setFilters = f.set;
  const commitSearch = useCallback((q: string) => setFilters({ q }), [setFilters]);

  const activeFilterCount =
    [params.industry, params.process, params.location, params.completeness, params.assigned].filter(Boolean).length +
    params.review_status.length +
    params.record_type.length +
    params.entry_source.length +
    (params.archived !== "active" ? 1 : 0);

  const rows = data?.rows ?? [];
  const selectable = rows.filter((r) => r.recordType !== "REAL" && !r.isArchived);

  async function runArchive() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.batch) {
        const res = await call<{ changed: string[]; skippedReal: string[] }>(
          "/manufacturers/archive-batch",
          jsonBody("POST", { ids: confirm.ids, reason: reason || null }),
        );
        toast(
          `${res.changed.length} demo/test record${res.changed.length === 1 ? "" : "s"} archived` +
            (res.skippedReal.length ? ` · ${res.skippedReal.length} real skipped` : ""),
        );
        setSelected([]);
      } else {
        await call(
          `/manufacturers/${confirm.ids[0]}/${confirm.archive ? "archive" : "restore"}`,
          jsonBody("POST", { reason: reason || null }),
        );
        toast(confirm.archive ? "Manufacturer archived" : "Manufacturer restored");
      }
      setConfirm(null);
      setReason("");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Manufacturers"
        subtitle="Search and filter manufacturer records. Archived records are hidden unless you choose to show them."
      />

      <div className="card adm-toolbar">
        <div className="adm-toolbar-row">
          <SearchInput value={params.q} onCommit={commitSearch} placeholder="Search company, contact or email" />
          <select
            value={params.sort}
            onChange={(e) => f.set({ sort: e.target.value })}
            aria-label="Sort by"
            className="adm-select-sm"
          >
            <option value="updated">Last updated</option>
            <option value="registered">Newest registrations</option>
            <option value="name">Company name</option>
            <option value="completeness">Least complete first</option>
          </select>
          <button type="button" className={`btn-ghost adm-filter-btn${showFilters ? " on" : ""}`} onClick={() => setShowFilters((s) => !s)}>
            <SlidersHorizontal size={15} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
        </div>

        {showFilters && (
          <div className="adm-filters">
            <div className="adm-filter-grid">
              <div>
                <label htmlFor="f-industry">Industry</label>
                <select id="f-industry" value={params.industry} onChange={(e) => f.set({ industry: e.target.value })}>
                  <option value="">All industries</option>
                  {(data?.facets.industries ?? []).map((i) => (
                    <option key={i}>{i}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="f-location">Location</label>
                <select id="f-location" value={params.location} onChange={(e) => f.set({ location: e.target.value })}>
                  <option value="">All locations</option>
                  {(data?.facets.countries ?? []).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="f-process">Major process</label>
                <ProcessInput value={params.process} onCommit={(process) => f.set({ process })} />
              </div>
              <div>
                <label htmlFor="f-complete">Completeness</label>
                <select id="f-complete" value={params.completeness} onChange={(e) => f.set({ completeness: e.target.value })}>
                  <option value="">Any</option>
                  <option value="complete">Complete (100%)</option>
                  <option value="incomplete">Incomplete</option>
                </select>
              </div>
              <div>
                <label htmlFor="f-archived">Archive</label>
                <select id="f-archived" value={params.archived} onChange={(e) => f.set({ archived: e.target.value === "active" ? null : e.target.value })}>
                  <option value="active">Active only</option>
                  <option value="archived">Archived only</option>
                  <option value="all">Active and archived</option>
                </select>
              </div>
              <div>
                <label htmlFor="f-assigned">Assignment</label>
                <select id="f-assigned" value={params.assigned} onChange={(e) => f.set({ assigned: e.target.value })}>
                  <option value="">Anyone</option>
                  <option value="unassigned">Unassigned</option>
                </select>
              </div>
            </div>
            <div className="adm-filter-pills">
              <div>
                <label>Review status</label>
                <PillFilter<ReviewStatus>
                  options={REVIEW_ORDER}
                  labels={REVIEW_LABELS}
                  value={params.review_status as ReviewStatus[]}
                  onChange={(v) => f.set({ review_status: v })}
                />
              </div>
              <div>
                <label>Record type</label>
                <PillFilter<RecordType>
                  options={RECORD_ORDER}
                  labels={RECORD_LABELS}
                  value={params.record_type as RecordType[]}
                  onChange={(v) => f.set({ record_type: v })}
                />
              </div>
              <div>
                <label>Entry source</label>
                <PillFilter<EntrySource>
                  options={ENTRY_ORDER}
                  labels={ENTRY_LABELS}
                  value={params.entry_source as EntrySource[]}
                  onChange={(v) => f.set({ entry_source: v })}
                />
              </div>
            </div>
            {activeFilterCount > 0 && (
              <button
                type="button"
                className="btn-text"
                onClick={() =>
                  f.set({
                    industry: null,
                    process: null,
                    location: null,
                    completeness: null,
                    review_status: [],
                    record_type: [],
                    entry_source: [],
                    archived: null,
                    assigned: null,
                  })
                }
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="adm-batch-bar">
          <span>
            {selected.length} demo/test record{selected.length === 1 ? "" : "s"} selected
          </span>
          <button type="button" className="btn-danger-ghost" onClick={() => setConfirm({ ids: selected, archive: true, batch: true })}>
            <Archive size={14} /> Archive selected
          </button>
          <button type="button" className="btn-text" onClick={() => setSelected([])}>
            Clear
          </button>
        </div>
      )}

      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {!data ? (
        loading && <Loading />
      ) : (
        <div className={`card adm-table-card${loading ? " adm-stale" : ""}`}>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th className="adm-check-col">
                    <input
                      type="checkbox"
                      aria-label="Select all demo and test records on this page"
                      disabled={selectable.length === 0}
                      checked={selectable.length > 0 && selectable.every((r) => selected.includes(r.id))}
                      onChange={(e) =>
                        setSelected(e.target.checked ? Array.from(new Set([...selected, ...selectable.map((r) => r.id)])) : [])
                      }
                    />
                  </th>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Location</th>
                  <th>Industry</th>
                  <th>Major process</th>
                  <th>Completeness</th>
                  <th>Status</th>
                  <th>Record / source</th>
                  <th>Last updated</th>
                  <th className="adm-sticky-right" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="adm-empty-cell">
                      No manufacturers match these filters.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <Row
                    key={r.id}
                    r={r}
                    selected={selected.includes(r.id)}
                    onSelect={(on) => setSelected(on ? [...selected, r.id] : selected.filter((id) => id !== r.id))}
                    onOpen={(tab) => go(`/admin/manufacturers/${r.id}${tab ? `?tab=${tab}` : ""}`)}
                    onArchive={() => setConfirm({ ids: [r.id], archive: !r.isArchived, batch: false })}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={(p) => f.set({ page: String(p) }, true)}
          />
        </div>
      )}

      {confirm && (
        <Modal
          title={confirm.batch ? "Archive demo/test records" : confirm.archive ? "Archive manufacturer" : "Restore manufacturer"}
          onClose={() => setConfirm(null)}
        >
          <p className="adm-modal-text">
            {confirm.batch
              ? "Only demo and test records are archived — real records are always skipped. Archived records are hidden from lists and analytics, and can be restored later."
              : confirm.archive
                ? "The record will be hidden from lists and analytics. Nothing is deleted and you can restore it at any time."
                : "The record will appear in lists and analytics again."}
          </p>
          <label htmlFor="archive-reason">
            Reason <span className="optional">(optional)</span>
          </label>
          <textarea id="archive-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="modal-actions">
            <button type="button" className="btn-secondary-full" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void runArchive()}>
              {busy ? "Saving…" : confirm.archive ? "Archive" : "Restore"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function ProcessInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(value);
  }
  return (
    <input
      id="f-process"
      type="text"
      placeholder="e.g. CNC, injection molding"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== value && onCommit(text.trim())}
      onKeyDown={(e) => e.key === "Enter" && onCommit(text.trim())}
    />
  );
}

function Row({
  r,
  selected,
  onSelect,
  onOpen,
  onArchive,
}: {
  r: ManufacturerRow;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onOpen: (tab?: string) => void;
  onArchive: () => void;
}) {
  const canBatch = r.recordType !== "REAL" && !r.isArchived;
  return (
    <tr className={r.isArchived ? "adm-row-archived" : undefined}>
      <td className="adm-check-col">
        {canBatch && (
          <input
            type="checkbox"
            aria-label={`Select ${r.companyName ?? "record"}`}
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
          />
        )}
      </td>
      <td className="adm-col-company">
        <button type="button" className="adm-link" onClick={() => onOpen()}>
          {r.companyName || "Unnamed company"}
        </button>
        {r.isArchived && <span className="badge badge-neutral adm-inline-badge">Archived</span>}
      </td>
      <td>
        <div className="adm-cell-main">{r.contactName || "—"}</div>
        <div className="adm-cell-sub">{r.contactEmail || r.contactPhone || ""}</div>
      </td>
      <td>{r.location || <span className="adm-muted">—</span>}</td>
      <td className="adm-col-industry">{r.industry || <span className="adm-muted">—</span>}</td>
      <td>
        {r.majorProcess || <span className="adm-muted">No listings</span>}
        {r.listingCount > 1 && <div className="adm-cell-sub">+{r.listingCount - 1} more</div>}
      </td>
      <td>
        <Completeness value={r.completeness} done={r.requiredDone} total={r.requiredTotal} />
      </td>
      <td>
        <ReviewBadge status={r.reviewStatus} />
      </td>
      <td>
        <div className="adm-badge-stack">
          <RecordBadge type={r.recordType} />
          <EntryBadge source={r.entrySource} />
        </div>
      </td>
      <td className="adm-nowrap">{fmtAgo(r.lastUpdated)}</td>
      <td className="adm-sticky-right">
        <div className="adm-row-actions">
          <button type="button" className="adm-icon-action" title="View" onClick={() => onOpen()}>
            <Eye size={16} />
          </button>
          <button type="button" className="adm-icon-action" title="Edit" onClick={() => onOpen("company")}>
            <Pencil size={16} />
          </button>
          <button
            type="button"
            className="adm-icon-action"
            title={r.isArchived ? "Restore" : "Archive"}
            onClick={onArchive}
          >
            {r.isArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
          </button>
        </div>
      </td>
    </tr>
  );
}
