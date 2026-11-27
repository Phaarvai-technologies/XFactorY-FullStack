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
  /** How the link was shared first: email, or whatsapp (no email sent). */
  channel?: "email" | "whatsapp" | null;
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
 * Magic link ("Invited users": in Registered Users on the company page, and on the Add
 * manufacturer page right after saving).
 * Meeting 27 Nov 2026: Send by Email and Send by WhatsApp are separate options. WhatsApp does not
 * need an email invitation first, nor an email at all (they enter one when they open the link).
 * Both open the same page: Terms, "Open my account" (no password), then set a password.
 * 26 Nov: any company can get a link, also one with an owner (an additional login). Each open
 * link has Send on WhatsApp, Send by Email (when there is an email), Copy link, New link, Cancel.
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
  const [inviteMode, setInviteMode] = useState<"email" | "whatsapp" | null>(null);
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
  const hasEmail = (i: Invitation) => !!i.email;

  async function act(key: string, path: string, done: string) {
    setBusy(key);
    setErr("");
    try {
      const result = await call<{ email?: string; invitation?: { email: string } }>(path, { method: "POST" });
      if (result?.email && result.invitation && result.email !== "none" && result.email !== "not_sent")
        setMailNote(emailNote(result.email, result.invitation.email));
      else setMailNote(null);
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
  function sendOnWhatsApp(invitation: Invitation, win?: Window | null) {
    if (!invitation.link) return;
    const url = whatsappUrl(
      invitation.phone,
      invitationMessage(invitation.contactName, invitation.companyName, invitation.link, invitation.respondBy,
        !invitation.email),
    );
    if (win) win.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
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
      <b>{i.contactName || (i.email ? i.email : "No email given")}</b>
      {i.email ? ` · ${i.email}` : " · they enter their email when they open the link"}
      {i.phone ? ` · ${i.phone}` : ""}
    </>
  );

  const body = (
    <>
      <p className={embedded ? "adm-section-hint" : "field-hint"}>
        {hasOwner
          ? "This company already has a login. You can still send a link to add another person (they join as an additional login)."
          : "Send the link by email or WhatsApp (or both). It opens the manufacturer's account without a password."}{" "}
        If they have a few minutes on the call, help them open the link and sign in now; otherwise share it and tell them
        whom to contact for help.
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
                  {i.channel === "whatsapp" ? "Shared on WhatsApp" : "Emailed"} {fmtDate(i.lastSentAt)}
                  {i.sendCount > 1 ? ` (${i.sendCount} links)` : ""}
                  {i.createdBy ? ` by ${i.createdBy}` : ""}
                  {hasEmail(i) ? ` · reminder emails: ${i.remindersSent} of 3` : ""}
                  {i.openedAt ? ` · opened ${i.openCount} time${i.openCount === 1 ? "" : "s"}` : ""}
                  {i.status === "accepted" && i.acceptedAt ? ` · set up ${fmtDate(i.acceptedAt)}` : ""}
                  {isOpen(i) && i.respondBy ? ` · asked to confirm by ${fmtDate(i.respondBy)}` : ""}
                  {isOpen(i) ? ` · link works until ${fmtDate(i.expiresAt)}` : ""}
                </p>
                {data.canInvite && (isOpen(i) || i.status === "expired" || i.status === "cancelled") ? (
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
                        {hasEmail(i) ? (
                          <button type="button" className="btn-secondary-full adm-btn-sm" disabled={busy !== null}
                            onClick={() => void act(`email-${i.id}`, `/invitations/${i.id}/email`, `Link emailed to ${i.email}`)}>
                            {busy === `email-${i.id}` ? "Sending…" : i.channel === "whatsapp" ? "Send by Email" : "Email again"}
                          </button>
                        ) : null}
                        <button type="button" className="btn-secondary-full adm-btn-sm" onClick={() => void copy(i.link!)}>
                          Copy link
                        </button>
                      </>
                    ) : null}
                    {isOpen(i) ? (
                      <>
                        <button type="button" className="btn-secondary-full adm-btn-sm" disabled={busy !== null}
                          onClick={() => void act(`resend-${i.id}`, `/invitations/${i.id}/resend`, "New link made. The old link no longer works.")}>
                          {busy === `resend-${i.id}` ? "Working…" : "New link"}
                        </button>
                        <button type="button" className="btn-secondary-full adm-btn-sm" disabled={busy !== null}
                          onClick={() => void act(`cancel-${i.id}`, `/invitations/${i.id}/cancel`, "Invitation cancelled")}>
                          Cancel invitation
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn-secondary-full adm-btn-sm" disabled={busy !== null}
                        onClick={() => void act(`resend-${i.id}`, `/invitations/${i.id}/resend`, "New link made")}>
                        Make a new link{i.email ? ` for ${i.email}` : ""}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="adm-muted">No one invited yet.</p>
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
            Send by Email
          </button>
          <button type="button" className="btn-primary adm-btn-sm" disabled={!!blockedReason} title={blockedReason ?? undefined}
            onClick={() => setInviteMode("whatsapp")}>
            Send by WhatsApp
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
          onDone={(created, win) => {
            setInviteMode(null);
            reload();
            onChanged();
            if (inviteMode === "whatsapp") {
              setMailNote(null);
              sendOnWhatsApp({ ...created.invitation, link: created.link } as Invitation, win);
            } else {
              setMailNote(emailNote(created.email, created.invitation.email));
            }
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
          <h4>Invited users (magic link)</h4>
          <DetailsSourceBadge details={data.details} />
        </div>
        {body}
      </div>
    );
  }
  return (
    <section className="card adm-section">
      <div className="adm-section-head">
        <h3>Invite the manufacturer (magic link)</h3>
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

type Created = { link: string; email: string; invitation: Invitation };

/**
 * Send by Email: name and email needed (the link is emailed; reminders on days 3, 7 and 12).
 * Send by WhatsApp: confirm the number; the email is optional (without one, the person enters it
 * when they open the link). No email is sent; WhatsApp opens with the message.
 */
function InviteModal({ orgId, mode, defaults, onClose, onDone }: {
  orgId: string;
  mode: "email" | "whatsapp";
  defaults?: { name: string; email: string; phone: string };
  onClose: () => void;
  onDone: (created: Created, win: Window | null) => void;
}) {
  const call = useAdminApi();
  const [name, setName] = useState(defaults?.name ?? "");
  const [email, setEmail] = useState(defaults?.email ?? "");
  const [phone, setPhone] = useState(defaults?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (mode === "email" && (!name.trim() || !email.trim())) {
      setErr("Please enter the person's name and email.");
      return;
    }
    if (mode === "whatsapp" && !whatsappNumber(phone)) {
      setErr("Please confirm the WhatsApp number (with the country code, e.g. +91 98765 43210).");
      return;
    }
    // WhatsApp: open the window now (browsers block windows opened after waiting for the server).
    const win = mode === "whatsapp" ? window.open("", "_blank") : null;
    if (win) win.opener = null;
    setBusy(true);
    setErr("");
    try {
      const created = await call<Created>(
        `/manufacturers/${orgId}/invitations`,
        jsonBody("POST", { contactName: name.trim() || null, email: email.trim() || null, phone: phone.trim() || null,
                           sendEmail: mode === "email" }),
      );
      onDone(created, win);
    } catch (e) {
      win?.close();
      setErr(e instanceof Error ? e.message : "Could not create the link.");
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === "email" ? "Send by Email" : "Send by WhatsApp"} onClose={onClose}>
      <p className="adm-modal-text">
        {mode === "email"
          ? "Emails a link that opens their account without a password. The email asks them to confirm their details within 7 days; the link works for 14 days. Reminder emails go out on days 3, 7 and 12."
          : "Confirm their WhatsApp number. WhatsApp opens with the message and link; press Send there. No email is sent. If they gave no email, they enter one when they open the link."}
      </p>
      <div className="adm-add-company-grid">
        <div>
          <label htmlFor="inv-name">Name {mode === "email" ? <span className="adm-req">*</span> : null}</label>
          <input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        {mode === "whatsapp" ? (
          <div>
            <label htmlFor="inv-phone">WhatsApp number <span className="adm-req">*</span></label>
            <input id="inv-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
          </div>
        ) : null}
        <div>
          <label htmlFor="inv-email">
            Email (their login) {mode === "email" ? <span className="adm-req">*</span> : <span className="adm-muted">optional</span>}
          </label>
          <input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode === "email" ? (
          <div>
            <label htmlFor="inv-phone">Phone (WhatsApp)</label>
            <input id="inv-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
          </div>
        ) : null}
      </div>
      {err ? <p className="field-error">{err}</p> : null}
      <div className="modal-actions">
        <button type="button" className="btn-secondary-full" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Working…" : mode === "email" ? "Send email" : "Open WhatsApp"}
        </button>
      </div>
    </Modal>
  );
}

const MACHINE_INDUSTRIES = [
  "Textile & Apparel", "Electronics & Hardware", "Food & Beverage", "Automotive & Machinery",
  "Furniture & Woodwork", "Chemicals & Plastics", "Footwear & Leather", "Other",
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
