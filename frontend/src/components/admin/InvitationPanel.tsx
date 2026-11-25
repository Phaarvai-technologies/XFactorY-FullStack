"use client";

import { useState } from "react";
import { Modal } from "@/components/admin/ui";
import { useToast } from "@/components/admin/AdminShell";
import { fmtDate } from "@/lib/admin/format";
import { jsonBody, useAdminApi, useResource } from "@/lib/admin/api";
import { invitationMessage, whatsappNumber, whatsappUrl } from "@/lib/admin/whatsapp";

/** Magic-link invitation (backend app/invitations.py). */
type Invitation = {
  id: string;
  companyName: string;
  email: string;
  contactName: string;
  phone: string;
  status: "invited" | "opened" | "accepted" | "expired" | "cancelled";
  expiresAt: string;
  openedAt: string | null;
  openCount: number;
  acceptedAt: string | null;
  remindersSent: number;
  lastSentAt: string;
  sendCount: number;
  createdBy: string;
  /** The date the invitation asks the manufacturer to confirm by (7 days after sending). */
  respondBy?: string;
  /** The working link while the invitation is open (Copy link / WhatsApp), else null. */
  link: string | null;
};
type DetailsState = {
  source: "entered_by_xfactory" | "confirmed_by_manufacturer" | null;
  at: string | null;
  by: string;
  reviewedAt: string | null;
  reviewedBy: string;
  /** manufacturer_onboarding.status (in_progress, submitted, changes_requested, approved, rejected). */
  approvalStatus?: string | null;
  feedback?: string | null;
};
type InvitationsResponse = { invitations: Invitation[]; details: DetailsState; canInvite: boolean };

const STATUS: Record<Invitation["status"], { label: string; badge: string }> = {
  invited: { label: "Invited · not opened", badge: "badge-pending" },
  opened: { label: "Opened · not set up", badge: "badge-pending" },
  accepted: { label: "Account set up", badge: "badge-verified" },
  expired: { label: "Expired", badge: "badge-neutral" },
  cancelled: { label: "Cancelled", badge: "badge-neutral" },
};

export function DetailsSourceBadge({ details }: { details: DetailsState | undefined }) {
  if (!details?.source) return null;
  if (details.approvalStatus === "approved")
    return <span className="badge badge-verified">{details.source === "entered_by_xfactory" ? "Entered by XfactorY · approved" : "Confirmed · approved"}</span>;
  if (details.approvalStatus === "changes_requested") return <span className="badge badge-pending">Corrections requested</span>;
  if (details.source === "entered_by_xfactory")
    return <span className="badge badge-pending" title={details.by ? `By ${details.by}` : undefined}>Entered by XfactorY · not confirmed</span>;
  return <span className="badge badge-pending">Confirmed by manufacturer · awaiting approval</span>;
}

/**
 * Manufacturer page: invite the manufacturer with a magic link after a call, see whether they
 * opened it and set up their account, copy / resend / cancel the link, add machines the caller
 * learned about, and do the quick review once the manufacturer confirmed the details.
 */
