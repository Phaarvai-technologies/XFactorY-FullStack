"use client";

import { CheckCircle2, Lock, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { useAdminMe, useToast } from "@/components/admin/AdminShell";
import { jsonBody, useAdminApi } from "@/lib/admin/api";
import { fmtDateTime } from "@/lib/admin/format";
import type { ManufacturerApplication, ManufacturerDetail as Detail } from "@/lib/admin/types";

/** Admin roles allowed to decide applications (support specialists can read, not decide). */
export const DECIDE_ROLES = ["platform_administrator", "platform_operator", "verification_analyst"];

const STATUS: Record<ManufacturerApplication["status"], [string, string]> = {
  pending: ["badge-info", "Awaiting review"],
  changes_requested: ["badge-pending", "Corrections requested"],
  approved: ["badge-verified", "Approved"],
  rejected: ["badge-rejected", "Rejected"],
};

const EVENT_LABELS: Record<string, string> = {
  submitted: "Submitted",
  resubmitted: "Corrections sent",
  decision: "Decision",
  membership_granted: "Linked to the company",
  merged: "Details applied to the company",
};

type Decision = "approve" | "request_changes" | "reject";

/**
 * One applicant's manufacturer application: who applied (personal details), the company details
 * they sent next to the company record, the history, and the decision. The message is sent to
 * the applicant; the internal note never leaves the admin portal. Approving an application for an
 * existing company links the applicant as a member - never as owner, unless the admin explicitly
 * makes them the primary user of a company that has none.
 */
export function ApplicationReview({ app, onChange }: { app: ManufacturerApplication; onChange: (d: Detail) => void }) {
  const call = useAdminApi();
  const toast = useToast();
  const me = useAdminMe();
  const open = app.status === "pending" || app.status === "changes_requested";
  const canDecide = (me?.roles ?? []).some((r) => DECIDE_ROLES.includes(r));
  const [decision, setDecision] = useState<Decision | null>(null);
  const [feedback, setFeedback] = useState("");
  const [note, setNote] = useState("");
  const [fields, setFields] = useState<string[]>([]);
  const [makePrimary, setMakePrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [badge, label] = STATUS[app.status];
  const changed = new Set(app.changedOnResubmit);
  const idp = `app-${app.id}`;

  async function submit() {
    if (!decision) return;
    if (decision !== "approve" && !feedback.trim()) {
      setErr(decision === "reject" ? "Write the reason the applicant will see." : "Describe what needs correcting.");
      return;
    }
    if (decision === "request_changes" && fields.length === 0) {
      setErr("Choose at least one field the applicant should correct.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const next = await call<Detail>(`/applications/${app.id}/decision`, jsonBody("POST", {
        decision,
        feedback: feedback.trim() || null,
        internalNote: note.trim() || null,
        correctionFields: decision === "request_changes" ? fields : null,
        makePrimary: decision === "approve" && makePrimary,
        seen: app.seen,
      }));
      onChange(next);
      toast(decision === "approve" ? "Application approved — the applicant was notified"
        : decision === "reject" ? "Application rejected — the applicant was notified"
          : "Corrections requested — the applicant was notified");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the decision");
      setBusy(false);
    }
  }

  return (
    <section className="card adm-section adm-application" aria-labelledby={`${idp}-title`}>
      <div className="adm-section-head">
        <h3 id={`${idp}-title`}>Application · {app.kindLabel}</h3>
        <span className={`badge ${badge}`}>{label}</span>
      </div>
      <p className="field-hint">
        {app.applicant.name || "Applicant"}
        {app.applicant.personalEmail ? ` · ${app.applicant.personalEmail}` : ""}
        {` · sent ${fmtDateTime(app.submittedAt)}`}
        {app.applicant.isMember ? " · member of this company" : ""}
      </p>
      {app.kind !== "new_company" ? (
        <p className="adm-section-hint">
          Applies to join this existing company. This applicant&rsquo;s review does not change the company&rsquo;s own
          approval, owner or other members{app.companyHasOwner ? "" : " (the company has no primary user yet)"}.
        </p>
      ) : null}

      <div className="adm-table-wrap">
        <table className="adm-table adm-table-compact" aria-label="Personal information">
          <thead>
            <tr><th>Personal information</th><th>Submitted</th></tr>
          </thead>
          <tbody>
            {app.personal.map((f) => (
              <tr key={f.key} className={changed.has(f.key) ? "adm-row-changed" : undefined}>
                <td>{f.label}{changed.has(f.key) ? <span className="badge badge-info adm-inline-badge">Corrected</span> : null}</td>
                <td className="adm-break">{f.value || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="adm-table-wrap">
        <table className="adm-table adm-table-compact" aria-label="Company information">
          <thead>
            <tr><th>Company information</th><th>Submitted</th><th>Company record</th></tr>
          </thead>
          <tbody>
            {app.company.map((f) => (
              <tr key={f.key} className={changed.has(f.key) ? "adm-row-changed" : undefined}>
                <td>
                  {f.label}
                  {changed.has(f.key) ? <span className="badge badge-info adm-inline-badge">Corrected</span> : null}
                  {f.supplied ? <span className="badge badge-pending adm-inline-badge">Missing - supplied</span> : null}
                </td>
                <td className="adm-break">{f.submitted || "—"}</td>
                <td className="adm-break">{f.current || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {app.kind === "new_company" ? (
        <p className="field-hint">Approving applies these company details to the record (once).</p>
      ) : (
        <p className="field-hint">
          Saved company details are never changed by this application. Details marked &ldquo;Missing - supplied&rdquo;
          are added on approval, only if the company still has no value for them; corrections to saved details are
          reviewed separately.
        </p>
      )}

      {app.feedback ? (
        <p className="adm-section-hint"><b>Sent to the applicant:</b> {app.feedback}</p>
      ) : null}
      {app.status === "changes_requested" && app.correctionFields.length ? (
        <p className="adm-section-hint">
          <b>Fields to correct:</b> {app.correctionFields.map((k) => app.correctable.find((c) => c.key === k)?.label ?? k).join(", ")}
        </p>
      ) : null}
      {app.internalNotes ? (
        <div className="adm-internal-note">
          <b><Lock size={13} /> Internal notes (not shared)</b>
          <p>{app.internalNotes}</p>
        </div>
      ) : null}

      <details className="adm-app-history">
        <summary>History ({app.events.length})</summary>
        <ul className="adm-timeline">
          {app.events.map((e, i) => (
            <li key={i}>
              <b>
                {EVENT_LABELS[e.event] ?? e.event}
                {typeof e.details.decision === "string" ? ` — ${e.details.decision.replace(/_/g, " ")}` : ""}
              </b>
              <span>{fmtDateTime(e.at)}{e.by ? ` · ${e.by}` : ""}</span>
            </li>
          ))}
        </ul>
      </details>

      {open && canDecide ? (
        <div className="adm-decision" role="group" aria-label="Decision">
          <div className="adm-btn-row">
            <button type="button" className={`btn-ghost${decision === "approve" ? " active" : ""}`} aria-pressed={decision === "approve"}
                    onClick={() => setDecision("approve")}>
              <CheckCircle2 size={15} /> Approve
            </button>
            <button type="button" className={`btn-ghost${decision === "request_changes" ? " active" : ""}`}
                    aria-pressed={decision === "request_changes"} onClick={() => setDecision("request_changes")}>
              <RotateCcw size={15} /> Request corrections
            </button>
            <button type="button" className={`btn-ghost${decision === "reject" ? " active" : ""}`} aria-pressed={decision === "reject"}
                    onClick={() => setDecision("reject")}>
              <XCircle size={15} /> Reject
            </button>
          </div>
          {decision ? (
            <>
              {decision === "request_changes" ? (
                <fieldset className="adm-fieldset">
                  <legend>Fields the applicant may correct</legend>
                  {app.correctable.map((c) => (
                    <label key={c.key} className="adm-toggle">
                      <input type="checkbox" checked={fields.includes(c.key)}
                             onChange={(e) => setFields((cur) => e.target.checked ? [...cur, c.key] : cur.filter((k) => k !== c.key))} />
                      {c.label}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {decision === "approve" && app.canMakePrimary ? (
                <label className="adm-toggle">
                  <input type="checkbox" checked={makePrimary} onChange={(e) => setMakePrimary(e.target.checked)} />
                  Also make this applicant the company&rsquo;s primary user (verified ownership)
                </label>
              ) : null}
              <label htmlFor={`${idp}-feedback`}>
                {decision === "reject" ? "Reason shown to the applicant" : decision === "request_changes"
                  ? "What needs correcting (shown to the applicant)" : "Message to the applicant"}
                {decision === "approve" ? <span className="optional"> (optional)</span> : <span className="adm-req"> *</span>}
              </label>
              <textarea id={`${idp}-feedback`} rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
              <label htmlFor={`${idp}-note`}>
                Internal note <span className="optional">(optional, never shown to the applicant)</span>
              </label>
              <textarea id={`${idp}-note`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              {err ? <p className="field-error" role="alert">{err}</p> : null}
              <div className="adm-btn-row">
                <button type="button" className="btn-primary adm-btn-sm" disabled={busy} onClick={() => void submit()}>
                  {busy ? "Saving…" : decision === "approve" ? "Approve application" : decision === "reject"
                    ? "Reject application" : "Send correction request"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : open ? (
        <p className="field-hint">Only administrators, operators and verification analysts can decide applications.</p>
      ) : (
        <p className="field-hint">
          {label}{app.reviewedBy ? ` by ${app.reviewedBy}` : ""}{app.reviewedAt ? ` · ${fmtDateTime(app.reviewedAt)}` : ""}
        </p>
      )}
    </section>
  );
}
