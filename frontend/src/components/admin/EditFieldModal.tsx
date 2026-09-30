"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/admin/ui";
import { jsonBody, useAdminApi } from "@/lib/admin/api";
import { LOGISTICS, PRICING_KEYS, displayValue, fieldSpec } from "@/lib/admin/fields";
import type { Certification, Faq, ManufacturerDetail } from "@/lib/admin/types";

export type EditTarget = { field: string; label: string; value: unknown; required: boolean };

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * XY-ADMIN-06: shows the current value next to the new one and requires a reason.
 * The backend validates with the onboarding rules and records old/new value,
 * admin, time and reason in the change history.
 */
export function EditFieldModal({
  orgId,
  target,
  onClose,
  onSaved,
}: {
  orgId: string;
  target: EditTarget;
  onClose: () => void;
  onSaved: (detail: ManufacturerDetail) => void;
}) {
  const call = useAdminApi();
  const spec = fieldSpec(target.field);
  const [value, setValue] = useState<unknown>(() => {
    const v = clone(target.value);
    if (spec.kind === "tags" || spec.kind === "logistics" || spec.kind === "certifications" || spec.kind === "faqs")
      return Array.isArray(v) ? v : [];
    if (spec.kind === "pricing") return { hour: "", day: "", month: "", unit: "", batch: "", ...((v as object) ?? {}) };
    return v ?? "";
  });
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const current = displayValue(target.value);

  async function save() {
    setError("");
    if (reason.trim().length < 3) {
      setError("Enter a reason for this change (at least 3 characters).");
      return;
    }
    let out = value;
    if (spec.kind === "certifications") out = (value as Certification[]).filter((c) => c.name.trim());
    if (spec.kind === "faqs") out = (value as Faq[]).filter((f) => f.q.trim() || f.a.trim());
    if (target.required && (out === "" || (typeof out === "string" && !out.trim()))) {
      setError(`${target.label} is required and cannot be empty.`);
      return;
    }
    setSaving(true);
    try {
      const detail = await call<ManufacturerDetail>(
        `/manufacturers/${orgId}/fields`,
        jsonBody("PATCH", { field: target.field, value: out, reason: reason.trim() }),
      );
      onSaved(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the change.");
      setSaving(false);
    }
  }

  const options = spec.options ? Array.from(new Set([...(spec.options ?? []), ...(typeof value === "string" && value ? [value] : [])])) : [];
  const wide = ["certifications", "faqs", "pricing"].includes(spec.kind);

  return (
    <Modal title={`Edit ${target.label}`} onClose={onClose} wide={wide}>
      <div className="adm-edit-current">
        <p className="detail-label">Current value</p>
        <div className={`adm-edit-current-value${current ? "" : " adm-muted"}`}>{current || "Not provided"}</div>
      </div>

      <label htmlFor="edit-new">
        New value {target.required && <span className="adm-req">*</span>}
      </label>
      {spec.kind === "text" && (
        <input
          id="edit-new"
          type="text"
          value={value as string}
          placeholder={spec.placeholder}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
      )}
      {spec.kind === "textarea" && (
        <textarea id="edit-new" rows={4} value={value as string} onChange={(e) => setValue(e.target.value)} autoFocus />
      )}
      {spec.kind === "select" && (
        <select id="edit-new" value={value as string} onChange={(e) => setValue(e.target.value)}>
          <option value="">{target.required ? "Select…" : "— None —"}</option>
          {options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      )}
      {spec.kind === "tags" && <TagEditor value={value as string[]} onChange={setValue} placeholder={spec.placeholder} />}
      {spec.kind === "logistics" && (
        <div className="pill-group">
          {LOGISTICS.map((o) => {
            const list = value as string[];
            const on = list.includes(o);
            return (
              <button
                key={o}
                type="button"
                className={`pill-option${on ? " active" : ""}`}
                onClick={() => setValue(on ? list.filter((x) => x !== o) : [...list, o])}
              >
                {o}
              </button>
            );
          })}
        </div>
      )}
      {spec.kind === "pricing" && (
        <div className="form-grid adm-pricing-grid">
          {PRICING_KEYS.map(([k, label]) => (
            <div key={k}>
              <label htmlFor={`price-${k}`}>{label}</label>
              <input
                id={`price-${k}`}
                type="text"
                value={(value as Record<string, string>)[k] ?? ""}
                onChange={(e) => setValue({ ...(value as object), [k]: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}
      {spec.kind === "certifications" && (
        <CertEditor value={value as Certification[]} onChange={setValue} />
      )}
      {spec.kind === "faqs" && <FaqEditor value={value as Faq[]} onChange={setValue} />}

      <label htmlFor="edit-reason" style={{ marginTop: 16 }}>
        Reason for change <span className="adm-req">*</span>
      </label>
      <textarea
        id="edit-reason"
        rows={2}
        value={reason}
        placeholder="e.g. Corrected on call with the manufacturer"
        onChange={(e) => setReason(e.target.value)}
      />
      <p className="field-hint">Saved in the change history with your name and the time.</p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn-secondary-full" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save change"}
        </button>
      </div>
    </Modal>
  );
}

function TagEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="tag-input-box">
      {value.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
            ×
          </button>
        </span>
      ))}
      <input
        id="edit-new"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

function CertEditor({ value, onChange }: { value: Certification[]; onChange: (v: Certification[]) => void }) {
  const update = (i: number, patch: Partial<Certification>) =>
    onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="adm-list-editor">
      {value.map((c, i) => (
        <div key={i} className="adm-list-editor-row">
          <input type="text" placeholder="Certification name" value={c.name} onChange={(e) => update(i, { name: e.target.value })} />
          <input type="text" placeholder="Issuing body" value={c.body} onChange={(e) => update(i, { body: e.target.value })} />
          <select value={c.status} onChange={(e) => update(i, { status: e.target.value })} aria-label="Verification status">
            <option>Pending</option>
            <option>Verified</option>
            <option>Rejected</option>
          </select>
          <button type="button" className="adm-icon-action" title="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 size={15} />
          </button>
          {c.fileName && <span className="adm-cell-sub adm-list-file">Document: {c.fileName}</span>}
        </div>
      ))}
      <button
        type="button"
        className="btn-text"
        onClick={() => onChange([...value, { name: "", body: "", fileName: "", status: "Pending" }])}
      >
        <Plus size={14} /> Add certification
      </button>
    </div>
  );
}

function FaqEditor({ value, onChange }: { value: Faq[]; onChange: (v: Faq[]) => void }) {
  const update = (i: number, patch: Partial<Faq>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="adm-list-editor">
      {value.map((f, i) => (
        <div key={i} className="adm-list-editor-faq">
          <input type="text" placeholder="Question" value={f.q} onChange={(e) => update(i, { q: e.target.value })} />
          <textarea rows={2} placeholder="Answer" value={f.a} onChange={(e) => update(i, { a: e.target.value })} />
          <button type="button" className="btn-text adm-danger-text" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn-text" onClick={() => onChange([...value, { q: "", a: "" }])}>
        <Plus size={14} /> Add FAQ
      </button>
    </div>
  );
}
