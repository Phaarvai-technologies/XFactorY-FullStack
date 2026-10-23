"use client";

import { KeyRound } from "lucide-react";
import { useState } from "react";
import { ErrorBox, Loading, Modal } from "@/components/admin/ui";
import { jsonBody, useAdminApi, useResource } from "@/lib/admin/api";
import type { AdminUser } from "@/lib/admin/types";

export type DetailsSaved = {
  admin: AdminUser;
  changed: string[];
  clerkSync: "updated" | "failed" | "not_needed";
};

const PHONE = /^\+?[0-9][0-9 ()-]{5,22}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The message shown after a save (the toast). */
export function savedMessage(res: DetailsSaved): string {
  if (res.changed.length === 0) return "No changes to save.";
  const who = res.admin.isYou ? "Your details were" : `${res.admin.name || res.admin.email}'s details were`;
  return res.clerkSync === "failed"
    ? `${who} saved, but the name could not be updated in the XfactorY account. Save again later, or the next XfactorY sign-in may bring back the old name.`
    : `${who} saved.`;
}

/** Edit an admin's name, phone and (admin-only accounts) sign-in email. Only changed fields are sent;
 * the backend checks who may edit whom and which fields. */
export function EditAdminModal({
  admin,
  onClose,
  onSaved,
  onChangePassword,
}: {
  admin: AdminUser;
  onClose: () => void;
  onSaved: (res: DetailsSaved) => void;
  /** Own details, signed in with the admin account: offers "Change password" here. */
  onChangePassword?: () => void;
}) {
  const call = useAdminApi();
  const [first, setFirst] = useState(admin.firstName ?? (admin.name ?? "").split(" ")[0] ?? "");
  const [last, setLast] = useState(admin.lastName ?? (admin.firstName ? "" : (admin.name ?? "").split(" ").slice(1).join(" ")));
  const [phone, setPhone] = useState(admin.phone ?? "");
  const [email, setEmail] = useState(admin.email);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const body: Record<string, string> = {};
  if (first.trim() !== (admin.firstName ?? "")) body.firstName = first.trim();
  if (last.trim() !== (admin.lastName ?? "")) body.lastName = last.trim();
  if (phone.trim() !== (admin.phone ?? "")) body.phone = phone.trim();
  if (admin.emailEditable && email.trim().toLowerCase() !== admin.email.toLowerCase()) body.email = email.trim();
  const dirty = Object.keys(body).length > 0;

  async function save() {
    if (!first.trim()) return setErr("First name is required.");
    if (phone.trim() && !PHONE.test(phone.trim())) return setErr("Enter a valid phone number (digits, spaces, + - ( ) only).");
    if (body.email !== undefined && !EMAIL.test(body.email)) return setErr("Enter a valid email address.");
    setBusy(true);
    setErr("");
    try {
      const res = await call<DetailsSaved>(`/admin-users/${admin.id}`, jsonBody("PATCH", body));
      onSaved(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the details.");
      setBusy(false);
    }
  }

  const title = admin.isYou ? "Edit my details" : `Edit details — ${admin.name || admin.email}`;
  return (
    <Modal title={title} onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="form-grid adm-form-2">
          <div>
            <label htmlFor="adm-ed-first">
              First name <span className="adm-req">*</span>
            </label>
            <input id="adm-ed-first" type="text" value={first} maxLength={80} onChange={(e) => setFirst(e.target.value)} autoFocus />
          </div>
          <div>
            <label htmlFor="adm-ed-last">Last name</label>
            <input id="adm-ed-last" type="text" value={last} maxLength={80} onChange={(e) => setLast(e.target.value)} />
          </div>
        </div>
        <label htmlFor="adm-ed-phone" style={{ marginTop: 14 }}>
          Phone
        </label>
        <input id="adm-ed-phone" type="tel" value={phone} maxLength={24} placeholder="+91 98765 43210" onChange={(e) => setPhone(e.target.value)} />
        <label htmlFor="adm-ed-email" style={{ marginTop: 14 }}>
          Sign-in email
        </label>
        <input
          id="adm-ed-email"
          type="email"
          value={email}
          maxLength={320}
          readOnly={!admin.emailEditable}
          aria-readonly={!admin.emailEditable}
          className={admin.emailEditable ? undefined : "adm-readonly"}
          onChange={(e) => setEmail(e.target.value)}
        />
        <p className="field-hint">
          {admin.emailEditable
            ? "Used to sign in at /admin/login. After a change, sign in with the new email."
            : admin.isDefault
              ? "The built-in administrator's email cannot be changed here."
              : "This admin signs in with an XfactorY account, so the email is managed in that account."}
          {admin.hasXyAccount && " The name is also updated in the XfactorY account."}
        </p>
        {err && <p className="field-error" role="alert">{err}</p>}
        {onChangePassword && (
          <p className="adm-pw-link">
            <button type="button" className="btn-text" onClick={onChangePassword}>
              <KeyRound size={14} /> Change password
            </button>
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-secondary-full" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "Edit my details" from the header: loads the signed-in admin's own record first. */
export function EditMyDetailsModal({
  onClose,
  onSaved,
  onChangePassword,
}: {
  onClose: () => void;
  onSaved: (res: DetailsSaved) => void;
  onChangePassword?: () => void;
}) {
  const { data, error, reload } = useResource<AdminUser[]>("/admin-users");
  const mine = data?.find((a) => a.isYou);
  if (mine) return <EditAdminModal admin={mine} onClose={onClose} onSaved={onSaved} onChangePassword={onChangePassword} />;
  return (
    <Modal title="Edit my details" onClose={onClose}>
      {error ? <ErrorBox message={error.message} onRetry={reload} /> : data ? <p className="adm-muted">Your admin record was not found.</p> : <Loading />}
    </Modal>
  );
}
