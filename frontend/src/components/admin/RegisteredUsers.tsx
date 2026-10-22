"use client";

import { RefreshCw, UserRound } from "lucide-react";
import { useEffect, useRef } from "react";
import { AccountBadge, ErrorBox, Loading } from "@/components/admin/ui";
import { useAdminHost, useResource } from "@/lib/admin/api";
import { MEMBERSHIP_LABELS, fmtDate, fmtDateTime } from "@/lib/admin/format";
import type { CompanyPeople, CompanyPerson } from "@/lib/admin/types";

/** A user's manufacturer application for this company. */
const APPLICATION_LABELS: Record<string, string> = {
  pending: "Application awaiting review",
  changes_requested: "Corrections requested",
  approved: "Application approved",
  rejected: "Application rejected",
};

const REQUEST_TONE: Record<string, string> = {
  pending: "badge-info",
  changes_requested: "badge-pending",
  approved: "badge-verified",
  rejected: "badge-rejected",
};

/**
 * Registered Users (memberships of exactly this company, by its database id) and, separately,
 * onboarding / change requests from users. Requesters are not members and are not counted.
 * Refetches when `refreshKey` changes (an action on this page) and when the admin returns to the tab.
 */
export function RegisteredUsers({ orgId, refreshKey }: { orgId: string; refreshKey?: unknown }) {
  const { go } = useAdminHost();
  const { data, error, loading, reload } = useResource<CompanyPeople>(`/manufacturers/${orgId}/people`, {
    refreshOnFocus: true,
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
  }, [refreshKey, reload]);

  const refresh = (
    <button type="button" className="btn-text adm-nowrap" onClick={reload} disabled={loading} aria-label="Refresh users and requests">
      <RefreshCw size={14} /> Refresh
    </button>
  );
  if (!data) {
    return (
      <section className="card adm-section" aria-labelledby="ru-title">
        <div className="adm-section-head">
          <h3 id="ru-title">Registered Users</h3>
          {refresh}
        </div>
        {error ? <ErrorBox message={error.message} onRetry={reload} /> : <Loading label="Loading users…" />}
      </section>
    );
  }
  const users = data.registeredUsers;
  const requests = data.requests;
  /** The company's owner; the others are listed separately (each once, by membership). */
  const primary = data.primaryUser ?? users.find((u) => u.role === "owner" && u.membershipStatus === "active") ?? null;
  const others = data.otherUsers ?? users.filter((u) => u.id !== primary?.id);
  const personal = (u: { email: string; personalEmail?: string }) => u.personalEmail || u.email;
  const userTable = (list: CompanyPerson[], label: string) => (
          <div className="adm-table-wrap">
            <table className="adm-table adm-table-fixed adm-ru-table" aria-label={label}>
              <colgroup>
                <col className="adm-w-main" />
                <col className="adm-w-ru-id" />
                <col className="adm-w-count" />
                <col className="adm-w-status" />
                <col className="adm-w-date" />
                <col className="adm-w-ru-open" />
              </colgroup>
              <thead>
                <tr>
                  <th>User</th>
                  <th>User ID</th>
                  <th>Role</th>
                  <th>Membership</th>
                  <th>Registered</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id} className={u.membershipStatus !== "active" && u.membershipStatus !== "pending" ? "adm-row-archived" : undefined}>
                    <td>
                      <div className="adm-cell-main adm-truncate" title={u.name ?? ""}>{u.name || "—"}</div>
                      <div className="adm-cell-sub adm-truncate" title={`Personal email ${personal(u)} · signs in as ${u.email}`}>
                        {personal(u)}
                      </div>
                    </td>
                    <td>
                      <code className="adm-code adm-truncate adm-block" title={u.id}>{u.id}</code>
                    </td>
                    <td className="adm-capitalize">{u.role}</td>
                    <td>
                      <span className={`badge ${u.membershipStatus === "active" ? "badge-verified" : "badge-neutral"}`}>
                        {MEMBERSHIP_LABELS[u.membershipStatus] ?? u.membershipStatus}
                      </span>
                      {u.accountStatus !== "active" && (
                        <div className="adm-cell-sub">
                          <AccountBadge status={u.accountStatus} />
                        </div>
                      )}
                      {u.applicationStatus && (
                        <div className="adm-cell-sub adm-truncate" title={APPLICATION_LABELS[u.applicationStatus] ?? u.applicationStatus}>
                          {APPLICATION_LABELS[u.applicationStatus] ?? u.applicationStatus}
                        </div>
                      )}
                    </td>
                    <td className="adm-nowrap" title={u.linkedAt ? `Linked ${fmtDateTime(u.linkedAt)}` : undefined}>
                      {fmtDate(u.registeredAt ?? u.linkedAt)}
                    </td>
                    <td>
                      <button type="button" className="btn-text adm-nowrap" onClick={() => go(`/admin/users/${u.id}`)} aria-label={`Open user ${u.name || u.email}`}>
                        <UserRound size={14} /> Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
  );

  return (
    <>
      <section className={`card adm-section${loading ? " adm-stale" : ""}`} aria-labelledby="ru-title">
        <div className="adm-section-head">
          <h3 id="ru-title">
            Registered Users <span className="adm-tab-count" title="Distinct users with an active membership">{data.counts.linkedUsers}</span>
          </h3>
          {refresh}
        </div>
        <p className="adm-section-hint">
          People linked to this company by membership, with their personal emails. These are not the company&rsquo;s
          contact details.
        </p>
        {error && <ErrorBox message={error.message} onRetry={reload} />}
        <p className="adm-section-hint">
          <b>Primary user</b>
          {data.primaryProposed ? " (proposed — confirmed when X!Y approves the company)" : ""}
        </p>
        {primary ? userTable([primary], "Primary user") : <p className="adm-muted">No primary user (owner) yet.</p>}
        <p className="adm-section-hint">
          <b>Other Users</b> (members, and applicants awaiting approval)
        </p>
        {others.length === 0 ? (
          <p className="adm-muted">No other users are linked to this company.</p>
        ) : userTable(others, "Other Users")}
      </section>

      <section className={`card adm-section${loading ? " adm-stale" : ""}`} aria-labelledby="rq-title">
        <div className="adm-section-head">
          <h3 id="rq-title">
            Onboarding requests <span className="adm-tab-count" title="Awaiting a decision">{data.counts.openRequests}</span>
          </h3>
        </div>
        <p className="adm-section-hint">
          Details submitted by users for this company. A request is not a membership and gives no access; it is
          not counted under Registered Users.
        </p>
        {requests.length === 0 ? (
          <p className="adm-muted">No requests submitted for this company.</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table adm-table-fixed adm-ru-table">
              <colgroup>
                <col className="adm-w-main" />
                <col className="adm-w-request" />
                <col className="adm-w-status" />
                <col className="adm-w-date" />
                <col className="adm-w-status" />
              </colgroup>
              <thead>
                <tr>
                  <th>Requester</th>
                  <th>Request</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>Membership</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="adm-cell-main adm-truncate" title={r.requester?.name ?? ""}>
                        {r.requester?.name || r.requester?.email || "Automated"}
                      </div>
                      {r.requester && (
                        <div className="adm-cell-sub adm-truncate" title={`${personal(r.requester)} · ${r.requester.id}`}>
                          {personal(r.requester)}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="adm-truncate" title={r.kindLabel}>{r.kindLabel}</div>
                      {r.feedback && <div className="adm-cell-sub adm-truncate" title={r.feedback}>“{r.feedback}”</div>}
                    </td>
                    <td>
                      <span className={`badge ${REQUEST_TONE[r.status] ?? "badge-neutral"}`}>{r.statusLabel}</span>
                      {r.reviewedAt && (
                        <div className="adm-cell-sub adm-truncate" title={`${r.reviewer ?? "Admin"} · ${fmtDateTime(r.reviewedAt)}`}>
                          {r.reviewer ?? "Admin"} · {fmtDate(r.reviewedAt)}
                        </div>
                      )}
                    </td>
                    <td className="adm-nowrap">{fmtDate(r.submittedAt)}</td>
                    <td>
                      {r.requesterIsMember ? (
                        <span className="badge badge-verified">Member</span>
                      ) : (
                        <span className="badge badge-neutral">Not a member</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
