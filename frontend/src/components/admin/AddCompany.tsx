"use client";

import { useState } from "react";
import { useToast } from "@/components/admin/AdminShell";
import { Modal } from "@/components/admin/ui";
import { jsonBody, useAdminApi, useAdminHost } from "@/lib/admin/api";
import type { ManufacturerDetail } from "@/lib/admin/types";
import { ApiError } from "@/lib/api";

const FIELDS: { key: string; label: string; type?: string; required?: boolean; hint?: string }[] = [
  { key: "name", label: "Company name", required: true },
  { key: "category", label: "Company type / category" },
  { key: "country", label: "Country" },
  { key: "state", label: "State / province" },
  { key: "city", label: "City" },
  { key: "address", label: "Address" },
  { key: "website", label: "Website" },
  { key: "registration_id", label: "Registration id (GSTIN / CIN)" },
  { key: "email", label: "Contact email", type: "email" },
  { key: "phone", label: "Contact phone", type: "tel" },
  { key: "capacity", label: "Production capacity" },
  { key: "reason", label: "Why it is being added", hint: "e.g. met at a trade fair (kept in the company's history)" },
];

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Admin Entry: add a manufacturer company. The backend records it as "Admin Entry"; it has no
 * owner and is not approved until reviewed. A retry of the same form never creates a second record. */
export function AddCompanyModal({ onClose }: { onClose: () => void }) {
  const { go } = useAdminHost();
  const call = useAdminApi();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [idempotencyKey] = useState(newKey);
  const [err, setErr] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!(values.name ?? "").trim()) return setErr("Enter the company name.");
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) return setErr("Enter a valid email address.");
    setBusy(true);
    setErr("");
    setExistingId(null);
    try {
      const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]));
      const detail = await call<ManufacturerDetail>("/manufacturers", {
        ...jsonBody("POST", body),
        headers: { "Idempotency-Key": idempotencyKey },
      });
      toast("Company added — source: Admin Entry");
      go(`/admin/manufacturers/${detail.manufacturer.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add the company.");
      if (e instanceof ApiError && e.code === "duplicate_company" && typeof e.data?.existingId === "string") {
        setExistingId(e.data.existingId);
      }
      setBusy(false);
    }
  }

  return (
    <Modal title="Add company" onClose={onClose} wide>
      <p className="adm-modal-text">
        Adds a manufacturer company to XfactorY. It is recorded as <b>Admin Entry</b>, has no owner, and is not approved: it
        becomes visible to Visionaries only after approval and a complete profile. A user can later claim it.
      </p>
      <div className="adm-add-company-grid">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.key === "reason" || f.key === "address" ? "adm-span-2" : undefined}>
            <label htmlFor={`add-${f.key}`}>
              {f.label} {f.required && <span className="adm-req">*</span>}
            </label>
            <input
              id={`add-${f.key}`}
              type={f.type ?? "text"}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.hint}
              autoFocus={f.key === "name"}
            />
          </div>
        ))}
      </div>
      {err && <p className="field-error">{err}</p>}
      {existingId && (
        <button type="button" className="btn-text" onClick={() => go(`/admin/manufacturers/${existingId}`)}>
          Open the existing company
        </button>
      )}
      <div className="modal-actions">
        <button type="button" className="btn-secondary-full" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Adding…" : "Add company"}
        </button>
      </div>
    </Modal>
  );
}