export function InvitationPanel({
  orgId,
  hasOwner,
  onChanged,
  inviteDefaults,
  blockedReason = null,
  onEditDetails,
}: {
  orgId: string;
  hasOwner: boolean;
  onChanged: () => void;
  /** Prefills the invite (the contact person saved on the Add manufacturer page). */
  inviteDefaults?: { name: string; email: string; phone: string };
  /** Why inviting is not possible right now (e.g. unsaved changes on the page), or null. */
  blockedReason?: string | null;
  /** Opens the one-page "Add manufacturer" form for this company. */
  onEditDetails?: () => void;
}) {
  const call = useAdminApi();
  const toast = useToast();
  const { data, reload } = useResource<InvitationsResponse>(`/manufacturers/${orgId}/invitations`);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [machineOpen, setMachineOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  /** What happened to the invitation email (sent / failed / email off), shown on the card. */
  const [mailNote, setMailNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  // Not loaded yet, or an older backend without invitations: the panel stays out of the way.
  if (!data || !Array.isArray(data.invitations) || !data.details) return null;
  const open = data.invitations.find((i) => i.status === "invited" || i.status === "opened") ?? null;
  const latest = data.invitations[0] ?? null;
  const shown = open ?? latest;

  async function act(key: string, path: string, done: string) {
    setBusy(key);
    setErr("");
    try {
      const result = await call<{ email?: string; invitation?: { email: string } }>(path, { method: "POST" });
      if (result?.email && result.invitation) setMailNote(emailNote(result.email, result.invitation.email));
      toast(done);
      reload();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That did not work. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  /** WhatsApp's official click-to-chat link: the message is typed, the team presses Send. */
  function sendOnWhatsApp(invitation: Invitation) {
    if (!invitation.link) return;
    const url = whatsappUrl(invitation.phone, invitationMessage(invitation.contactName, invitation.companyName, invitation.link));
    window.open(url, "_blank", "noopener,noreferrer");
    toast(
      whatsappNumber(invitation.phone)
        ? "WhatsApp opened with the message. Press Send there."
        : "WhatsApp opened with the message. Choose the manufacturer's chat, then press Send.",
    );
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied. You can paste it in WhatsApp or an email.");
    } catch {
      window.prompt("Copy this link:", link);
    }
  }

  return (
    <section className="card adm-section">
      <div className="adm-section-head">
        <h3>Magic link</h3>
        <DetailsSourceBadge details={data.details} />
      </div>

      {shown ? (
        <div className="adm-stack">
          <p>
            <span className={`badge ${STATUS[shown.status].badge}`}>{STATUS[shown.status].label}</span>{" "}
            <b>{shown.contactName}</b> · {shown.email}
            {shown.phone ? ` · ${shown.phone}` : ""}
          </p>
          <p className="adm-cell-sub">
            Sent {fmtDate(shown.lastSentAt)}
            {shown.sendCount > 1 ? ` (${shown.sendCount} times)` : ""}
            {shown.createdBy ? ` by ${shown.createdBy}` : ""} · reminders sent: {shown.remindersSent}
            {shown.openedAt ? ` · opened ${shown.openCount} time${shown.openCount === 1 ? "" : "s"}` : ""}
            {shown.status === "accepted" && shown.acceptedAt ? ` · set up ${fmtDate(shown.acceptedAt)}` : ""}
            {open && shown.respondBy ? ` · asked to confirm by ${fmtDate(shown.respondBy)}` : ""}
            {open ? ` · link works until ${fmtDate(shown.expiresAt)}` : ""}
          </p>
        </div>
      ) : (
        <p className="adm-muted">
          {hasOwner
            ? "This company already has an owner on XfactorY."
            : "No invitation yet. After a call, fill in the details below, then invite the manufacturer: they get a link that opens their account without a password."}
        </p>
      )}

      {data.details.source === "confirmed_by_manufacturer" && data.details.approvalStatus === "submitted" ? (
        <p className="field-hint">
          The manufacturer confirmed the details. Check them, then approve or ask for corrections under Onboarding &amp;
          review → Review status.
        </p>
      ) : null}
      {err ? <p className="field-error">{err}</p> : null}
      {blockedReason && !open && !hasOwner ? <p className="field-hint">{blockedReason}</p> : null}
      {mailNote ? (
        <p className={mailNote.tone === "ok" ? "field-hint" : "field-error"} role="status">{mailNote.text}</p>
      ) : null}

      {data.canInvite ? (
        <div className="adm-btn-row">
          {open?.link ? (
            <>
              <button
                type="button"
                className="btn-primary adm-btn-sm"
                title={
                  whatsappNumber(open.phone)
                    ? `Opens WhatsApp with the message to ${open.phone}; press Send there`
                    : "No valid phone number: WhatsApp will ask whom to send it to"
                }
                onClick={() => sendOnWhatsApp(open)}
              >
                Send on WhatsApp
              </button>
              <button type="button" className="btn-secondary-full adm-btn-sm" onClick={() => void copy(open.link!)}>
                Copy link
              </button>
            </>
          ) : null}
          {open ? (
            <>
              <button type="button" className="btn-secondary-full adm-btn-sm" disabled={busy !== null}
                onClick={() => void act("resend", `/invitations/${open.id}/resend`, "New link sent. The old link no longer works.")}>
                {busy === "resend" ? "Sending…" : "Resend"}
              </button>
              <button type="button" className="btn-secondary-full adm-btn-sm" disabled={busy !== null}
                onClick={() => void act("cancel", `/invitations/${open.id}/cancel`, "Invitation cancelled")}>
                Cancel invitation
              </button>
            </>
          ) : null}
          {!open && !hasOwner && latest && (latest.status === "expired" || latest.status === "cancelled") ? (
            <button type="button" className="btn-primary adm-btn-sm" disabled={busy !== null}
              onClick={() => void act("resend", `/invitations/${latest.id}/resend`, "New link sent")}>
              Send a new link to {latest.email}
            </button>
          ) : null}
          {!open && !hasOwner ? (
            <button type="button" className={latest ? "btn-secondary-full adm-btn-sm" : "btn-primary adm-btn-sm"}
              disabled={!!blockedReason} title={blockedReason ?? undefined}
              onClick={() => setInviteOpen(true)}>
              Invite manufacturer
            </button>
          ) : null}
          {onEditDetails ? (
            <button type="button" className="btn-secondary-full adm-btn-sm" onClick={onEditDetails}>
              Edit company, contact &amp; machines
            </button>
          ) : null}
          {onEditDetails ? null : inviteDefaults ? null : (
            <button type="button" className="btn-secondary-full adm-btn-sm" onClick={() => setMachineOpen(true)}>
              Add machine
            </button>
          )}

        </div>
      ) : (
        <p className="field-hint">Only administrators and operators can invite manufacturers.</p>
      )}

      {inviteOpen ? (
        <InviteModal
          orgId={orgId}
          defaults={inviteDefaults}
          onClose={() => setInviteOpen(false)}
          onDone={(link, mail, email) => {
            setInviteOpen(false);
            setMailNote(emailNote(mail, email));
            reload();
            onChanged();
            void copy(link);
          }}
        />
      ) : null}
      {machineOpen ? (
        <MachineModal
          orgId={orgId}
          onClose={() => setMachineOpen(false)}
          onDone={() => {
            setMachineOpen(false);
            reload();
            onChanged();
            toast("Machine added");
          }}
        />
      ) : null}
    </section>
  );
}

/** The invitation email's outcome, in words for the team (the link can always be copied). */
function emailNote(status: string, email: string): { tone: "ok" | "warn"; text: string } {
  if (status === "sent") return { tone: "ok", text: `Invitation email sent to ${email}. Use Send on WhatsApp to send it there too.` };
  if (status === "skipped")
    return { tone: "warn", text: "Email is off on the server (SMTP is not set up), so no email was sent. Use Send on WhatsApp (or Copy link) to send it." };
  return { tone: "warn", text: `The email to ${email} could not be sent (check the SMTP settings or Admin → Support). Use Send on WhatsApp meanwhile.` };
}

function InviteModal({ orgId, defaults, onClose, onDone }: {
  orgId: string;
  defaults?: { name: string; email: string; phone: string };
  onClose: () => void;
  onDone: (link: string, mail: string, email: string) => void;
}) {
  const call = useAdminApi();
  const [name, setName] = useState(defaults?.name ?? "");
  const [email, setEmail] = useState(defaults?.email ?? "");
  const [phone, setPhone] = useState(defaults?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!name.trim() || !email.trim()) {
      setErr("Please enter the contact person's name and email.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const result = await call<{ link: string; email: string; invitation: { email: string } }>(
        `/manufacturers/${orgId}/invitations`,
        jsonBody("POST", { contactName: name, email, phone: phone || null }),
      );
      onDone(result.link, result.email, result.invitation.email);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send the invitation.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Invite manufacturer" onClose={onClose}>
      <p className="adm-modal-text">
        Creates the manufacturer&apos;s account (no password) and emails them a link that opens it. The email asks them to
        confirm their details within 7 days; the link works for 14 days or until they set up the account. Use Send on
        WhatsApp to send it there too. Reminders go out on days 3, 7 and 12.
      </p>
      <div className="adm-add-company-grid">
        <div>
          <label htmlFor="inv-name">Contact name <span className="adm-req">*</span></label>
          <input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label htmlFor="inv-email">Email (their login) <span className="adm-req">*</span></label>
          <input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="inv-phone">Phone (WhatsApp)</label>
          <input id="inv-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
        </div>
      </div>
      {err ? <p className="field-error">{err}</p> : null}
      <div className="modal-actions">
        <button type="button" className="btn-secondary-full" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Sending…" : "Send invitation"}
        </button>
      </div>
    </Modal>
  );
}

const MACHINE_INDUSTRIES = [
  "Textile & Apparel", "Electronics & Hardware", "Food & Beverage", "Automotive & Machinery",
  "Furniture & Woodwork", "Chemicals & Plastics", "Other",
];

function MachineModal({ orgId, onClose, onDone }: { orgId: string; onClose: () => void; onDone: () => void }) {
  const call = useAdminApi();
  const [v, setV] = useState({ type: "", industry: "", subcategory: "", capacity: "", technical: "", reason: "Details from a call with the manufacturer" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (key: keyof typeof v) => (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [key]: e.target.value }));

  async function submit() {
    if (!v.type.trim() || !v.reason.trim()) {
      setErr("Please enter the machine name and a reason.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await call(`/manufacturers/${orgId}/machinery`, jsonBody("POST", { ...v, status: "Published" }));
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add the machine.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Add machine" onClose={onClose}>
      <p className="adm-modal-text">
        Use the same name as in the Visionary machine list (for example &quot;Sheet Metal Bending&quot;) so Visionaries can
        match it. The manufacturer can edit it later.
      </p>
      <div className="adm-add-company-grid">
        <div>
          <label htmlFor="mc-type">Machine name <span className="adm-req">*</span></label>
          <input id="mc-type" value={v.type} onChange={set("type")} autoFocus />
        </div>
        <div>
          <label htmlFor="mc-industry">Industry</label>
          <select id="mc-industry" value={v.industry} onChange={set("industry")}>
            <option value="">Select</option>
            {MACHINE_INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="mc-sub">Subcategory / products</label>
          <input id="mc-sub" value={v.subcategory} onChange={set("subcategory")} />
        </div>
        <div>
          <label htmlFor="mc-cap">Capacity</label>
          <input id="mc-cap" value={v.capacity} onChange={set("capacity")} placeholder="e.g. 1500 pieces/day" />
        </div>
        <div className="adm-span-2">
          <label htmlFor="mc-tech">Technical details</label>
          <input id="mc-tech" value={v.technical} onChange={set("technical")} />
        </div>
        <div className="adm-span-2">
          <label htmlFor="mc-reason">Reason <span className="adm-req">*</span></label>
          <input id="mc-reason" value={v.reason} onChange={set("reason")} />
        </div>
      </div>
      {err ? <p className="field-error">{err}</p> : null}
      <div className="modal-actions">
        <button type="button" className="btn-secondary-full" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Adding…" : "Add machine"}
        </button>
      </div>
    </Modal>
  );
}
