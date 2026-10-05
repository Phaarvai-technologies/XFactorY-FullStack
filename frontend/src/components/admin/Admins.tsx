"use client";

import { Copy, KeyRound, RotateCcw, ShieldCheck, ShieldOff, UserPlus } from "lucide-react";
import { useState } from "react";
import { useAdminMe, useToast } from "@/components/admin/AdminShell";
import { ErrorBox, Loading, Modal, PageHeader } from "@/components/admin/ui";
import { jsonBody, useAdminApi, useResource } from "@/lib/admin/api";
import { fmtAgo, fmtDate } from "@/lib/admin/format";
import type { AdminRole, AdminUser } from "@/lib/admin/types";

const ROLES: { value: AdminRole; label: string; hint: string }[] = [
  { value: "platform_administrator", label: "Administrator", hint: "Everything, including managing admins" },
  { value: "platform_operator", label: "Operator", hint: "Manufacturers, review and support" },
  { value: "support_specialist", label: "Support specialist", hint: "Users and support" },
  { value: "verification_analyst", label: "Verification analyst", hint: "Onboarding review" },
];

type Action =
  | { kind: "add" }
  | { kind: "revoke" | "restore" | "reset"; admin: AdminUser }
  | { kind: "password"; email: string; password: string; reason: "added" | "reset" };

function StatusBadge({ admin }: { admin: AdminUser }) {
  if (admin.status === "revoked") return <span className="badge badge-rejected">Revoked</span>;
  if (admin.status === "suspended") return <span className="badge badge-pending">Account suspended</span>;
  if (admin.locked) return <span className="badge badge-pending">Locked (wrong passwords)</span>;
  if (admin.mustChangePassword) return <span className="badge badge-pending">Temporary password</span>;
  return <span className="badge badge-verified">Active</span>;
}

