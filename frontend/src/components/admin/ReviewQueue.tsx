"use client";

import { CheckCircle2, ExternalLink, MessageSquarePlus, RotateCcw, UserCheck, UserMinus, XCircle } from "lucide-react";
import { Fragment, useCallback, useState } from "react";
import { useAdminMe, useToast } from "@/components/admin/AdminShell";
import {
  ActionsMenu,
  Completeness,
  DetailsRow,
  DetailsToggle,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  PillFilter,
  RecordBadge,
  ReviewBadge,
  SearchInput,
  Truncate,
} from "@/components/admin/ui";
import { jsonBody, toQuery, useAdminApi, useAdminHost, useResource, useUrlFilters } from "@/lib/admin/api";
import { REVIEW_LABELS, REVIEW_ORDER, fmtAgo, fmtDate } from "@/lib/admin/format";
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
  const [share, setShare] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

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
        await call(`/manufacturers/${pending.row.id}/notes`, jsonBody("POST", { note: text.trim(), share }));
        toast(share ? "Note added and sent to the manufacturer" : "Note added");
        setPending(null);
        setText("");
        setShare(false);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not add the note");
      }
      return;
    }
    if (pending.status === "NEEDS_CORRECTION" && text.trim().length < 3) return setErr("Explain what needs correcting.");
    if (pending.status === "REJECTED" && text.trim().length < 3) return setErr("Explain why it is rejected.");
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
        subtitle="All requests in one place: new company accounts, claims, changes to company details and onboarding still in progress. Requests waiting for a decision come first; approved companies are hidden unless you filter for them."
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
            <table className="adm-table adm-table-fixed">
              <colgroup>
                <col className="adm-w-expand" />
                <col className="adm-w-main" />
                <col className="adm-w-request" />
                <col className="adm-w-date" />
                <col className="adm-w-status" />
                <col className="adm-w-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th aria-label="Details" />
                  <th>Company / requester</th>
                  <th>Request</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th className="adm-th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="adm-empty-cell">
                      The queue is empty for these filters.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const name = r.companyName || "Unnamed company";
                  const detailsId = `rq-${r.id}`;
                  const isOpen = open === r.id;
                  const openRequest = () => go(`/admin/manufacturers/${r.id}?tab=onboarding`);
                  // Update requests from other users are decided in their own section of the request page;
                  // the company-level status control does not approve them.
                  const separateDecision = r.request?.kind === "update_request";
                  const ask = (status: ReviewStatus) => {
                    setErr("");
                    setText("");
                    setPending({ kind: "status", row: r, status });
                  };
                  return (
                    <Fragment key={r.id}>
                      <tr className={busy === r.id ? "adm-stale" : undefined}>
                        <td>
                          <DetailsToggle open={isOpen} onToggle={() => setOpen(isOpen ? null : r.id)} controls={detailsId} label={name} />
                        </td>
                        <td>
                          <div className="adm-name-line">
                            <button type="button" className="adm-link adm-truncate" title={name} onClick={openRequest}>
                              {name}
                            </button>
                            <RecordBadge type={r.recordType} hideReal />
                          </div>
                          <div className="adm-cell-sub">
                            <Truncate text={r.request?.requestedBy || r.primaryUser?.name || r.primaryUser?.email || null} />
                          </div>
                        </td>
                        <td>
                          <Truncate text={r.request?.label ?? (r.reviewStatus === "NOT_STARTED" ? "Onboarding not started" : "Onboarding")} />
                          {r.request && r.request.openCount > 1 && (
                            <div className="adm-cell-sub">+{r.request.openCount - 1} more open</div>
                          )}
                        </td>
                        <td className="adm-nowrap">{r.request?.submittedAt ? fmtDate(r.request.submittedAt) : <span className="adm-muted">—</span>}</td>
                        <td>
                          <ReviewBadge status={r.reviewStatus} />
                        </td>
                        <td className="adm-td-actions">
                          <ActionsMenu
                            context={name}
                            items={[
                              { label: separateDecision ? "Open request to decide" : "Open request", icon: <ExternalLink size={15} />, onSelect: openRequest },
                              {
                                label: "Approve",
                                icon: <CheckCircle2 size={15} />,
                                hidden: r.reviewStatus === "REVIEWED" || separateDecision,
                                disabled: busy !== null,
                                group: true,
                                onSelect: () => void patch(r, { review_status: "REVIEWED" }, `${name} approved`),
                              },
                              {
                                label: "Request corrections…",
                                icon: <RotateCcw size={15} />,
                                hidden: r.reviewStatus === "NEEDS_CORRECTION" || separateDecision,
                                onSelect: () => ask("NEEDS_CORRECTION"),
                              },
                              {
                                label: "Reject…",
                                icon: <XCircle size={15} />,
                                danger: true,
                                hidden: r.reviewStatus === "REJECTED" || separateDecision,
                                onSelect: () => ask("REJECTED"),
                              },
                              ...(["SUBMITTED", "IN_PROGRESS", "NOT_STARTED"] as ReviewStatus[])
                                .filter((st) => st !== r.reviewStatus && !separateDecision)
                                .map((st, i) => ({ label: `Set to ${REVIEW_LABELS[st]}…`, onSelect: () => ask(st), group: i === 0 })),
                              {
                                label: "Add internal note",
                                icon: <MessageSquarePlus size={15} />,
                                group: true,
                                onSelect: () => {
                                  setErr("");
                                  setText("");
                                  setPending({ kind: "note", row: r });
                                },
                              },
                              {
                                label: "Assign to me",
                                icon: <UserCheck size={15} />,
                                hidden: !me || r.assignedAdminId === me.id,
                                disabled: busy !== null,
                                onSelect: () => void patch(r, { assigned_admin_id: me?.id }, "Assigned to you"),
                              },
                              {
                                label: "Unassign",
                                icon: <UserMinus size={15} />,
                                hidden: !r.assignedAdminId,
                                disabled: busy !== null,
                                onSelect: () => void patch(r, { unassign: true }, "Unassigned"),
                              },
                            ]}
                          />
                        </td>
                      </tr>
                      {isOpen && (
                        <DetailsRow
                          id={detailsId}
                          colSpan={6}
                          items={[
                            ["Profile completion", <Completeness key="c" value={r.completeness} done={r.requiredDone} total={r.requiredTotal} />],
                            ["Last completed section", r.lastCompletedSection ?? "None yet"],
                            ["Missing required fields", r.missingFields.length ? r.missingFields.join(", ") : "None"],
                            ["Last activity", fmtAgo(r.lastUpdated)],
                            ["Company contact", [r.contactEmail, r.contactPhone].filter(Boolean).join(" · ") || null],
                            ["Primary user", r.primaryUser ? [r.primaryUser.name, r.primaryUser.email].filter(Boolean).join(" · ") : null],
                            [
                              "Assigned admin",
                              <select
                                key="assign"
                                className="adm-inline-select"
                                value={r.assignedAdminId ?? ""}
                                disabled={busy !== null}
                                aria-label={`Assign ${name}`}
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
                              </select>,
                            ],
                          ]}
                        />
                      )}
                    </Fragment>
                  );
                })}
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
              share ? "Message for the manufacturer" : "Note (only admins can see this)"
            ) : pending.status === "NEEDS_CORRECTION" ? (
              <>
                What needs correcting? <span className="adm-req">*</span>
              </>
            ) : pending.status === "REJECTED" ? (
              <>
                Reason for rejection <span className="adm-req">*</span>
              </>
            ) : (
              <>
                Reason <span className="optional">(optional)</span>
              </>
            )}
          </label>
          <textarea id="q-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          {pending.kind === "note" && (
            <label className="adm-toggle adm-share-toggle">
              <input id="q-share" type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
              Show to manufacturer (they get a notification)
            </label>
          )}
          {pending.kind === "status" && pending.status === "NEEDS_CORRECTION" && (
            <p className="field-hint">The manufacturer gets this note as a notification and a popup on their dashboard.</p>
          )}
          {err && <p className="field-error">{err}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary-full" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void submitPending()}>
              {pending.kind === "note" ? (share ? "Send to manufacturer" : "Add note") : "Save status"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
