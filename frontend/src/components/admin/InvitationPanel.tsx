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
  /** Made without an email: the person enters their email when they open the link. */
  withoutEmail?: boolean;
  /** owner, or admin (an additional login on a company that already had an owner). */
  acceptedRole?: string | null;
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
 * Magic link (in Registered Users on the company page, and on the Add manufacturer page).
 * Daily check-in 26 Nov 2026: any company can get a link, also one that already has an owner or
 * is approved (the person joins as an additional login); a link can be made with an email (the
 * account is created and the link emailed) or without one (sent by WhatsApp / Copy link: the
 * person enters their email when they open it). Several open links are listed, each with Send on
 * WhatsApp, Copy link, Resend and Cancel.
 */
export function InvitationPanel({
  orgId,
  hasOwner,
  onChanged,
  inviteDefaults,
  blockedReason = null,
  onEditDetails,
  embedded = false,
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
  /** Shown inside another card (Registered Users): no card of its own. */
  embedded?: boolean;
}) {
  const call = useAdminApi();
  const toast = useToast();
  const { data, reload } = useResource<InvitationsResponse>(`/manufacturers/${orgId}/invitations`);
  const [inviteMode, setInviteMode] = useState<"email" | "link" | null>(null);
  const [machineOpen, setMachineOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  /** What happened to the invitation email (sent / failed / email off), shown on the card. */
  const [mailNote, setMailNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  // Not loaded yet, or an older backend without invitations: the panel stays out of the way.
  if (!data || !Array.isArray(data.invitations) || !data.details) return null;
  const isOpen = (i: Invitation) => i.status === "invited" || i.status === "opened";
  const openList = data.invitations.filter(isOpen);
  // Closed ones: the latest few, so the team sees who set up an account or which link expired.
  const closed = data.invitations.filter((i) => !isOpen(i)).slice(0, openList.length ? 2 : 3);
  const shownList = [...openList, ...closed];

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
    const url = whatsappUrl(
      invitation.phone,
      invitationMessage(invitation.contactName, invitation.companyName, invitation.link, invitation.respondBy, !!invitation.withoutEmail),
    );
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

  const who = (i: Invitation) => (
    <>
      <b>{i.contactName || (i.withoutEmail && !i.email ? "Link without email" : i.email)}</b>
      {i.email ? ` · ${i.email}` : i.withoutEmail ? " · they enter their email when they open it" : ""}
      {i.phone ? ` · ${i.phone}` : ""}
    </>
  );

  const body = (
    <>
      <p className={embedded ? "adm-section-hint" : "field-hint"}>
        {hasOwner
          ? "This company already has a login. You can still send a link to add another person (they join as an additional login)."
          : "After a call, check the details below, then send a link: it opens the manufacturer's account without a password."}
      </p>

      {shownList.length ? (
        <div className="adm-stack">
          {shownList.map((i) => {
            const live = isOpen(i) && !!i.link;
            return (
              <div key={i.id} className="adm-invite-row">
                <p>
                  <span className={`badge ${STATUS[i.status].badge}`}>
                    {i.status === "accepted" && i.acceptedRole === "admin" ? "Account set up · additional login" : STATUS[i.status].label}
                  </span>{" "}
                  {who(i)}
                </p>
                <p className="adm-cell-sub">
                  {i.withoutEmail ? "Link made" : "Sent"} {fmtDate(i.lastSentAt)}
                  {i.sendCount > 1 ? ` (${i.sendCount} times)` : ""}
                  {i.createdBy ? ` by ${i.createdBy}` : ""}
                  {i.withoutEmail ? "" : ` · reminders sent: ${i.remindersSent}`}
                  {i.openedAt ? ` · opened ${i.openCount} time${i.openCount === 1 ? "" : "s"}` : ""}
                  {i.status === "accepted" && i.acceptedAt ? ` · set up ${fmtDate(i.acceptedAt)}` : ""}
                  {isOpen(i) && i.respondBy ? ` · asked to confirm by ${fmtDate(i.respondBy)}` : ""}
                  {isOpen(i) ? ` · link works until ${fmtDate(i.expiresAt)}` : ""}
                </p>
                {data.canInvite && (live || isOpen(i) || i.status === "expired" || i.status === "cancelled") ? (
                  <div className="adm-btn-row">
                    {live ? (
                      <>
                        <button
                          type="button"
                          className="btn-primary adm-btn-sm"
                          title={
                            whatsappNumber(i.phone)
                              ? `Opens WhatsApp with the message to ${i.phone}; press Send there`
                              : "No valid phone number: WhatsApp will ask whom to send it to"
                          }
                          onClick={() => sendOnWhatsApp(i)}
                        >
                          Send on WhatsApp
                        </button>
                        <button type="button" className="btn-secondary-full adm-btn-sm" onClick={() => void copy(i.link!)}>
                          Copy link
                        </button>
                      </>
                    ) : null}
                    {isOpen(i) ? (
                      <>
                        <button type="button" className="btn-secondary-full adm-btn-sm" disabled={busy !== null}
                          onClick={() => void act(`resend-${i.id}`, `/invitations/${i.id}/resend`,
                            i.email && !i.withoutEmail ? "New link sent. The old link no longer works." : "New link made. The old link no longer works.")}>
                          {busy === `resend-${i.id}` ? "Sending…" : i.email && !i.withoutEmail ? "Resend" : "New link"}
                        </button>
                        <button type="button" className="btn-secondary-full adm-btn-sm" disabled={busy !== null}
                          onClick={() => void act(`cancel-${i.id}`, `/invitations/${i.id}/cancel`, "Invitation cancelled")}>
                          Cancel invitation
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn-secondary-full adm-btn-sm" disabled={busy !== null}
                        onClick={() => void act(`resend-${i.id}`, `/invitations/${i.id}/resend`, "New link made")}>
                        {i.email && !i.withoutEmail ? `Send a new link to ${i.email}` : "Make a new link"}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="adm-muted">No magic link yet.</p>
      )}

      {data.details.source === "confirmed_by_manufacturer" && data.details.approvalStatus === "submitted" ? (
        <p className="field-hint">
          The manufacturer confirmed the details. Check them, then approve or ask for corrections under Onboarding &amp;
          review → Review status.
        </p>
      ) : null}
      {err ? <p className="field-error">{err}</p> : null}
      {blockedReason ? <p className="field-hint">{blockedReason}</p> : null}
      {mailNote ? (
        <p className={mailNote.tone === "ok" ? "field-hint" : "field-error"} role="status">{mailNote.text}</p>
      ) : null}

      {data.canInvite ? (
        <div className="adm-btn-row">
          <button type="button" className="btn-primary adm-btn-sm" disabled={!!blockedReason} title={blockedReason ?? undefined}
            onClick={() => setInviteMode("email")}>
            {hasOwner ? "Invite another user" : "Invite manufacturer"}
          </button>
          <button type="button" className="btn-secondary-full adm-btn-sm" disabled={!!blockedReason} title={blockedReason ?? undefined}
            onClick={() => setInviteMode("link")}>
            Generate link without email
          </button>
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

      {inviteMode ? (
        <InviteModal
          orgId={orgId}
          mode={inviteMode}
          defaults={inviteDefaults}
          onClose={() => setInviteMode(null)}
          onDone={(link, mail, email) => {
            setInviteMode(null);
            setMailNote(mail === "none" ? null : emailNote(mail, email));
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
    </>
  );

  if (embedded) {
    return (
      <div className="adm-invite-embedded">
        <div className="adm-section-head">
          <h4>Magic link</h4>
          <DetailsSourceBadge details={data.details} />
        </div>
        {body}
      </div>
    );
  }
  return (
    <section className="card adm-section">
      <div className="adm-section-head">
        <h3>Magic link</h3>
        <DetailsSourceBadge details={data.details} />
      </div>
      {body}
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

function InviteModal({ orgId, mode, defaults, onClose, onDone }: {
  orgId: string;
  /** email: account created and the link emailed; link: only the link (WhatsApp / Copy link). */
  mode: "email" | "link";
  defaults?: { name: string; email: string; phone: string };
  onClose: () => void;
  onDone: (link: string, mail: string, email: string) => void;
}) {
  const call = useAdminApi();
  const [name, setName] = useState(defaults?.name ?? "");
  const [email, setEmail] = useState(mode === "email" ? (defaults?.email ?? "") : "");
  const [phone, setPhone] = useState(defaults?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (mode === "email" && (!name.trim() || !email.trim())) {
      setErr("Please enter the person's name and email.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const result = await call<{ link: string; email: string; invitation: { email: string } }>(
        `/manufacturers/${orgId}/invitations`,
        jsonBody("POST", { contactName: name.trim() || null, email: mode === "email" ? email : null, phone: phone || null }),
      );
      onDone(result.link, result.email, result.invitation.email);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the link.");
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === "email" ? "Invite by email" : "Generate link without email"} onClose={onClose}>
      <p className="adm-modal-text">
        {mode === "email"
          ? "Creates the person's account (no password) and emails them a link that opens it. The email asks them to confirm the details within 7 days; the link works for 14 days or until they set up the account. Reminders go out on days 3, 7 and 12."
          : "Makes a link to send by WhatsApp or copy. When the person opens it, they enter their own email and the code we email them, then set a password or use Google. The link works for 14 days."}
      </p>
      <div className="adm-add-company-grid">
        <div>
          <label htmlFor="inv-name">Name {mode === "email" ? <span className="adm-req">*</span> : null}</label>
          <input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        {mode === "email" ? (
          <div>
            <label htmlFor="inv-email">Email (their login) <span className="adm-req">*</span></label>
            <input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        ) : null}
        <div>
          <label htmlFor="inv-phone">Phone (WhatsApp)</label>
          <input id="inv-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
        </div>
      </div>
      {err ? <p className="field-error">{err}</p> : null}
      <div className="modal-actions">
        <button type="button" className="btn-secondary-full" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Creating…" : mode === "email" ? "Send invitation" : "Generate link"}
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
