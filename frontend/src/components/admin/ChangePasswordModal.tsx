"use client";

import { useState } from "react";
import { Modal } from "@/components/admin/ui";
import { jsonBody, useAdminApi } from "@/lib/admin/api";

/** For admin-account (email + password) sign-ins. Other devices are signed out. */
export function ChangePasswordModal({
  onClose,
  onDone,
  required = false,
}: {
  onClose: () => void;
  onDone: () => void;
  /** Temporary password: the modal cannot be dismissed until a new password is saved. */
  required?: boolean;
}) {
  const call = useAdminApi();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const rules = [
    { ok: next.length >= 12, label: "At least 12 characters" },
    { ok: /[A-Za-z]/.test(next) && /\d/.test(next), label: "Letters and at least one number" },
    { ok: !!next && next === repeat, label: "Both new passwords match" },
  ];

  async function save() {
    setError("");
    if (!current) return setError("Enter your current password.");
    if (!rules.every((r) => r.ok)) return setError("The new password does not meet the rules below.");
    setBusy(true);
    try {
      await call("/auth/change-password", jsonBody("POST", { current_password: current, new_password: next }));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the password.");
      setBusy(false);
    }
  }

  return (
    <Modal title={required ? "Choose your password" : "Change password"} onClose={onClose} closable={!required}>
      {required && (
        <p className="adm-modal-text">
          You signed in with a temporary password. Choose your own password to continue.
        </p>
      )}
      <label htmlFor="cp-current">{required ? "Temporary password" : "Current password"}</label>
      <input id="cp-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
      <label htmlFor="cp-new" style={{ marginTop: 14 }}>
        New password
      </label>
      <input id="cp-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      <label htmlFor="cp-repeat" style={{ marginTop: 14 }}>
        Repeat new password
      </label>
      <input id="cp-repeat" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      <ul className="adm-pw-rules">
        {rules.map((r) => (
          <li key={r.label} className={r.ok ? "ok" : ""}>
            {r.ok ? "✓" : "•"} {r.label}
          </li>
        ))}
      </ul>
      <p className="field-hint">Your other signed-in devices will be signed out.</p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        {!required && (
          <button type="button" className="btn-secondary-full" onClick={onClose}>
            Cancel
          </button>
        )}
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : required ? "Save and continue" : "Change password"}
        </button>
      </div>
    </Modal>
  );
}
