"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  /** Page-only: Industry sector / Production typed here, applied to every machine on save. */
  sector?: string;
  products?: string;
};

export const EMPTY_FORM: OnboardForm = {
  company: { name: "", category: "", about: "", estYear: "", employees: "", businessType: "", orgSize: "", capacity: "" },
  location: { address: "", city: "", state: "", country: "India", zip: "" },
  contact: { personName: "", email: "", phone: "" },
  machines: [],
  recordType: "REAL",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Required on this page (meeting 27 Nov): only what the call starts with, the company name and
 * how to reach the person. Everything else is optional; the manufacturer completes it after
 * signing in.
 */
export function formProblems(form: OnboardForm): string[] {
  const out: string[] = [];
  if (!form.company.name.trim()) out.push("Company name");
  if (!form.contact.personName.trim()) out.push("Contact person");
  const email = form.contact.email.trim();
  if (!email && !form.contact.phone.trim()) out.push("Email or WhatsApp number");
  if (email && !EMAIL_RE.test(email)) out.push("A valid email");
  return out;
}

/** The body sent to the backend (row keys and statuses are page-only). Industry sector and
 * products typed on the page apply to every machine of the company. */
function toBody(form: OnboardForm) {
  return {
    company: form.company,
    location: form.location,
    contact: form.contact,
    machines: form.machines
      .filter((m) => m.id || (!m.remove && m.type.trim()))
      .map((m) => ({ id: m.id ?? null, type: m.type,
                     industry: form.sector ?? m.industry, subcategory: form.products ?? m.subcategory,
                     capacity: m.capacity, technical: m.technical, remove: !!m.remove })),
    record_type: form.recordType ?? "REAL",
  };
}

let rowKey = 0;
const newMachine = (type: string) =>
  ({ id: null, type, industry: "", subcategory: "", capacity: "", technical: "", key: `new-${++rowKey}` });

/**
 * One editable page for a manufacturer the team spoke to. Meeting 27 Nov 2026:
 * - the call starts with the company name (outlined) and the contact details; the rest is optional;
 * - machines: one field for several machine names (pick from the list or type a new one), one
 *   Industry sector and a Production / products box; each name becomes its own machine record;
 * - Save is at the bottom; right after saving, Send by Email / Send by WhatsApp are shown here.
 * Used for new companies (/admin/manufacturers/new) and existing ones (/admin/manufacturers/{id}/onboard).
 */
export function OnboardManufacturer({ id }: { id?: string }) {
  const { go, search } = useAdminHost();
  const call = useAdminApi();
  const toast = useToast();
  // A new company keeps working here after it is saved, also if the address bar does not reload the page.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const orgId = id ?? createdId ?? undefined;
  const isNew = !orgId;
  const { data, error, loading, reload, setData } = useResource<OnboardForm>(orgId ? `/manufacturers/${orgId}/onboarding` : null);
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
  const [moreOpen, setMoreOpen] = useState(false);
  const inviteRef = useRef<HTMLDivElement | null>(null);
  const justSaved = search.get("invite") === "1" || !!createdId;

  // Right after a new manufacturer is saved: bring the invite options into view.
  useEffect(() => {
    if (justSaved && data && inviteRef.current) inviteRef.current.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [justSaved, data]);

  const dirty = JSON.stringify(toBody(form)) !== saved;
  const problems = formProblems(form);

  if (!isNew && !data) return loading ? <Loading /> : <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;

  const set = <S extends "company" | "location" | "contact">(section: S, key: keyof OnboardForm[S]) =>
    (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [section]: { ...f[section], [key]: e.target.value } }));

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
        setEdited(null);
        setCreatedId(created.id ?? null);
        setData(created);
        toast("Manufacturer saved. Now send the link by email or WhatsApp.");
        go(`/admin/manufacturers/${created.id}/onboard?invite=1`, { replace: true });
        return;
      }
      const next = await call<OnboardForm>(`/manufacturers/${orgId}/onboarding`, { method: "PUT", body: JSON.stringify(toBody(form)) });
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
  const sector = form.sector ?? machines.find((m) => m.industry)?.industry ?? "";
  const products = form.products ?? machines.find((m) => m.subcategory)?.subcategory ?? "";

  function addMachines(names: string[]) {
    setForm((f) => {
      const have = new Set(f.machines.filter((m) => !m.remove).map((m) => m.type.trim().toLowerCase()));
      const add = names.map((n) => n.trim()).filter((n) => n && !have.has(n.toLowerCase()) && (have.add(n.toLowerCase()), true));
      return add.length ? { ...f, machines: [...f.machines, ...add.map(newMachine)] } : f;
    });
  }
  function removeMachine(key: string) {
    setForm((f) => ({
      ...f,
      machines: f.machines.flatMap((m) =>
        (m.key ?? m.id) !== key ? [m] : m.id ? [{ ...m, remove: true }] : []),
    }));
  }

  return (
    <>
      <PageHeader
        onBack={() => go(isNew ? "/admin/manufacturers" : `/admin/manufacturers/${orgId}`)}
        title={isNew ? "Add manufacturer" : form.company.name || "Manufacturer details"}
        subtitle="Start with the company name and contact details. Everything else is optional; the manufacturer can add it after signing in."
      />

      <section className="card adm-section">
        <div className="adm-section-head"><h3>Company and contact</h3></div>
        <div className="adm-add-company-grid">
          <div className="adm-span-2">
            <label htmlFor="ob-name">Company name <span className="adm-req">*</span></label>
            <input id="ob-name" className="adm-key-field" value={form.company.name} onChange={set("company", "name")}
              aria-invalid={missing("Company name")} placeholder="Type the company name" autoFocus={isNew} />
          </div>
          <div>
            <label htmlFor="ob-person">Contact person <span className="adm-req">*</span></label>
            <input id="ob-person" value={form.contact.personName} onChange={set("contact", "personName")} aria-invalid={missing("Contact person")} />
          </div>
          <div>
            <label htmlFor="ob-phone">WhatsApp number</label>
            <input id="ob-phone" value={form.contact.phone} onChange={set("contact", "phone")} placeholder="+91 98765 43210"
              aria-invalid={missing("Email or WhatsApp number")} />
          </div>
          <div>
            <label htmlFor="ob-email">Email</label>
            <input id="ob-email" type="email" value={form.contact.email} onChange={set("contact", "email")}
              aria-invalid={missing("Email or WhatsApp number") || missing("A valid email")} />
          </div>
        </div>
        <p className="field-hint">An email or a WhatsApp number is needed to send them the link.</p>
      </section>

      <section className="card adm-section">
        <div className="adm-section-head"><h3>Machines ({machines.length})</h3></div>
        <p className="field-hint">
          Pick the machine names from the list or type a missing one and press Enter. Each name is saved as its own machine;
          the manufacturer adds the full details after signing in.
        </p>
        <MachineNames
          names={machines.map((m) => ({ key: (m.key ?? m.id)!, name: m.type }))}
          onAdd={addMachines}
          onRemove={removeMachine}
        />
        <div className="adm-add-company-grid" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="ob-sector">Industry sector</label>
            <select id="ob-sector" value={sector} onChange={(e) => setForm((f) => ({ ...f, sector: e.target.value }))}>
              <option value="">Select</option>
              {Array.from(new Set([...ONBOARD_OPTIONS.machineIndustries, ...(sector ? [sector] : [])])).map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ob-products">Production / products</label>
            <input id="ob-products" value={products} onChange={(e) => setForm((f) => ({ ...f, products: e.target.value }))}
              placeholder="What they make, e.g. shoe laces" />
          </div>
        </div>
      </section>

      <section className="card adm-section">
        <button type="button" className="adm-section-head adm-collapse-head" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
          <h3>More company details (optional)</h3>
          <span className="btn-text">{moreOpen ? "Hide" : "Show"}</span>
        </button>
        {moreOpen ? (
          <div className="adm-add-company-grid">
            <div>
              <label htmlFor="ob-category">Category</label>
              <select id="ob-category" value={form.company.category} onChange={set("company", "category")}>
                <option value="">Select</option>
                {ONBOARD_OPTIONS.companyTypes.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ob-city">City</label>
              <input id="ob-city" value={form.location.city} onChange={set("location", "city")} />
            </div>
            <div className="adm-span-2">
              <label htmlFor="ob-about">About the company</label>
              <textarea id="ob-about" rows={3} value={form.company.about} onChange={set("company", "about")} />
            </div>
            <div className="adm-span-2">
              <label htmlFor="ob-address">Factory address</label>
              <input id="ob-address" value={form.location.address} onChange={set("location", "address")} />
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
        ) : null}
      </section>

      {err ? <p className="field-error" role="alert">{err}</p> : null}
      {existingId ? (
        <button type="button" className="btn-text" onClick={() => go(`/admin/manufacturers/${existingId}/onboard`)}>
          Open the existing company
        </button>
      ) : null}
      <div className="adm-form-footer">
        <button type="button" className="btn-primary adm-btn-md" disabled={busy || (!isNew && !dirty)} onClick={() => void save()}>
          {busy ? "Saving…" : isNew ? "Save manufacturer" : dirty ? "Save changes" : "Saved"}
        </button>
      </div>

      <div ref={inviteRef}>
        {!isNew && orgId ? (
          <InvitationPanel
            orgId={orgId}
            hasOwner={!!form.hasOwner}
            onChanged={reload}
            inviteDefaults={{ name: form.contact.personName, email: form.contact.email, phone: form.contact.phone }}
            blockedReason={dirty ? "Save your changes before sending the link." : null}
          />
        ) : (
          <p className="field-hint">After you save, Send by Email and Send by WhatsApp appear here.</p>
        )}
      </div>
    </>
  );
}

/**
 * Several machine names in one field: chips for what is chosen, a box to type in with
 * suggestions from the Visionary machine list. Enter (or a comma) adds what is typed, also a
 * name that is not in the list; Backspace on an empty box removes the last one.
 */
function MachineNames({ names, onAdd, onRemove }: {
  names: { key: string; name: string }[];
  onAdd: (names: string[]) => void;
  onRemove: (key: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const chosen = new Set(names.map((n) => n.name.toLowerCase()));
  const q = draft.trim().toLowerCase();
  const suggestions = q
    ? MACHINE_CATALOG.filter((m) => m.toLowerCase().includes(q) && !chosen.has(m.toLowerCase())).slice(0, 8)
    : [];
  const add = (value: string) => {
    const parts = value.split(",").map((v) => v.trim()).filter(Boolean);
    if (parts.length) onAdd(parts);
    setDraft("");
  };
  return (
    <div>
      <label htmlFor="ob-machines">Machine names</label>
      <div className="tag-input-box adm-machine-names">
        {names.map((n) => (
          <span key={n.key} className="tag-chip">
            {n.name}
            <button type="button" aria-label={`Remove ${n.name}`} onClick={() => onRemove(n.key)}>×</button>
          </span>
        ))}
        <input
          id="ob-machines"
          value={draft}
          placeholder={names.length ? "Add another machine…" : "e.g. CNC Machining, Lace braiding"}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(",")) add(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && names.length) {
              onRemove(names[names.length - 1].key);
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
        />
      </div>
      {suggestions.length ? (
        <div className="adm-suggest" role="listbox" aria-label="Machine names from the list">
          {suggestions.map((m) => (
            <button key={m} type="button" role="option" aria-selected={false}
              onMouseDown={(e) => e.preventDefault()} onClick={() => add(m)}>
              {m}
            </button>
          ))}
          {!suggestions.some((m) => m.toLowerCase() === q) ? (
            <button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => add(draft)}>
              Add &quot;{draft.trim()}&quot;
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
