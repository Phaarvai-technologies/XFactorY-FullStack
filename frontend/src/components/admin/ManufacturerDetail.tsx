"use client";

import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Circle,
  FileText,
  ImageIcon,
  Pencil,
  UserRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAdminMe, useToast } from "@/components/admin/AdminShell";
import { EditFieldModal, type EditTarget } from "@/components/admin/EditFieldModal";
import {
  AccountBadge,
  Completeness,
  EntryBadge,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  RecordBadge,
  ReviewBadge,
} from "@/components/admin/ui";
import { jsonBody, useAdminApi, useAdminHost, useResource } from "@/lib/admin/api";
import { displayValue } from "@/lib/admin/fields";
import {
  ENTRY_LABELS,
  ENTRY_ORDER,
  RECORD_LABELS,
  RECORD_ORDER,
  REVIEW_LABELS,
  REVIEW_ORDER,
  fmtAgo,
  fmtDate,
  fmtDateTime,
} from "@/lib/admin/format";
import type {
  EntrySource,
  Machine,
  ManufacturerDetail as Detail,
  Note,
  RecordType,
  ReviewStatus,
} from "@/lib/admin/types";

const TABS = [
  { key: "company", label: "Company & Contacts" },
  { key: "capabilities", label: "Capabilities & Responses" },
  { key: "documents", label: "Documents & Images" },
  { key: "onboarding", label: "Onboarding & Review" },
  { key: "history", label: "History" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// Which UI fields satisfy which of the 14 required items (for "missing" markers).
const REQUIRED_BY_FIELD: Record<string, string> = {
  firstName: "r_first_name",
  lastName: "r_last_name",
  dob: "r_dob",
  "contact.email": "r_contact",
  "contact.phone": "r_contact",
  "company.name": "r_company_name",
  "account.companyType": "r_industry",
  "account.country": "r_account_country",
  "company.about": "r_about",
  "location.address": "r_address",
  "location.city": "r_city",
  "location.country": "r_location_country",
  certifications: "r_certification",
  infra: "r_infrastructure",
  faqs: "r_faq",
};

type Ctx = {
  d: Detail;
  missing: Set<string>;
  edit: (field: string, label: string, value: unknown) => void;
};

function isEmpty(v: unknown) {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/** One response: label, value, missing marker, edit button. */
function Resp({
  ctx,
  field,
  label,
  value,
  requiredKey,
  readOnly,
  multiline,
}: {
  ctx: Ctx;
  field?: string;
  label: string;
  value: unknown;
  requiredKey?: string;
  readOnly?: string;
  multiline?: boolean;
}) {
  const reqKey = requiredKey ?? (field ? REQUIRED_BY_FIELD[field] : undefined);
  const missing = !!reqKey && ctx.missing.has(reqKey) && isEmpty(value);
  const text = displayValue(value);
  return (
    <div className={`detail-item adm-resp${missing ? " adm-missing" : ""}`}>
      <div className="adm-resp-head">
        <p className="detail-label">
          {label}
          {reqKey && <span className="adm-req"> *</span>}
        </p>
        {field && !readOnly && (
          <button type="button" className="adm-edit-btn" onClick={() => ctx.edit(field, label, value)} aria-label={`Edit ${label}`}>
            <Pencil size={13} /> Edit
          </button>
        )}
      </div>
      <div className={`detail-value${multiline ? " adm-pre" : ""}`}>
        {text ? text : <span className={missing ? "adm-missing-text" : "adm-muted"}>{missing ? "Missing — required" : "Not provided"}</span>}
      </div>
      {readOnly && <p className="adm-cell-sub">{readOnly}</p>}
    </div>
  );
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="card adm-section">
      <div className="adm-section-head">
        <h3>{title}</h3>
        {note}
      </div>
      {children}
    </section>
  );
}

function SectionState({ done }: { done: boolean }) {
  return done ? (
    <span className="badge badge-verified">Complete</span>
  ) : (
    <span className="badge badge-pending">Incomplete</span>
  );
}

export function ManufacturerDetail({ id }: { id: string }) {
  const { go, search } = useAdminHost();
  const call = useAdminApi();
  const toast = useToast();
  const { data: d, error, loading, reload, setData } = useResource<Detail>(`/manufacturers/${id}`);
  const tab = (TABS.find((t) => t.key === search.get("tab"))?.key ?? "company") as TabKey;
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  if (!d) return loading ? <Loading /> : <ErrorBox message={error?.message ?? "Could not load"} onRetry={reload} />;

  const m = d.manufacturer;
  const missing = new Set(d.requiredFields.filter((f) => !f.done).map((f) => f.key));
  const required = new Set(d.editable.required);
  const ctx: Ctx = {
    d,
    missing,
    edit: (field, label, value) => setEditing({ field, label, value, required: required.has(field) }),
  };
  const setTab = (key: TabKey) => go(`/admin/manufacturers/${id}?tab=${key}`, { replace: true });

  return (
    <>
      <PageHeader
        onBack={() => go("/admin/manufacturers")}
        title={m.companyName || "Unnamed company"}
        subtitle={
          <>
            Registered {fmtDate(m.registeredAt)} · Last updated {fmtAgo(m.lastUpdated)}
            {m.assignedAdminName ? ` · Assigned to ${m.assignedAdminName}` : " · Unassigned"}
          </>
        }
        actions={
          <button type="button" className="btn-ghost" onClick={() => setArchiveOpen(true)}>
            {m.isArchived ? (
              <>
                <ArchiveRestore size={15} /> Restore
              </>
            ) : (
              <>
                <Archive size={15} /> Archive
              </>
            )}
          </button>
        }
      />

      <div className="card adm-summary">
        <div className="adm-summary-badges">
          <ReviewBadge status={m.reviewStatus} />
          <RecordBadge type={m.recordType} />
          <EntryBadge source={m.entrySource} />
          {m.isArchived && <span className="badge badge-neutral">Archived {fmtDate(m.archivedAt)}</span>}
        </div>
        <div className="adm-summary-grid">
          <div>
            <span>Completeness</span>
            <Completeness value={m.completeness} done={m.requiredDone} total={m.requiredTotal} />
            <small>
              {m.requiredDone} of {m.requiredTotal} required fields
            </small>
          </div>
          <div>
            <span>Contact</span>
            <b>{m.contactName || "—"}</b>
            <small>{m.contactEmail || m.contactPhone || "No contact details"}</small>
          </div>
          <div>
            <span>Location</span>
            <b>{m.location || "—"}</b>
            <small>{m.industry || "Industry not set"}</small>
          </div>
          <div>
            <span>Major process</span>
            <b>{m.majorProcess || "No listings yet"}</b>
            <small>
              {m.listingCount} listing{m.listingCount === 1 ? "" : "s"}
            </small>
          </div>
        </div>
      </div>

      {m.missingFields.length > 0 && (
        <div className="adm-missing-banner" role="note">
          <AlertTriangle size={18} />
          <div>
            <b>
              {m.missingFields.length} required field{m.missingFields.length === 1 ? "" : "s"} missing
            </b>
            <span>{m.missingFields.join(" · ")}</span>
          </div>
        </div>
      )}

      <div className="adm-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`adm-tab${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === "history" && d.history.length > 0 && <span className="adm-tab-count">{d.history.length}</span>}
          </button>
        ))}
      </div>

      {tab === "company" && <CompanyTab ctx={ctx} />}
      {tab === "capabilities" && <CapabilitiesTab ctx={ctx} />}
      {tab === "documents" && <DocumentsTab d={d} />}
      {tab === "onboarding" && <OnboardingTab d={d} onChange={setData} />}
      {tab === "history" && <HistoryTab d={d} />}

      {editing && (
        <EditFieldModal
          orgId={id}
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={(detail) => {
            setData(detail);
            setEditing(null);
            toast(`${editing.label} updated — recorded in History`);
          }}
        />
      )}

      {archiveOpen && (
        <ArchiveModal
          archived={m.isArchived}
          onClose={() => setArchiveOpen(false)}
          onConfirm={async (reason) => {
            const next = await call<Detail>(
              `/manufacturers/${id}/${m.isArchived ? "restore" : "archive"}`,
              jsonBody("POST", { reason: reason || null }),
            );
            setData(next);
            setArchiveOpen(false);
            toast(m.isArchived ? "Manufacturer restored" : "Manufacturer archived");
          }}
        />
      )}
    </>
  );
}

