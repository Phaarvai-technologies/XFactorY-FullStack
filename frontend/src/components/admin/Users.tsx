"use client";

import { Ban, Factory, RotateCcw, ShieldCheck } from "lucide-react";
import { useCallback, useState } from "react";
import { useAdminMe, useToast } from "@/components/admin/AdminShell";
import {
  AccountBadge,
  Completeness,
  EmailStatusBadge,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  RecordBadge,
  ReviewBadge,
  SearchInput,
} from "@/components/admin/ui";
import { jsonBody, toQuery, useAdminApi, useAdminHost, useResource, useUrlFilters } from "@/lib/admin/api";
import { REVIEW_LABELS, REVIEW_ORDER, fmtAgo, fmtDate, fmtDateTime } from "@/lib/admin/format";
import type { UserDetail, UserList, UserRow } from "@/lib/admin/types";

function OnboardingCell({ status }: { status: UserRow["onboardingStatus"] }) {
  if (status === "NO_PROFILE") return <span className="badge badge-neutral">No profile</span>;
  return <ReviewBadge status={status} />;
}

export function Users() {
  const { go } = useAdminHost();
  const f = useUrlFilters("/admin/users");
  const params = {
    q: f.get("q"),
    account_status: f.get("account_status"),
    onboarding_status: f.get("onboarding_status"),
    page: f.get("page") || "1",
    page_size: "25",
  };
  const { data, error, loading, reload } = useResource<UserList>(`/users${toQuery(params)}`);
  const setFilters = f.set;
  const commitSearch = useCallback((q: string) => setFilters({ q }), [setFilters]);

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Everyone who has registered. A user and the manufacturer they manage are separate records."
      />
      <div className="card adm-toolbar">
        <div className="adm-toolbar-row">
          <SearchInput value={params.q} onCommit={commitSearch} placeholder="Search name, email, phone or company" />
          <select
            className="adm-select-sm"
            value={params.account_status}
            onChange={(e) => f.set({ account_status: e.target.value })}
            aria-label="Account status"
          >
            <option value="">All account statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deactivated">Deleted</option>
          </select>
          <select
            className="adm-select-sm"
            value={params.onboarding_status}
            onChange={(e) => f.set({ onboarding_status: e.target.value })}
            aria-label="Onboarding status"
          >
            <option value="">All onboarding statuses</option>
            <option value="NO_PROFILE">No manufacturer profile</option>
            {REVIEW_ORDER.map((s) => (
              <option key={s} value={s}>
                {REVIEW_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {!data ? (
        loading && <Loading />
      ) : (
        <div className={`card adm-table-card${loading ? " adm-stale" : ""}`}>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Phone</th>
                  <th>Type</th>
                  <th>Linked manufacturer</th>
                  <th>Registered</th>
                  <th>Last activity</th>
                  <th>Account</th>
                  <th>Onboarding</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="adm-empty-cell">
                      No users match these filters.
                    </td>
                  </tr>
                )}
                {data.rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <button type="button" className="adm-link" onClick={() => go(`/admin/users/${u.id}`)}>
                        {u.name || u.email}
                      </button>
                      <div className="adm-cell-sub">{u.email}</div>
                    </td>
                    <td>{u.phone || <span className="adm-muted">—</span>}</td>
                    <td>
                      {u.isAdmin ? (
                        <span className="badge badge-info">
                          <ShieldCheck size={11} style={{ marginRight: 3 }} /> {u.staffOnly ? "Admin (staff)" : "Admin"}
                        </span>
                      ) : (
                        u.userType
                      )}
                    </td>
                    <td>
                      {u.manufacturerId ? (
                        <>
                          <button type="button" className="adm-link" onClick={() => go(`/admin/manufacturers/${u.manufacturerId}`)}>
                            {u.companyName || "Unnamed company"}
                          </button>
                          {u.recordType && u.recordType !== "REAL" && <RecordBadge type={u.recordType} />}
                        </>
                      ) : (
                        <span className="adm-muted">—</span>
                      )}
                    </td>
                    <td className="adm-nowrap">{fmtDate(u.registeredAt)}</td>
                    <td className="adm-nowrap">{fmtAgo(u.lastActivity)}</td>
                    <td>
                      <AccountBadge status={u.accountStatus} />
                    </td>
                    <td>
                      <OnboardingCell status={u.onboardingStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => f.set({ page: String(p) }, true)} />
        </div>
      )}
    </>
  );
}

/** User details + troubleshooting (XY-ADMIN-03 / 10). Read-only except suspend / reactivate. */
export function UserDetailView({ id }: { id: string }) {
  const { go } = useAdminHost();
  const call = useAdminApi();
  const toast = useToast();
  const me = useAdminMe();
  const { data, error, loading, reload, setData } = useResource<UserDetail>(`/users/${id}`);
  const [action, setAction] = useState<"suspend" | "reactivate" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!data) return loading ? <Loading /> : <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;
  const u = data.user;
  const t = data.troubleshooting;

  async function submit() {
    if (!action) return;
    if (reason.trim().length < 3) {
      setErr("Enter a reason (at least 3 characters).");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const next = await call<UserDetail>(`/users/${id}/${action}`, jsonBody("POST", { reason: reason.trim() }));
      setData(next);
      setAction(null);
      setReason("");
      toast(
        (action === "suspend" ? "Account suspended" : "Account reactivated") +
          (next.clerkSynced === false ? " (sign-in provider not updated — retry later)" : ""),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update the account");
    } finally {
      setBusy(false);
    }
  }

  const isSelf = me?.id === u.id;
  return (
    <>
      <PageHeader
        onBack={() => go("/admin/users")}
        title={u.name || u.email}
        subtitle={`${u.email}${u.phone ? ` · ${u.phone}` : ""} · Registered ${fmtDate(u.registeredAt)}`}
        actions={
          !isSelf &&
          u.accountStatus !== "deactivated" &&
          (u.accountStatus === "active" ? (
            <button type="button" className="btn-danger-ghost adm-btn-md" onClick={() => setAction("suspend")}>
              <Ban size={15} /> Suspend account
            </button>
          ) : (
            <button type="button" className="btn-ghost" onClick={() => setAction("reactivate")}>
              <RotateCcw size={15} /> Reactivate account
            </button>
          ))
        }
      />

      <div className="adm-two-col">
        <div className="adm-col">
          <section className="card adm-section">
            <div className="adm-section-head">
              <h3>Profile</h3>
              <span className="badge badge-neutral">Read-only</span>
            </div>
            <div className="details-grid">
              <div className="detail-item">
                <p className="detail-label">Name</p>
                <p className="detail-value">{u.name || "—"}</p>
              </div>
              <div className="detail-item">
                <p className="detail-label">Email</p>
                <p className="detail-value">{u.email}</p>
              </div>
              <div className="detail-item">
                <p className="detail-label">Phone</p>
                <p className="detail-value">{u.phone || "—"}</p>
              </div>
              <div className="detail-item">
                <p className="detail-label">User type</p>
                <p className="detail-value">
                  {u.isAdmin ? (u.staffOnly ? "Admin (staff-only account)" : "Admin") : u.userType}
                  {u.adminLogin && ` · admin email + password ${u.adminLogin === "active" ? "sign-in" : "sign-in (disabled)"}`}
                </p>
              </div>
              <div className="detail-item">
                <p className="detail-label">Account status</p>
                <div className="detail-value">
                  <AccountBadge status={u.accountStatus} />
                </div>
              </div>
              <div className="detail-item">
                <p className="detail-label">Roles</p>
                <p className="detail-value">{u.roles.length ? u.roles.join(", ") : "None selected yet"}</p>
              </div>
            </div>
          </section>

          <section className="card adm-section">
            <div className="adm-section-head">
              <h3>Linked manufacturer</h3>
            </div>
            {data.manufacturers.length === 0 ? (
              <p className="adm-muted">This user has not created a manufacturer profile.</p>
            ) : (
              <div className="adm-stack">
                {data.manufacturers.map((m) => (
                  <button
                    key={m.organization_id}
                    type="button"
                    className="adm-linked-mfg"
                    onClick={() => go(`/admin/manufacturers/${m.organization_id}`)}
                  >
                    <span className="nav-card-icon">
                      <Factory size={18} />
                    </span>
                    <div>
                      <b>{m.company_name || "Unnamed company"}</b>
                      <span className="adm-capitalize">{m.membership_role}</span>
                    </div>
                    <div className="adm-linked-side">
                      <ReviewBadge status={m.review_status} />
                      <RecordBadge type={m.record_type} hideReal />
                      <Completeness value={m.completeness} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="adm-col">
          <section className="card adm-section">
            <div className="adm-section-head">
              <h3>Troubleshooting</h3>
              <span className="adm-muted">No passwords, codes or tokens are ever shown</span>
            </div>
            <div className="details-grid">
              <div className="detail-item">
                <p className="detail-label">Last login</p>
                <p className="detail-value">
                  {t.lastLogin.available ? fmtDateTime(t.lastLogin.lastSignInAt) : "Unavailable (sign-in provider not reachable)"}
                </p>
              </div>
              <div className="detail-item">
                <p className="detail-label">Last activity</p>
                <p className="detail-value">{fmtDateTime(t.lastActivity)}</p>
              </div>
              <div className="detail-item">
                <p className="detail-label">Last successful save</p>
                <p className="detail-value">{fmtDateTime(t.lastSuccessfulSave)}</p>
              </div>
              <div className="detail-item">
                <p className="detail-label">Last onboarding section</p>
                <p className="detail-value">
                  {t.onboarding
                    ? `${t.onboarding.lastCompleted ?? "None completed"}${t.onboarding.stoppedAt ? ` → stopped at ${t.onboarding.stoppedAt}` : " (all done)"}`
                    : "No manufacturer profile"}
                </p>
              </div>
              <div className="detail-item">
                <p className="detail-label">Profile wizard step</p>
                <p className="detail-value">{t.profileWizardStep ?? "—"}</p>
              </div>
              <div className="detail-item">
                <p className="detail-label">Email delivery</p>
                <p className="detail-value">{t.notificationStatus}</p>
              </div>
            </div>
            {t.onboarding && t.onboarding.missingFields.length > 0 && (
              <p className="adm-section-hint">
                <b>Missing:</b> {t.onboarding.missingFields.join(", ")}
              </p>
            )}
          </section>

          {t.emails && t.emails.length > 0 && (
            <section className="card adm-section">
              <div className="adm-section-head">
                <h3>Emails sent to this user</h3>
                <span className="adm-muted">Latest {t.emails.length}</span>
              </div>
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Subject</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.emails.map((e) => (
                      <tr key={e.id}>
                        <td className="adm-nowrap">{fmtDateTime(e.created_at)}</td>
                        <td className="adm-wrap">
                          <div className="adm-cell-main">{e.subject}</div>
                          <div className="adm-cell-sub">{e.to_email}</div>
                        </td>
                        <td>
                          <EmailStatusBadge status={e.status} />
                          {e.error && <div className="adm-cell-sub adm-wrap">{e.error}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card adm-section">
            <div className="adm-section-head">
              <h3>Recent failed operations, sign-ins & account events</h3>
            </div>
            {t.events.length === 0 ? (
              <p className="adm-muted">No failed operations recorded.</p>
            ) : (
              <ul className="adm-events">
                {t.events.map((e, i) => (
                  <li key={i} className={e.kind === "error" || e.kind === "admin_login_failed" ? "err" : "acct"}>
                    <div className="adm-event-top">
                      {e.kind === "error" ? (
                        <span className="badge badge-rejected">
                          {e.status_code} {e.method}
                        </span>
                      ) : e.kind === "admin_login_failed" ? (
                        <span className="badge badge-rejected">Failed admin sign-in</span>
                      ) : e.kind === "admin_login" ? (
                        <span className="badge badge-info">Admin sign-in</span>
                      ) : (
                        <span className="badge badge-info">Account</span>
                      )}
                      <span className="adm-cell-sub">{fmtDateTime(e.created_at)}</span>
                    </div>
                    {e.path && <code className="adm-code">{e.path}</code>}
                    <p>{e.detail || "—"}</p>
                    {e.request_id && (
                      <span className="adm-cell-sub">
                        Error reference: <code className="adm-code">{e.request_id}</code>
                      </span>
                    )}
                    {e.actor && <span className="adm-cell-sub">By {e.actor}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {action && (
        <Modal title={action === "suspend" ? "Suspend account" : "Reactivate account"} onClose={() => setAction(null)}>
          <p className="adm-modal-text">
            {action === "suspend"
              ? `${u.name || u.email} will be signed out of X!Y and blocked from signing in until reactivated. Their data is kept.`
              : `${u.name || u.email} will be able to sign in and use X!Y again.`}
          </p>
          <label htmlFor="acct-reason">
            Reason <span className="adm-req">*</span>
          </label>
          <textarea id="acct-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          {err && <p className="field-error">{err}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary-full" onClick={() => setAction(null)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
              {busy ? "Saving…" : action === "suspend" ? "Suspend" : "Reactivate"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
