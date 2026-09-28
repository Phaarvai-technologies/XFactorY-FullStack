"use client";

import { CheckCircle2, ExternalLink, MessageSquarePlus } from "lucide-react";
import { useCallback, useState } from "react";
import { useAdminMe, useToast } from "@/components/admin/AdminShell";
import {
  Completeness,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  PillFilter,
  RecordBadge,
  ReviewBadge,
  SearchInput,
} from "@/components/admin/ui";
import { jsonBody, toQuery, useAdminApi, useAdminHost, useResource, useUrlFilters } from "@/lib/admin/api";
import { REVIEW_LABELS, REVIEW_ORDER, fmtAgo } from "@/lib/admin/format";
import type { ManufacturerRow, ReviewQueue as Queue, ReviewStatus } from "@/lib/admin/types";

type Pending =
  | { kind: "status"; row: ManufacturerRow; status: ReviewStatus }
  | { kind: "note"; row: ManufacturerRow };

export function ReviewQueue() {
  const { go } = useAdminHost();
  const call = useAdminApi();
  const toast = useToast();
  const me = useAdminMe();
  const f = useUrlFilters("/admin/review");
  const params = {
    q: f.get("q"),
    review_status: f.getAll("review_status"),
    assigned: f.get("assigned"),
    include_test: f.get("include_test") === "1",
  };
  const { data, error, loading, reload } = useResource<Queue>(`/review-queue${toQuery(params)}`);
  const setFilters = f.set;
  const commitSearch = useCallback((q: string) => setFilters({ q }), [setFilters]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(row: ManufacturerRow, body: Record<string, unknown>, done: string) {
    setBusy(row.id);
    try {
      await call(`/manufacturers/${row.id}/admin-fields`, jsonBody("PATCH", body));
      toast(done);
      reload();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submitPending() {
    if (!pending) return;
    setErr("");
    if (pending.kind === "note") {
      if (!text.trim()) return setErr("Write a note first.");
      try {
        await call(`/manufacturers/${pending.row.id}/notes`, jsonBody("POST", { note: text.trim() }));
        toast("Note added");
        setPending(null);
        setText("");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not add the note");
      }
      return;
    }
    if (pending.status === "NEEDS_CORRECTION" && text.trim().length < 3) return setErr("Explain what needs correcting.");
    const ok = await patch(
      pending.row,
      { review_status: pending.status, reason: text.trim() || null },
      `${pending.row.companyName || "Manufacturer"}: ${REVIEW_LABELS[pending.status]}`,
    );
    if (ok) {
      setPending(null);
      setText("");
    }
  }

  const rows = data?.rows ?? [];
  const counts = REVIEW_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = rows.filter((r) => r.reviewStatus === s).length;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Onboarding & review"
        subtitle="Profiles waiting for review come first, then those needing corrections and those still in progress. Reviewed profiles are hidden unless you filter for them."
      />
      <div className="card adm-toolbar">
        <div className="adm-toolbar-row">
          <SearchInput value={params.q} onCommit={commitSearch} placeholder="Search company, contact or email" />
          <select className="adm-select-sm" value={params.assigned} onChange={(e) => f.set({ assigned: e.target.value })} aria-label="Assignment">
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <label className="adm-toggle">
            <input type="checkbox" checked={params.include_test} onChange={(e) => f.set({ include_test: e.target.checked ? "1" : null })} />
            Include demo/test
          </label>
        </div>
        <div className="adm-toolbar-row">
          <PillFilter<ReviewStatus>
            options={REVIEW_ORDER}
            labels={REVIEW_LABELS}
            value={params.review_status as ReviewStatus[]}
            onChange={(v) => f.set({ review_status: v })}
          />
        </div>
      </div>

      {data && params.review_status.length === 0 && (
        <div className="adm-queue-summary">
          {(["SUBMITTED", "NEEDS_CORRECTION", "IN_PROGRESS", "NOT_STARTED"] as ReviewStatus[]).map((s) => (
            <button key={s} type="button" className="stat-chip adm-chip-btn" onClick={() => f.set({ review_status: [s] })}>
              <b>{counts[s]}</b>
              <span>{REVIEW_LABELS[s]}</span>
            </button>
          ))}
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
                  <th>Company</th>
                  <th>Completion</th>
                  <th>Last completed section</th>
                  <th>Missing required fields</th>
                  <th>Last activity</th>
                  <th>Assigned admin</th>
                  <th>Review status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="adm-empty-cell">
                      The queue is empty for these filters.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className={busy === r.id ? "adm-stale" : undefined}>
                    <td className="adm-col-company">
                      <button type="button" className="adm-link" onClick={() => go(`/admin/manufacturers/${r.id}?tab=onboarding`)}>
                        {r.companyName || "Unnamed company"}
                      </button>
                      <RecordBadge type={r.recordType} hideReal />
                      <div className="adm-cell-sub">{r.contactName || r.contactEmail || ""}</div>
                    </td>
                    <td>
                      <Completeness value={r.completeness} done={r.requiredDone} total={r.requiredTotal} />
                    </td>
                    <td>{r.lastCompletedSection ?? <span className="adm-muted">None yet</span>}</td>
                    <td className="adm-missing-cell">
                      {r.missingFields.length === 0 ? (
                        <span className="adm-ok-text">None</span>
                      ) : (
                        <span title={r.missingFields.join(", ")}>
                          <b>{r.missingFields.length}</b> · {r.missingFields.slice(0, 2).join(", ")}
                          {r.missingFields.length > 2 ? "…" : ""}
                        </span>
                      )}
                    </td>
                    <td className="adm-nowrap">{fmtAgo(r.lastUpdated)}</td>
                    <td>
                      <select
                        className="adm-inline-select"
                        value={r.assignedAdminId ?? ""}
                        disabled={busy !== null}
                        aria-label={`Assign ${r.companyName ?? "manufacturer"}`}
                        onChange={(e) =>
                          void patch(
                            r,
                            e.target.value ? { assigned_admin_id: e.target.value } : { unassign: true },
                            e.target.value ? "Admin assigned" : "Unassigned",
                          )
                        }
                      >
                        <option value="">Unassigned</option>
                        {data.admins.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.id === me?.id ? "Me" : a.name || a.email}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className={`adm-inline-select adm-status-select s-${r.reviewStatus}`}
                        value={r.reviewStatus}
                        disabled={busy !== null}
                        aria-label={`Review status for ${r.companyName ?? "manufacturer"}`}
                        onChange={(e) => {
                          setErr("");
                          setText("");
                          setPending({ kind: "status", row: r, status: e.target.value as ReviewStatus });
                        }}
                      >
                        {REVIEW_ORDER.map((s) => (
                          <option key={s} value={s}>
                            {REVIEW_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="adm-row-actions">
                        {r.reviewStatus !== "REVIEWED" && (
                          <button
                            type="button"
                            className="adm-icon-action ok"
                            title="Mark reviewed"
                            disabled={busy !== null}
                            onClick={() => void patch(r, { review_status: "REVIEWED" }, `${r.companyName || "Manufacturer"} marked reviewed`)}
                          >
                            <CheckCircle2 size={16} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="adm-icon-action"
                          title="Add internal note"
                          onClick={() => {
                            setErr("");
                            setText("");
                            setPending({ kind: "note", row: r });
                          }}
                        >
                          <MessageSquarePlus size={16} />
                        </button>
                        <button
                          type="button"
                          className="adm-icon-action"
                          title="Open"
                          onClick={() => go(`/admin/manufacturers/${r.id}?tab=onboarding`)}
                        >
                          <ExternalLink size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pending && (
        <Modal
          title={pending.kind === "note" ? "Add internal note" : `Change status to “${REVIEW_LABELS[pending.status]}”`}
          onClose={() => setPending(null)}
        >
          <p className="adm-modal-text">
            <b>{pending.row.companyName || "Unnamed company"}</b>
            {pending.kind === "status" && <> · currently <ReviewBadge status={pending.row.reviewStatus} /></>}
          </p>
          <label htmlFor="q-text">
            {pending.kind === "note" ? (
              "Note (only admins can see this)"
            ) : pending.status === "NEEDS_CORRECTION" ? (
              <>
                What needs correcting? <span className="adm-req">*</span>
              </>
            ) : (
              <>
                Reason <span className="optional">(optional)</span>
              </>
            )}
          </label>
          <textarea id="q-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          {err && <p className="field-error">{err}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary-full" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void submitPending()}>
              {pending.kind === "note" ? "Add note" : "Save status"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