function ArchiveModal({
  archived,
  onClose,
  onConfirm,
}: {
  archived: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={archived ? "Restore manufacturer" : "Archive manufacturer"} onClose={onClose}>
      <p className="adm-modal-text">
        {archived
          ? "The record will appear in lists and analytics again."
          : "The record will be hidden from lists and analytics. Nothing is deleted and you can restore it at any time."}
      </p>
      <label htmlFor="arch-reason">
        Reason <span className="optional">(optional)</span>
      </label>
      <textarea id="arch-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p className="field-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn-secondary-full" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(reason);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not update");
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : archived ? "Restore" : "Archive"}
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- tab 1 */
function CompanyTab({ ctx }: { ctx: Ctx }) {
  const { d } = ctx;
  const { go } = useAdminHost();
  const a = d.profile.state.account;
  const c = d.profile.profileData.company;
  const l = d.profile.profileData.location;
  const done = (s: string) => d.manufacturer.sections.find((x) => x.name === s)?.complete ?? false;
  return (
    <div className="adm-tab-body">
      <Section title="Personal info" note={<SectionState done={done("Personal info")} />}>
        <div className="details-grid">
          <Resp ctx={ctx} label="First name" value={a.firstName} requiredKey="r_first_name" readOnly="Comes from the user's sign-up." />
          <Resp ctx={ctx} label="Last name" value={a.lastName} requiredKey="r_last_name" readOnly="Comes from the user's sign-up." />
          <Resp ctx={ctx} label="Date of birth" value={a.dob ? fmtDate(a.dob) : ""} requiredKey="r_dob" readOnly="Entered by the user." />
          <Resp ctx={ctx} field="contact.email" label="Contact email" value={d.contacts.email} />
          <Resp ctx={ctx} field="contact.phone" label="Contact phone" value={d.contacts.phone} />
        </div>
      </Section>

      <Section title="Company info" note={<SectionState done={done("Company info")} />}>
        <div className="details-grid">
          <Resp ctx={ctx} field="company.name" label="Company name" value={c.name} />
          <Resp ctx={ctx} field="account.companyType" label="Company category" value={a.companyType} />
          <Resp ctx={ctx} field="account.country" label="Country" value={a.country} />
          <Resp ctx={ctx} field="account.capacity" label="Production capacity" value={a.capacity} />
        </div>
      </Section>

      <Section title="Company details" note={<SectionState done={done("Company details")} />}>
        <div className="details-grid">
          <Resp ctx={ctx} field="company.about" label="About the company" value={c.about} multiline />
          <Resp ctx={ctx} field="company.vision" label="Vision & mission" value={c.vision} multiline />
          <Resp ctx={ctx} field="company.estYear" label="Year established" value={c.estYear} />
          <Resp ctx={ctx} field="company.employees" label="Number of employees" value={c.employees} />
          <Resp ctx={ctx} field="company.businessType" label="Business type" value={c.businessType} />
          <Resp ctx={ctx} field="company.orgSize" label="Organization size" value={c.orgSize} />
        </div>
      </Section>

      <Section title="Location" note={<SectionState done={done("Location")} />}>
        <div className="details-grid">
          <Resp ctx={ctx} field="location.address" label="Facility address" value={l.address} multiline />
          <Resp ctx={ctx} field="location.city" label="City" value={l.city} />
          <Resp ctx={ctx} field="location.state" label="State / province" value={l.state} />
          <Resp ctx={ctx} field="location.country" label="Facility country" value={l.country} />
          <Resp ctx={ctx} field="location.zip" label="ZIP / postal code" value={l.zip} />
          <Resp ctx={ctx} field="location.sez" label="SEZ status" value={l.sez} />
          <Resp ctx={ctx} field="location.serviceableAreas" label="Serviceable areas" value={l.serviceableAreas} />
        </div>
      </Section>

      <Section title="Linked users">
        {d.linkedUsers.length === 0 ? (
          <p className="adm-muted">No user is linked to this manufacturer.</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table adm-table-compact">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Relationship</th>
                  <th>Account</th>
                  <th>Last activity</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {d.linkedUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="adm-cell-main">{[u.first_name, u.last_name].filter(Boolean).join(" ") || "—"}</div>
                      <div className="adm-cell-sub">{u.email}</div>
                    </td>
                    <td className="adm-capitalize">{u.membership_role}</td>
                    <td>
                      <AccountBadge status={u.status} />
                    </td>
                    <td>{fmtAgo(u.last_seen_at)}</td>
                    <td>
                      <button type="button" className="btn-text" onClick={() => go(`/admin/users/${u.id}`)}>
                        <UserRound size={14} /> Open user
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------- tab 2 */
function CapabilitiesTab({ ctx }: { ctx: Ctx }) {
  const { d } = ctx;
  const p = d.profile.profileData;
  const infra = p.infra;
  const done = (s: string) => d.manufacturer.sections.find((x) => x.name === s)?.complete ?? false;
  const machines: (Machine & { draft?: boolean })[] = [...d.profile.state.machinery];
  if (d.profile.machineryDraft) {
    machines.push({ ...(d.profile.machineryDraft.data as Omit<Machine, "id" | "status">), id: d.profile.machineryDraft.id, status: "Draft", draft: true });
  }
  const infraMissing = ctx.missing.has("r_infrastructure");
  return (
    <div className="adm-tab-body">
      <Section title="Infrastructure" note={<SectionState done={done("Infrastructure")} />}>
        {infraMissing && <p className="adm-missing-text adm-section-hint">Required: at least one infrastructure answer.</p>}
        <div className="details-grid">
          {(
            [
              ["electricity", "Electricity"],
              ["water", "Water"],
              ["storage", "Storage"],
              ["packaging", "Packaging"],
              ["waste", "Waste disposal"],
              ["qa", "Quality assurance"],
            ] as const
          ).map(([k, label]) => (
            <Resp key={k} ctx={ctx} field={`infra.${k}`} label={label} value={infra[k]} multiline />
          ))}
        </div>
      </Section>

      <Section
        title="Certifications"
        note={
          <div className="adm-section-actions">
            <SectionState done={done("Certifications")} />
            <button type="button" className="adm-edit-btn" onClick={() => ctx.edit("certifications", "Certifications", p.certifications)}>
              <Pencil size={13} /> Edit
            </button>
          </div>
        }
      >
        {p.certifications.length === 0 ? (
          <p className="adm-missing-text">Missing — at least one certification is required.</p>
        ) : (
          <div className="adm-stack">
            {p.certifications.map((c, i) => (
              <div key={i} className="cert-item">
                <div className="cert-item-main">
                  <b>{c.name}</b>
                  <span>
                    {c.body || "Issuing body not given"}
                    {c.fileName ? ` · ${c.fileName}` : ""}
                  </span>
                </div>
                <span className={`badge ${c.status === "Verified" ? "badge-verified" : c.status === "Rejected" ? "badge-rejected" : "badge-pending"}`}>
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="FAQ"
        note={
          <div className="adm-section-actions">
            <SectionState done={done("FAQ")} />
            <button type="button" className="adm-edit-btn" onClick={() => ctx.edit("faqs", "FAQs", p.faqs)}>
              <Pencil size={13} /> Edit
            </button>
          </div>
        }
      >
        {p.faqs.length === 0 ? (
          <p className="adm-missing-text">Missing — at least one FAQ answer is required.</p>
        ) : (
          <div className="adm-stack">
            {p.faqs.map((f, i) => (
              <div key={i} className="faq-item">
                <div className="faq-item-main">
                  <b>{f.q}</b>
                  <p>{f.a}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={`Machinery & capacity listings (${machines.length})`}>
        {machines.length === 0 ? (
          <p className="adm-muted">No machinery listings yet.</p>
        ) : (
          <div className="adm-stack">
            {machines.map((mc) => (
              <MachineCard key={mc.id} ctx={ctx} m={mc} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function MachineCard({ ctx, m }: { ctx: Ctx; m: Machine & { draft?: boolean } }) {
  const [open, setOpen] = useState(false);
  const f = (key: string) => `machinery.${m.id}.${key}`;
  return (
    <div className="adm-machine">
      <button type="button" className="adm-machine-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div>
          <b>{m.type || "Untitled listing"}</b>
          <span>
            {[m.industry, m.subcategory, m.capacity].filter(Boolean).join(" · ") || "No details yet"}
          </span>
        </div>
        <div className="adm-machine-side">
          <span className={`badge ${m.status === "Published" ? "badge-verified" : m.draft ? "badge-pending" : "badge-neutral"}`}>
            {m.draft ? "Unfinished draft" : m.status}
          </span>
          <span className="btn-text">{open ? "Hide" : "Show responses"}</span>
        </div>
      </button>
      {open && (
        <div className="details-grid adm-machine-body">
          <Resp ctx={ctx} field={f("industry")} label="Industry" value={m.industry} />
          <Resp ctx={ctx} field={f("subcategory")} label="Subcategory" value={m.subcategory} />
          <Resp ctx={ctx} field={f("type")} label="Machinery type" value={m.type} />
          <Resp ctx={ctx} field={f("capacity")} label="Capacity" value={m.capacity} />
          <Resp ctx={ctx} field={f("age")} label="Age" value={m.age} />
          <Resp ctx={ctx} field={f("condition")} label="Condition" value={m.condition} />
          <Resp ctx={ctx} field={f("technical")} label="Technical details" value={m.technical} multiline />
          <Resp ctx={ctx} field={f("rawMatStatus")} label="Raw materials" value={m.rawMatStatus} />
          <Resp ctx={ctx} field={f("materialDetails")} label="Material details" value={m.materialDetails} multiline />
          <Resp ctx={ctx} field={f("laborType")} label="Labour type" value={m.laborType} />
          <Resp ctx={ctx} field={f("workerCount")} label="Workers" value={m.workerCount} />
          <Resp ctx={ctx} field={f("workerRoles")} label="Worker roles" value={m.workerRoles} multiline />
          <Resp ctx={ctx} field={f("logistics")} label="Logistics" value={m.logistics} />
          <Resp ctx={ctx} field={f("logisticsPartner")} label="Logistics partner" value={m.logisticsPartner} />
          <Resp ctx={ctx} field={f("pricing")} label="Pricing" value={m.pricing} />
          <Resp ctx={ctx} field={f("insurance")} label="Insurance" value={m.insurance} multiline />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- tab 3 */
function DocumentsTab({ d }: { d: Detail }) {
  const c = d.profile.profileData.company;
  const certs = d.profile.profileData.certifications;
  const images = d.profile.state.machinery.flatMap((m) => m.images.map((img) => ({ ...img, listing: m.type })));
  return (
    <div className="adm-tab-body">
      <Section title="Company branding">
        <div className="adm-brand-grid">
          <Media label="Logo" src={c.logo} />
          <Media label="Cover image" src={c.cover} wide />
        </div>
      </Section>
      <Section title="Certification documents">
        {certs.filter((x) => x.fileName).length === 0 ? (
          <p className="adm-muted">No certification documents uploaded.</p>
        ) : (
          <div className="adm-stack">
            {certs
              .filter((x) => x.fileName)
              .map((x, i) => (
                <div key={i} className="cert-item">
                  <div className="cert-item-main adm-doc-row">
                    <FileText size={18} />
                    <div>
                      <b>{x.fileName}</b>
                      <span>{x.name}</span>
                    </div>
                  </div>
                  <span className="badge badge-neutral">{x.status}</span>
                </div>
              ))}
          </div>
        )}
      </Section>
      <Section title={`Machinery images (${images.length})`}>
        {images.length === 0 ? (
          <p className="adm-muted">No machinery images uploaded.</p>
        ) : (
          <div className="img-grid adm-img-grid">
            {images.map((img, i) => (
              <figure key={i} className={`img-thumb${img.primary ? " primary" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.src} alt={img.listing || "Machinery image"} />
                <figcaption>{img.listing}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </Section>
      <p className="adm-muted adm-foot-note">Files are uploaded by the manufacturer. Admins can view them here.</p>
    </div>
  );
}

function Media({ label, src, wide }: { label: string; src: string | null | undefined; wide?: boolean }) {
  return (
    <div className={`adm-media${wide ? " wide" : ""}`}>
      <p className="detail-label">{label}</p>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} />
      ) : (
        <div className="adm-media-empty">
          <ImageIcon size={22} />
          <span>Not uploaded</span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- tab 4 */
function OnboardingTab({ d, onChange }: { d: Detail; onChange: (d: Detail) => void }) {
  const call = useAdminApi();
  const toast = useToast();
  const me = useAdminMe();
  const m = d.manufacturer;
  const [status, setStatus] = useState<ReviewStatus>(m.reviewStatus);
  const [statusReason, setStatusReason] = useState("");
  const [recordType, setRecordType] = useState<RecordType>(m.recordType);
  const [entrySource, setEntrySource] = useState<EntrySource>(m.entrySource);
  const [referral, setReferral] = useState(m.referralSource ?? "");
  const [note, setNote] = useState("");
  const [shareNote, setShareNote] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ where: string; msg: string } | null>(null);

  async function patch(where: string, body: Record<string, unknown>, done: string) {
    setBusy(where);
    setErr(null);
    try {
      const next = await call<Detail>(`/manufacturers/${m.id}/admin-fields`, jsonBody("PATCH", body));
      onChange(next);
      toast(done);
      return true;
    } catch (e) {
      setErr({ where, msg: e instanceof Error ? e.message : "Could not save" });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    setBusy("note");
    setErr(null);
    try {
      const res = await call<{ notes: Note[] }>(`/manufacturers/${m.id}/notes`, jsonBody("POST", { note: note.trim(), share: shareNote }));
      onChange({ ...d, notes: res.notes });
      setNote("");
      toast(shareNote ? "Note added and sent to the manufacturer" : "Note added");
      setShareNote(false);
    } catch (e) {
      setErr({ where: "note", msg: e instanceof Error ? e.message : "Could not add the note" });
    } finally {
      setBusy(null);
    }
  }

  const sections = d.sectionsOrder.map((name) => ({
    name,
    complete: m.sections.find((s) => s.name === name)?.complete ?? false,
    fields: d.requiredFields.filter((f) => f.section === name),
  }));

  return (
    <div className="adm-tab-body adm-two-col">
      <div className="adm-col">
        <Section
          title="Onboarding progress"
          note={
            <span className="adm-muted">
              {m.completeness}% · last completed: {m.lastCompletedSection ?? "none"}
            </span>
          }
        >
          <ol className="adm-steps">
            {sections.map((s) => (
              <li key={s.name} className={s.complete ? "done" : m.stoppedAt === s.name ? "current" : ""}>
                <span className="adm-step-icon">{s.complete ? <CheckCircle2 size={18} /> : <Circle size={18} />}</span>
                <div>
                  <b>{s.name}</b>
                  {m.stoppedAt === s.name && <span className="badge badge-pending adm-inline-badge">Stopped here</span>}
                  <ul>
                    {s.fields.map((f) => (
                      <li key={f.key} className={f.done ? "ok" : "miss"}>
                        {f.done ? "✓" : "✕"} {f.label}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Timeline">
          <ul className="adm-timeline">
            {d.timeline.map((t, i) => (
              <li key={i}>
                <b>{t.event}</b>
                <span>{fmtDateTime(t.at)}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <div className="adm-col">
        <Section title="Review status" note={<ReviewBadge status={m.reviewStatus} />}>
          <label htmlFor="rv-status">Change status</label>
          <select id="rv-status" value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus)}>
            {REVIEW_ORDER.map((s) => (
              <option key={s} value={s}>
                {REVIEW_LABELS[s]}
              </option>
            ))}
          </select>
          <label htmlFor="rv-reason" style={{ marginTop: 12 }}>
            {status === "NEEDS_CORRECTION" ? (
              <>
                What needs correcting? <span className="adm-req">*</span>
              </>
            ) : (
              <>
                Reason <span className="optional">(optional)</span>
              </>
            )}
          </label>
          <textarea id="rv-reason" rows={2} value={statusReason} onChange={(e) => setStatusReason(e.target.value)} />
          {status === "NEEDS_CORRECTION" && status !== m.reviewStatus && (
            <p className="field-hint">The manufacturer gets this note as a notification and a popup on their dashboard.</p>
          )}
          {err?.where === "status" && <p className="field-error">{err.msg}</p>}
          <div className="adm-btn-row">
            <button
              type="button"
              className="btn-primary adm-btn-sm"
              disabled={busy !== null || status === m.reviewStatus}
              onClick={async () => {
                if (await patch("status", { review_status: status, reason: statusReason || null }, `Status set to ${REVIEW_LABELS[status]}`))
                  setStatusReason("");
              }}
            >
              Save status
            </button>
            {m.reviewStatus !== "REVIEWED" && (
              <button
                type="button"
                className="btn-ghost"
                disabled={busy !== null}
                onClick={async () => {
                  setStatus("REVIEWED");
                  await patch("status", { review_status: "REVIEWED", reason: statusReason || null }, "Marked as reviewed");
                }}
              >
                <CheckCircle2 size={15} /> Mark reviewed
              </button>
            )}
          </div>
        </Section>

        <Section title="Assignment">
          <label htmlFor="rv-assign">Assigned admin</label>
          <select
            id="rv-assign"
            value={m.assignedAdminId ?? ""}
            disabled={busy !== null}
            onChange={(e) =>
              void patch(
                "assign",
                e.target.value ? { assigned_admin_id: e.target.value } : { unassign: true },
                e.target.value ? "Admin assigned" : "Unassigned",
              )
            }
          >
            <option value="">Unassigned</option>
            {d.admins.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.email}
                {a.id === me?.id ? " (you)" : ""}
              </option>
            ))}
          </select>
          {err?.where === "assign" && <p className="field-error">{err.msg}</p>}
        </Section>

        <Section title="Record classification">
          <div className="form-grid adm-form-2">
            <div>
              <label htmlFor="rv-record">Record type</label>
              <select id="rv-record" value={recordType} onChange={(e) => setRecordType(e.target.value as RecordType)}>
                {RECORD_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {RECORD_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rv-entry">Entry source</label>
              <select id="rv-entry" value={entrySource} onChange={(e) => setEntrySource(e.target.value as EntrySource)}>
                {ENTRY_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {ENTRY_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label htmlFor="rv-ref">Referral source</label>
              <input
                id="rv-ref"
                type="text"
                placeholder="e.g. Trade fair, association, sales call"
                value={referral}
                onChange={(e) => setReferral(e.target.value)}
              />
            </div>
          </div>
          <p className="field-hint">Demo and test records are excluded from totals and analytics.</p>
          {err?.where === "record" && <p className="field-error">{err.msg}</p>}
          <div className="adm-btn-row">
            <button
              type="button"
              className="btn-primary adm-btn-sm"
              disabled={
                busy !== null ||
                (recordType === m.recordType && entrySource === m.entrySource && referral.trim() === (m.referralSource ?? ""))
              }
              onClick={() =>
                void patch(
                  "record",
                  {
                    ...(recordType !== m.recordType ? { record_type: recordType } : {}),
                    ...(entrySource !== m.entrySource ? { entry_source: entrySource } : {}),
                    ...(referral.trim() !== (m.referralSource ?? "") ? { referral_source: referral.trim() } : {}),
                  },
                  "Classification saved",
                )
              }
            >
              Save classification
            </button>
          </div>
        </Section>

        <Section title={`Internal notes (${d.notes.length})`} note={<span className="adm-muted">Private unless shared with the manufacturer</span>}>
          <textarea rows={3} placeholder={shareNote ? "Write a message for the manufacturer…" : "Add a note for other admins…"} value={note} onChange={(e) => setNote(e.target.value)} aria-label="New note" />
          <label className="adm-toggle adm-share-toggle">
            <input id="note-share" type="checkbox" checked={shareNote} onChange={(e) => setShareNote(e.target.checked)} />
            Show to manufacturer (they get a notification)
          </label>
          {err?.where === "note" && <p className="field-error">{err.msg}</p>}
          <div className="adm-btn-row">
            <button type="button" className="btn-primary adm-btn-sm" disabled={busy !== null || !note.trim()} onClick={() => void addNote()}>
              {shareNote ? "Send to manufacturer" : "Add note"}
            </button>
          </div>
          <ul className="adm-notes">
            {d.notes.map((n) => (
              <li key={n.id}>
                <p>{n.note}</p>
                <span>
                  {n.admin_name || "Admin"} · {fmtDateTime(n.created_at)}
                  {n.shared && <span className="badge badge-info adm-inline-badge">Shown to manufacturer</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- tab 5 */
function HistoryTab({ d }: { d: Detail }) {
  if (d.history.length === 0)
    return (
      <div className="card adm-section">
        <p className="adm-muted">No admin changes yet. Every admin edit is recorded here with the old and new value, the admin, the time and the reason.</p>
      </div>
    );
  return (
    <div className="card adm-table-card">
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Field</th>
              <th>Old value</th>
              <th>New value</th>
              <th>Changed by</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {d.history.map((h) => (
              <tr key={h.id}>
                <td className="adm-nowrap">{fmtDateTime(h.created_at)}</td>
                <td className="adm-cell-main">{h.field_changed}</td>
                <td className="adm-pre adm-old">{h.old_value || <span className="adm-muted">empty</span>}</td>
                <td className="adm-pre adm-new">{h.new_value || <span className="adm-muted">empty</span>}</td>
                <td>{h.changed_by || "—"}</td>
                <td>{h.reason || <span className="adm-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
