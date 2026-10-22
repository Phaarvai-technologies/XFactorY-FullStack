"use client";

import { Archive, ArchiveRestore, BadgeCheck, ClipboardCheck, Cog, Eye, FlaskConical, Pencil, Plus, SlidersHorizontal } from "lucide-react";
import { useCallback, useState } from "react";
import { AddCompanyModal } from "@/components/admin/AddCompany";
import { useAdminMe, useToast } from "@/components/admin/AdminShell";
import {
  ActionsMenu,
  Completeness,
  DetailsRow,
  DetailsToggle,
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
  Truncate,
  DataScopeFilter,
  type DataScope,
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
  fmtDate,
  sourceText,
} from "@/lib/admin/format";
import type { EntrySource, ManufacturerList, ManufacturerRow, RecordType, ReviewStatus } from "@/lib/admin/types";

export function Manufacturers() {
  const { go } = useAdminHost();
  const call = useAdminApi();
  const toast = useToast();
  const f = useUrlFilters("/admin/manufacturers");
  const [showFilters, setShowFilters] = useState(() =>
    ["industry", "process", "location", "completeness", "review_status", "record_type", "entry_source", "archived", "assigned", "listing"].some(
      (k) => f.search.has(k),
    ),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ ids: string[]; archive: boolean; batch: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  // Admin Entry: administrators / operators only (the backend checks the same roles).
  const me = useAdminMe();
  const canAdd = !!me?.roles.some((r) => r === "platform_administrator" || r === "platform_operator");

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
    // listed (default): approved companies + imported / admin-added ones; awaiting: submitted by users,
    // not approved yet (they are in Onboarding & review); all: both
    listing: (["awaiting", "all"].includes(f.get("listing")) ? f.get("listing") : "listed") as "listed" | "awaiting" | "all",
    sort: f.get("sort") || "updated",
    page: f.get("page") || "1",
    page_size: "25",
  };
  const path = `/manufacturers${toQuery({
    ...params,
    archived: params.archived === "active" ? null : params.archived,
    listing: params.listing === "listed" ? null : params.listing,
  })}`;
  const { data, error, loading, reload } = useResource<ManufacturerList>(path);
  const setFilters = f.set;
  const commitSearch = useCallback((q: string) => setFilters({ q }), [setFilters]);

  // Data filter = a shortcut over the Record type filter: Real -> REAL; Demo -> DEMO + TEST; all -> none.
  const recordSet = [...params.record_type].sort().join(",");
  const dataScope: DataScope | null =
    recordSet === "" ? "all" : recordSet === "REAL" ? "real" : recordSet === "DEMO,TEST" ? "demo" : null;
  const setDataScope = (v: DataScope) =>
    f.set({ record_type: v === "real" ? ["REAL"] : v === "demo" ? ["DEMO", "TEST"] : [] });

  const activeFilterCount =
    [params.industry, params.process, params.location, params.completeness, params.assigned].filter(Boolean).length +
    params.review_status.length +
    params.record_type.length +
    params.entry_source.length +
    (params.archived !== "active" ? 1 : 0) +
    (params.listing !== "listed" ? 1 : 0);

  const rows = data?.rows ?? [];
  const selectable = rows.filter((r) => r.recordType !== "REAL" && !r.isArchived);

  /** Mark as demo / real (the company's Record type; history keeps who changed it and when). */
  async function setRecordType(r: ManufacturerRow, type: RecordType) {
    try {
      await call(`/manufacturers/${r.id}/admin-fields`, jsonBody("PATCH", { record_type: type }));
      toast(`${r.companyName || "Company"} marked as ${type === "REAL" ? "real" : "demo"} data`);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update");
    }
  }

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
        subtitle="Approved companies and those added by admins. New submissions wait in Onboarding & review."
        actions={canAdd ? (
          <button type="button" className="btn-primary adm-btn-md" onClick={() => setAdding(true)}>
            <Plus size={15} /> Add company
          </button>
        ) : undefined}
      />
      {adding && <AddCompanyModal onClose={() => setAdding(false)} />}

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
        <div className="adm-toolbar-row">
          <DataScopeFilter value={dataScope} onChange={setDataScope} />
          {dataScope === null && <span className="adm-seg-hint">Custom record type filter applied</span>}
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
                <label htmlFor="f-listing">Listing</label>
                <select id="f-listing" value={params.listing} onChange={(e) => f.set({ listing: e.target.value === "listed" ? null : e.target.value })}>
                  <option value="listed">Approved and admin-added</option>
                  <option value="awaiting">Awaiting approval</option>
                  <option value="all">All companies</option>
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
                    listing: null,
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
            <table className="adm-table adm-table-fixed adm-mfg-table">
              <colgroup>
                <col className="adm-w-check" />
                <col className="adm-w-expand" />
                <col className="adm-w-main" />
                <col className="adm-w-status" />
                <col className="adm-w-complete" />
                <col className="adm-w-count" />
                <col className="adm-w-date" />
                <col className="adm-w-actions" />
              </colgroup>
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
                  <th aria-label="Details" />
                  <th>Company</th>
                  <th>Approval</th>
                  <th>Profile</th>
                  <th title="Users linked to this company">Users</th>
                  <th>Updated</th>
                  <th className="adm-th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="adm-empty-cell">
                      No manufacturers match these filters.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <Row
                    key={r.id}
                    r={r}
                    expanded={expanded === r.id}
                    onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                    onMachinery={() => go(`/admin/machinery?org=${r.id}`)}
                    selected={selected.includes(r.id)}
                    onSelect={(on) => setSelected(on ? [...selected, r.id] : selected.filter((id) => id !== r.id))}
                    onOpen={(tab) => go(`/admin/manufacturers/${r.id}${tab ? `?tab=${tab}` : ""}`)}
                    onArchive={() => setConfirm({ ids: [r.id], archive: !r.isArchived, batch: false })}
                    onRecordType={(type) => void setRecordType(r, type)}
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
  expanded,
  onToggle,
  onSelect,
  onOpen,
  onArchive,
  onMachinery,
  onRecordType,
}: {
  r: ManufacturerRow;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (on: boolean) => void;
  onOpen: (tab?: string) => void;
  onArchive: () => void;
  onMachinery: () => void;
  onRecordType: (type: RecordType) => void;
}) {
  const canBatch = r.recordType !== "REAL" && !r.isArchived;
  const name = r.companyName || "Unnamed company";
  const detailsId = `mfg-${r.id}`;
  return (
    <>
      <tr className={r.isArchived ? "adm-row-archived" : undefined}>
        <td className="adm-check-col">
          {canBatch && (
            <input type="checkbox" aria-label={`Select ${name}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} />
          )}
        </td>
        <td>
          <DetailsToggle open={expanded} onToggle={onToggle} controls={detailsId} label={name} />
        </td>
        <td>
          <div className="adm-name-line">
            <button type="button" className="adm-link adm-truncate" title={name} onClick={() => onOpen()}>
              {name}
            </button>
            <RecordBadge type={r.recordType} hideReal />
            {r.isArchived && <span className="badge badge-neutral">Archived</span>}
          </div>
          {(r.location || r.industry) && (
            <div className="adm-cell-sub">
              <Truncate text={[r.location, r.industry].filter(Boolean).join(" · ")} />
            </div>
          )}
          <div className="adm-cell-sub" title={r.onboardingSourceNote ?? undefined}>
            Source: {sourceText(r.onboardingSource, r.stagedSource)}
          </div>
        </td>
        <td>
          <ReviewBadge status={r.reviewStatus} />
        </td>
        <td>
          <Completeness value={r.completeness} done={r.requiredDone} total={r.requiredTotal} />
        </td>
        <td className="adm-num" title={`${r.linkedUsers ?? 0} linked user${r.linkedUsers === 1 ? "" : "s"}`}>
          {r.linkedUsers ?? 0}
        </td>
        <td className="adm-nowrap">{fmtAgo(r.lastUpdated)}</td>
        <td className="adm-td-actions">
          <ActionsMenu
            context={name}
            items={[
              { label: "View details", icon: <Eye size={15} />, onSelect: () => onOpen() },
              { label: "Edit company details", icon: <Pencil size={15} />, onSelect: () => onOpen("company") },
              { label: "Onboarding & review", icon: <ClipboardCheck size={15} />, onSelect: () => onOpen("onboarding") },
              { label: "View machinery", icon: <Cog size={15} />, onSelect: onMachinery },
              r.recordType === "REAL"
                ? { label: "Mark as demo", icon: <FlaskConical size={15} />, onSelect: () => onRecordType("DEMO"), group: true }
                : { label: "Mark as real", icon: <BadgeCheck size={15} />, onSelect: () => onRecordType("REAL"), group: true },
              r.isArchived
                ? { label: "Restore", icon: <ArchiveRestore size={15} />, onSelect: onArchive, group: true }
                : { label: "Archive", icon: <Archive size={15} />, onSelect: onArchive, danger: true, group: true },
            ]}
          />
        </td>
      </tr>
      {expanded && (
        <DetailsRow
          id={detailsId}
          colSpan={8}
          items={[
            ["Company contact", [r.contactEmail, r.contactPhone].filter(Boolean).join(" · ") || "No company contact details"],
            ["Primary user", r.primaryUser ? `${r.primaryUser.name || "—"} · ${r.primaryUser.email ?? ""}` : "No linked user"],
            ["Location", r.location],
            ["Industry", r.industry],
            ["Major process", r.majorProcess ? `${r.majorProcess}${r.listingCount > 1 ? ` (+${r.listingCount - 1} more)` : ""}` : "No listings"],
            ["Onboarding source", `${sourceText(r.onboardingSource, r.stagedSource)}${r.onboardingSourceNote ? ` — ${r.onboardingSourceNote}` : ""}`],
            ["Record type / entry source (admin)", (
              <span key="source" className="adm-badge-row">
                <RecordBadge type={r.recordType} />
                <EntryBadge source={r.entrySource} />
              </span>
            )],
            ["Registered", fmtDate(r.registeredAt)],
          ]}
        />
      )}
    </>
  );
}
