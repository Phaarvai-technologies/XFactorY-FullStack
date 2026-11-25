/**
 * Manufacturer magic link (backend app/invitations.py). The XfactorY team sends a shareable link
 * /invite/{code}; opening it asks the backend for a fresh one-time Clerk sign-in ticket, so the
 * same link works until the account is set up (14 days at most).
 */
import { backendFetch, TERMS_VERSION, type Fetch } from "@/lib/auth/registration";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export type InvitationOpen =
  | { status: "open"; ticket: string; companyName: string; email: string; contactName: string }
  | { status: "accepted" | "expired" | "cancelled"; companyName: string; email: string; contactName: string }
  | { status: "invalid" };

export const INVITE_UNAVAILABLE = "We couldn't open your account right now. Please try again in a minute.";

export const INVITE_MESSAGES: Record<"accepted" | "expired" | "cancelled" | "invalid", string> = {
  accepted: "Your account is already set up. Sign in with Google, an email code, or your password.",
  expired: "This link has expired. Please ask XfactorY to send you a new one.",
  cancelled: "This link is no longer active. Please ask XfactorY to send you a new one.",
  invalid: "This link is not valid. Please check it, or ask XfactorY to send you a new one.",
};

/** POST (never GET), so email scanners that fetch links do not use it up. */
export async function openInvitation(code: string, fetchImpl: Fetch = fetch): Promise<InvitationOpen> {
  let response: Response;
  try {
    response = await backendFetch(fetchImpl, `${API_URL}/invitations/${encodeURIComponent(code)}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    throw new Error(INVITE_UNAVAILABLE);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body.status !== "string") {
    throw new Error((body && typeof body.detail === "string" && body.detail) || INVITE_UNAVAILABLE);
  }
  return body as InvitationOpen;
}

/** The signed-in invitee accepts the Terms: registered and owner of the company. */
export async function acceptInvitation(
  code: string,
  token: string,
  fetchImpl: Fetch = fetch,
): Promise<{ returnPath: string }> {
  let response: Response;
  try {
    response = await backendFetch(fetchImpl, `${API_URL}/invitations/${encodeURIComponent(code)}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ termsAccepted: true, termsVersion: TERMS_VERSION }),
    });
  } catch {
    throw new Error(INVITE_UNAVAILABLE);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || INVITE_UNAVAILABLE);
  }
  return { returnPath: (body && typeof body.returnPath === "string" && body.returnPath) || "/manufacturer/dashboard" };
}
