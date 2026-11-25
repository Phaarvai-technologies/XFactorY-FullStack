/**
 * "Send on WhatsApp" (magic-link invitations): WhatsApp's official click-to-chat link
 * (https://wa.me/...). It opens WhatsApp (app or WhatsApp Web) with the manufacturer's number and
 * the invitation message already typed; a person on the team presses Send. Free, nothing is sent
 * by XfactorY itself, no WhatsApp account or approval needed.
 */

/** International number for wa.me: digits only, country code first. Indian numbers without a
 * country code get 91. Returns null when it cannot be a phone number. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const raw = (phone ?? "").trim();
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = `91${digits.slice(1)}`; // 0 + 10-digit Indian number
  } else if (digits.length === 10) {
    digits = `91${digits}`; // 10-digit Indian number
  }
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/** The same content as the invitation email (backend email_templates.manufacturer_invite). */
export function invitationMessage(contactName: string, companyName: string, link: string): string {
  const first = contactName.trim().split(/\s+/)[0] ?? "";
  return [
    `Hello ${first || "there"},`,
    `Thank you for speaking with the XfactorY team. Your account for *${companyName}* is ready.`,
    "",
    "Open it here (no password needed):",
    link,
    "",
    "Please check your details, add anything missing and press *Confirm details* within 7 days.",
    "The link works for 14 days.",
    "",
    "– XfactorY Team",
  ].join("\n");
}

/** wa.me link: to the number when there is one, otherwise WhatsApp asks whom to send it to. */
export function whatsappUrl(phone: string | null | undefined, message: string): string {
  const number = whatsappNumber(phone);
  return `https://wa.me/${number ?? ""}?text=${encodeURIComponent(message)}`;
}
