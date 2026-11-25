"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useToast } from "@/components/admin/AdminShell";
import { InvitationPanel } from "@/components/admin/InvitationPanel";
import { ErrorBox, Loading, PageHeader } from "@/components/admin/ui";
import { jsonBody, useAdminApi, useAdminHost, useResource } from "@/lib/admin/api";
import { ONBOARD_OPTIONS } from "@/lib/admin/fields";
import { ApiError } from "@/lib/api";
import { MACHINE_CATALOG } from "@/lib/visionary/storage";

/** What the team learns on the call (backend GET/PUT /admin/manufacturers/{id}/onboarding). */
export type OnboardForm = {
  id?: string;
  company: { name: string; category: string; about: string; estYear: string; employees: string;
             businessType: string; orgSize: string; capacity: string };
  location: { address: string; city: string; state: string; country: string; zip: string };
  contact: { personName: string; email: string; phone: string };
  machines: { id?: string | null; type: string; industry: string; subcategory: string; capacity: string;
              technical: string; status?: string; remove?: boolean; key?: string }[];
  recordType?: "REAL" | "DEMO";
  hasOwner?: boolean;
};

export const EMPTY_FORM: OnboardForm = {
  company: { name: "", category: "", about: "", estYear: "", employees: "", businessType: "", orgSize: "", capacity: "" },
  location: { address: "", city: "", state: "", country: "India", zip: "" },
  contact: { personName: "", email: "", phone: "" },
  machines: [],
  recordType: "REAL",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Required on this page: what the invite and Visionary matching need. */
export function formProblems(form: OnboardForm): string[] {
  const out: string[] = [];
  if (!form.company.name.trim()) out.push("Company name");
  if (!form.company.category) out.push("Category");
  if (!form.location.city.trim()) out.push("City");
  if (!form.contact.personName.trim()) out.push("Contact person");
  if (!EMAIL_RE.test(form.contact.email.trim())) out.push("Contact email");
  if (form.machines.some((m) => !m.remove && !m.type.trim() && (m.industry || m.subcategory || m.capacity)))
    out.push("Machine name");
  return out;
}

/** The body sent to the backend (row keys and statuses are page-only). */
function toBody(form: OnboardForm) {
  return {
    company: form.company,
    location: form.location,
    contact: form.contact,
    machines: form.machines
      .filter((m) => m.id || (!m.remove && m.type.trim()))
      .map((m) => ({ id: m.id ?? null, type: m.type, industry: m.industry, subcategory: m.subcategory,
                     capacity: m.capacity, technical: m.technical, remove: !!m.remove })),
    record_type: form.recordType ?? "REAL",
  };
}

let rowKey = 0;
const newMachine = () => ({ id: null, type: "", industry: "", subcategory: "", capacity: "", technical: "", key: `new-${++rowKey}` });

/**
 * One editable page for a manufacturer the team spoke to: company, location, contact person and
 * machines. Save first; then send the magic-link invite (prefilled from the contact person) and,
 * if wanted, the same message on WhatsApp. Used for new companies (/admin/manufacturers/new) and
 * existing ones, e.g. imported (/admin/manufacturers/{id}/onboard).
 */
export function OnboardManufacturer({ id }: { id?: string }) {
  const { go } = useAdminHost();
  const call = useAdminApi();
  const toast = useToast();
  const isNew = !id;
  const { data, error, loading, reload, setData } = useResource<OnboardForm>(id ? `/manufacturers/${id}/onboarding` : null);
  // What the server has (or an empty form); `edited` holds the page's unsaved changes.
  const base = useMemo<OnboardForm>(
    () => (data ? { ...data, machines: data.machines.map((m) => ({ ...m, key: m.id ?? `m-${++rowKey}` })) } : EMPTY_FORM),
    [data],
  );
  const [edited, setEdited] = useState<OnboardForm | null>(null);
  const form = edited ?? base;
  const setForm = (change: (f: OnboardForm) => OnboardForm) => setEdited((prev) => change(prev ?? base));
  const saved = JSON.stringify(toBody(base));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);

  const dirty = JSON.stringify(toBody(form)) !== saved;
  const problems = formProblems(form);

  if (!isNew && !data) return loading ? <Loading /> : <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;

  const set = <S extends "company" | "location" | "contact">(section: S, key: keyof OnboardForm[S]) =>
    (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [section]: { ...f[section], [key]: e.target.value } }));
  const setMachine = (key: string, field: string, value: string | boolean) =>
    setForm((f) => ({ ...f, machines: f.machines.map((m) => ((m.key ?? m.id) === key ? { ...m, [field]: value } : m)) }));

  async function save() {
    if (busy) return;
    if (problems.length) {
      setShowProblems(true);
      setErr(`Please fill in: ${problems.join(", ")}.`);
      return;
    }
    setBusy(true);
    setErr("");
    setExistingId(null);
    try {
      if (isNew) {
        const created = await call<OnboardForm>("/manufacturers/onboarding", jsonBody("POST", toBody(form)));
        toast("Manufacturer saved. You can now send the invite.");
        go(`/admin/manufacturers/${created.id}/onboard`, { replace: true });
        return;
      }
      const next = await call<OnboardForm>(`/manufacturers/${id}/onboarding`, { method: "PUT", body: JSON.stringify(toBody(form)) });
      setData(next);
      setEdited(null);
      toast("Details saved");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
      if (e instanceof ApiError && typeof e.data?.existingId === "string") setExistingId(e.data.existingId);
    } finally {
      setBusy(false);
    }
  }

  const missing = (label: string) => showProblems && problems.includes(label);
  const machines = form.machines.filter((m) => !m.remove);

  return (
    <>
      <PageHeader
        onBack={() => go(isNew ? "/admin/manufacturers" : `/admin/manufacturers/${id}`)}
        title={isNew ? "Add manufacturer" : form.company.name || "Manufacturer details"}
        subtitle="Enter what you learned on the call, save, then send the invite."
        actions={
          <button type="button" className="btn-primary adm-btn-md" disabled={busy || (!isNew && !dirty)} onClick={() => void save()}>
            {busy ? "Saving…" : isNew ? "Save manufacturer" : dirty ? "Save changes" : "Saved"}
          </button>
        }
      />

      {err ? <p className="field-error" role="alert">{err}</p> : null}
      {existingId ? (
        <button type="button" className="btn-text" onClick={() => go(`/admin/manufacturers/${existingId}/onboard`)}>
          Open the existing company
        </button>
      ) : null}

      <section className="card adm-section">
        <div className="adm-section-head"><h3>Company</h3></div>
        <div className="adm-add-company-grid">
          <div>
            <label htmlFor="ob-name">Company name <span className="adm-req">*</span></label>
            <input id="ob-name" value={form.company.name} onChange={set("company", "name")} aria-invalid={missing("Company name")} />
          </div>
          <div>
            <label htmlFor="ob-category">Category <span className="adm-req">*</span></label>
            <select id="ob-category" value={form.company.category} onChange={set("company", "category")} aria-invalid={missing("Category")}>
              <option value="">Select</option>
              {ONBOARD_OPTIONS.companyTypes.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="adm-span-2">
            <label htmlFor="ob-about">About the company</label>
            <textarea id="ob-about" rows={3} value={form.company.about} onChange={set("company", "about")} />
          </div>
          <div>
            <label htmlFor="ob-capacity">Production capacity</label>
            <input id="ob-capacity" value={form.company.capacity} onChange={set("company", "capacity")} placeholder="e.g. 20,000 pieces/month" />
          </div>
          <div>
            <label htmlFor="ob-est">Year established</label>
            <input id="ob-est" value={form.company.estYear} onChange={set("company", "estYear")} placeholder="e.g. 2008" />
          </div>
          <div>
            <label htmlFor="ob-employees">Number of employees</label>
            <input id="ob-employees" value={form.company.employees} onChange={set("company", "employees")} />
          </div>
          <div>
            <label htmlFor="ob-btype">Business type</label>
            <select id="ob-btype" value={form.company.businessType} onChange={set("company", "businessType")}>
              <option value="">Select</option>
              {ONBOARD_OPTIONS.businessTypes.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ob-size">Organization size</label>
            <select id="ob-size" value={form.company.orgSize} onChange={set("company", "orgSize")}>
              <option value="">Select</option>
              {ONBOARD_OPTIONS.orgSizes.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          {isNew ? (
            <div>
              <label htmlFor="ob-record">Record type</label>
              <select id="ob-record" value={form.recordType} onChange={(e) => setForm((f) => ({ ...f, recordType: e.target.value as "REAL" | "DEMO" }))}>
                <option value="REAL">Real company</option>
                <option value="DEMO">Demo (sample data)</option>
              </select>
            </div>
          ) : null}
        </div>
      </section>

      <section className="card adm-section">
        <div className="adm-section-head"><h3>Location</h3></div>
        <div className="adm-add-company-grid">
          <div className="adm-span-2">
            <label htmlFor="ob-address">Factory address</label>
            <input id="ob-address" value={form.location.address} onChange={set("location", "address")} />
          </div>
          <div>
            <label htmlFor="ob-city">City <span className="adm-req">*</span></label>
            <input id="ob-city" value={form.location.city} onChange={set("location", "city")} aria-invalid={missing("City")} />
          </div>
          <div>
            <label htmlFor="ob-state">State</label>
            <input id="ob-state" value={form.location.state} onChange={set("location", "state")} />
          </div>
          <div>
            <label htmlFor="ob-country">Country</label>
            <select id="ob-country" value={form.location.country} onChange={set("location", "country")}>
              {ONBOARD_OPTIONS.countries.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ob-zip">PIN code</label>
            <input id="ob-zip" value={form.location.zip} onChange={set("location", "zip")} />
          </div>
        </div>
      </section>

      <section className="card adm-section">
        <div className="adm-section-head"><h3>Contact person</h3></div>
        <p className="field-hint">The person you spoke to. The invite goes to this email (their login) and WhatsApp number.</p>
        <div className="adm-add-company-grid">
          <div>
            <label htmlFor="ob-person">Name <span className="adm-req">*</span></label>
            <input id="ob-person" value={form.contact.personName} onChange={set("contact", "personName")} aria-invalid={missing("Contact person")} />
          </div>
          <div>
            <label htmlFor="ob-email">Email <span className="adm-req">*</span></label>
            <input id="ob-email" type="email" value={form.contact.email} onChange={set("contact", "email")} aria-invalid={missing("Contact email")} />
          </div>
          <div>
            <label htmlFor="ob-phone">Phone (WhatsApp)</label>
            <input id="ob-phone" value={form.contact.phone} onChange={set("contact", "phone")} placeholder="+91 98765 43210" />
          </div>
        </div>
      </section>

      <section className="card adm-section">
        <div className="adm-section-head">
          <h3>Machines ({machines.length})</h3>
          <button type="button" className="btn-secondary-full adm-btn-sm"
            onClick={() => setForm((f) => ({ ...f, machines: [...f.machines, newMachine()] }))}>
            <Plus size={14} /> Add machine
          </button>
        </div>
        <p className="field-hint">Use the names from the Visionary machine list (e.g. Sheet Metal Bending) so Visionaries can find them.</p>
        <datalist id="ob-machine-names">
          {MACHINE_CATALOG.map((m) => <option key={m} value={m} />)}
        </datalist>
        {machines.length === 0 ? <p className="adm-muted">No machines yet.</p> : null}
        <div className="adm-stack">
          {machines.map((m, i) => {
            const key = (m.key ?? m.id)!;
            return (
              <div key={key} className="adm-add-company-grid" style={{ borderTop: i ? "1px solid var(--line, #e2e8f0)" : undefined, paddingTop: i ? 12 : 0 }}>
                <div>
                  <label htmlFor={`ob-m-type-${key}`}>Machine name</label>
                  <input id={`ob-m-type-${key}`} list="ob-machine-names" value={m.type} onChange={(e) => setMachine(key, "type", e.target.value)} />
                </div>
                <div>
                  <label htmlFor={`ob-m-ind-${key}`}>Industry</label>
                  <select id={`ob-m-ind-${key}`} value={m.industry} onChange={(e) => setMachine(key, "industry", e.target.value)}>
                    <option value="">Select</option>
                    {ONBOARD_OPTIONS.machineIndustries.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`ob-m-sub-${key}`}>Products / subcategory</label>
                  <input id={`ob-m-sub-${key}`} value={m.subcategory} onChange={(e) => setMachine(key, "subcategory", e.target.value)} />
                </div>
                <div>
                  <label htmlFor={`ob-m-cap-${key}`}>Capacity</label>
                  <input id={`ob-m-cap-${key}`} value={m.capacity} onChange={(e) => setMachine(key, "capacity", e.target.value)} placeholder="e.g. 1,500 pieces/day" />
                </div>
                <div className="adm-span-2">
                  <button type="button" className="btn-text" onClick={() =>
                    m.id ? setMachine(key, "remove", true)
                         : setForm((f) => ({ ...f, machines: f.machines.filter((x) => (x.key ?? x.id) !== key) }))}>
                    <Trash2 size={14} /> Remove {m.type || "this machine"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {!isNew && id ? (
        <InvitationPanel
          orgId={id}
          hasOwner={!!form.hasOwner}
          onChanged={reload}
          inviteDefaults={{ name: form.contact.personName, email: form.contact.email, phone: form.contact.phone }}
          blockedReason={dirty ? "Save your changes before sending the invite." : null}
        />
      ) : (
        <p className="field-hint">Save the manufacturer first; then you can send the invite from this page.</p>
      )}
    </>
  );
}