/** Admins tab: every admin, with grant / revoke for administrators. */
export function Admins() {
  const call = useAdminApi();
  const toast = useToast();
  const me = useAdminMe();
  const canManage = !!me?.roles.includes("platform_administrator");
  const { data, error, loading, reload } = useResource<AdminUser[]>("/admin-users");
  const [action, setAction] = useState<Action | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function changeRole(admin: AdminUser, role: AdminRole) {
    setBusyId(admin.id);
    try {
      await call(`/admin-users/${admin.id}/role`, jsonBody("PATCH", { role }));
      toast(`${admin.name || admin.email} is now ${ROLES.find((r) => r.value === role)?.label}.`);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not change the role.");
    } finally {
      setBusyId(null);
    }
  }

  const active = data?.filter((a) => a.status !== "revoked").length ?? 0;
  return (
    <>
      <PageHeader
        title="Admins"
        subtitle="People who can sign in to this admin portal. Registered X!Y users are listed under Users."
        actions={
          canManage && (
            <button type="button" className="btn-primary" onClick={() => setAction({ kind: "add" })}>
              <UserPlus size={15} /> Add admin
            </button>
          )
        }
      />
      {!canManage && data && (
        <p className="field-hint" style={{ marginBottom: 12 }}>
          Only administrators can grant or revoke admin access.
        </p>
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
                  <th>Admin</th>
                  <th>Role</th>
                  <th>Sign-in</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th>Access granted</th>
                  {canManage && <th aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {data.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 7 : 6} className="adm-empty-cell">
                      No admins yet.
                    </td>
                  </tr>
                )}
                {data.map((a) => {
                  const locked = a.isDefault || a.isYou || a.status !== "active";
                  return (
                    <tr key={a.id}>
                      <td>
                        <b>{a.name || a.email}</b>
                        {a.isYou && <span className="badge badge-info" style={{ marginLeft: 6 }}>You</span>}
                        {a.isDefault && (
                          <span className="badge badge-purple" style={{ marginLeft: 6 }}>
                            <ShieldCheck size={11} style={{ marginRight: 3 }} /> Built-in
                          </span>
                        )}
                        <div className="adm-cell-sub">{a.email}</div>
                      </td>
                      <td>
                        {canManage && !locked ? (
                          <select
                            className="adm-select-sm"
                            aria-label={`Role of ${a.email}`}
                            value={a.role}
                            disabled={busyId === a.id}
                            onChange={(e) => void changeRole(a, e.target.value as AdminRole)}
                          >
                            {ROLES.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          a.roleLabel || <span className="adm-muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="adm-badge-stack">
                          {a.hasAdminAccount && <span className="badge badge-neutral">Admin account</span>}
                          {a.hasXyAccount && <span className="badge badge-neutral">X!Y account</span>}
                        </div>
                      </td>
                      <td>
                        <StatusBadge admin={a} />
                        {a.revokedAt && <div className="adm-cell-sub">since {fmtDate(a.revokedAt)}</div>}
                      </td>
                      <td className="adm-nowrap">{a.lastSignIn ? fmtAgo(a.lastSignIn) : <span className="adm-muted">Never</span>}</td>
                      <td className="adm-nowrap">
                        {a.grantedAt ? fmtDate(a.grantedAt) : <span className="adm-muted">—</span>}
                        {a.grantedBy && <div className="adm-cell-sub">by {a.grantedBy}</div>}
                      </td>
                      {canManage && (
                        <td>
                          <div className="adm-row-actions">
                            {a.status === "revoked" ? (
                              <button type="button" className="btn-ghost adm-btn-sm" onClick={() => setAction({ kind: "restore", admin: a })}>
                                <RotateCcw size={14} /> Restore
                              </button>
                            ) : (
                              !a.isDefault &&
                              !a.isYou && (
                                <>
                                  {a.hasAdminAccount && (
                                    <button type="button" className="btn-ghost adm-btn-sm" onClick={() => setAction({ kind: "reset", admin: a })}>
                                      <KeyRound size={14} /> Reset password
                                    </button>
                                  )}
                                  <button type="button" className="btn-danger-ghost adm-btn-sm" onClick={() => setAction({ kind: "revoke", admin: a })}>
                                    <ShieldOff size={14} /> Revoke
                                  </button>
                                </>
                              )
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="field-hint adm-table-foot">
            {active} active admin{active === 1 ? "" : "s"}. The built-in administrator and your own access can only be
            changed from the terminal.
          </p>
        </div>
      )}

      {action?.kind === "add" && (
        <AddAdminModal
          onClose={() => setAction(null)}
          onAdded={(email, password) => {
            reload();
            setAction({ kind: "password", email, password, reason: "added" });
          }}
        />
      )}
      {action && (action.kind === "revoke" || action.kind === "restore" || action.kind === "reset") && (
        <ConfirmModal
          action={action.kind}
          admin={action.admin}
          onClose={() => setAction(null)}
          onDone={(message, password) => {
            reload();
            if (password) setAction({ kind: "password", email: action.admin.email, password, reason: "reset" });
            else {
              setAction(null);
              toast(message);
            }
          }}
        />
      )}
      {action?.kind === "password" && (
        <TemporaryPasswordModal email={action.email} password={action.password} reason={action.reason} onClose={() => setAction(null)} />
      )}
    </>
  );
}

function AddAdminModal({ onClose, onAdded }: { onClose: () => void; onAdded: (email: string, password: string) => void }) {
  const call = useAdminApi();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AdminRole>("platform_administrator");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErr("Enter a valid email address.");
    setBusy(true);
    setErr("");
    try {
      const res = await call<{ admin: AdminUser; temporaryPassword: string }>(
        "/admin-users",
        jsonBody("POST", { email: email.trim(), name: name.trim(), role }),
      );
      onAdded(res.admin.email, res.temporaryPassword);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add the admin.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Add admin" onClose={onClose}>
      <p className="adm-modal-text">
        They sign in at /admin/login with this email and a temporary password, and choose their own password at the
        first sign-in. If the email already has an X!Y account, that account gets admin access too.
      </p>
      <label htmlFor="adm-new-email">
        Email <span className="adm-req">*</span>
      </label>
      <input id="adm-new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      <label htmlFor="adm-new-name" style={{ marginTop: 14 }}>
        Name
      </label>
      <input id="adm-new-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="adm-new-role" style={{ marginTop: 14 }}>
        Role
      </label>
      <select id="adm-new-role" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
        {ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label} — {r.hint}
          </option>
        ))}
      </select>
      {err && <p className="field-error">{err}</p>}
      <div className="modal-actions">
        <button type="button" className="btn-secondary-full" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Adding…" : "Add admin"}
        </button>
      </div>
    </Modal>
  );
}

function ConfirmModal({
  action,
  admin,
  onClose,
  onDone,
}: {
  action: "revoke" | "restore" | "reset";
  admin: AdminUser;
  onClose: () => void;
  onDone: (message: string, temporaryPassword?: string) => void;
}) {
  const call = useAdminApi();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const who = admin.name || admin.email;
  const text = {
    revoke: `${who} will lose access to the admin portal immediately and be signed out. Their X!Y account (if any) is not affected.`,
    restore: `${who} will get admin access again as ${admin.roleLabel || "Administrator"}, with their existing password.`,
    reset: `${who} gets a new temporary password and is signed out. They must choose a new password at the next sign-in.`,
  }[action];
  const title = { revoke: "Revoke admin access", restore: "Restore admin access", reset: "Reset password" }[action];

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      if (action === "reset") {
        const res = await call<{ temporaryPassword: string }>(`/admin-users/${admin.id}/reset-password`, { method: "POST" });
        onDone("", res.temporaryPassword);
      } else {
        await call(`/admin-users/${admin.id}/${action}`, jsonBody("POST", {}));
        onDone(action === "revoke" ? `Admin access revoked for ${who}.` : `Admin access restored for ${who}.`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update admin access.");
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p className="adm-modal-text">{text}</p>
      {err && <p className="field-error">{err}</p>}
      <div className="modal-actions">
        <button type="button" className="btn-secondary-full" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Saving…" : { revoke: "Revoke access", restore: "Restore access", reset: "Reset password" }[action]}
        </button>
      </div>
    </Modal>
  );
}

function TemporaryPasswordModal({
  email,
  password,
  reason,
  onClose,
}: {
  email: string;
  password: string;
  reason: "added" | "reset";
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={reason === "added" ? "Admin added" : "Password reset"} onClose={onClose}>
      <p className="adm-modal-text">
        Give {email} this temporary password through a secure channel. It is shown only now; they will be asked to
        choose their own password when they sign in at /admin/login.
      </p>
      <div className="adm-temp-password">
        <code>{password}</code>
        <button
          type="button"
          className="btn-ghost adm-btn-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(password).then(() => setCopied(true));
          }}
        >
          <Copy size={14} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
