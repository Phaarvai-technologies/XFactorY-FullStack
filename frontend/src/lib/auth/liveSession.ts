import "server-only";
import { clerkClient } from "@clerk/nextjs/server";

/**
 * Whether the session behind this request's Clerk cookie is still an active session, asked of
 * Clerk's backend API. The cookie alone is not proof: a session token stays valid for about a
 * minute after its session was ended (e.g. a Sign-up attempt with an email that already has an
 * account), and on in-app navigations Clerk does not re-check it. Sign-in / Sign-up only send a
 * visitor away as "already signed in" when this returns true. null = could not check (Clerk
 * unreachable): callers show the form instead of redirecting, so an outage never loops.
 */
export async function sessionIsLive(sessionId: string | null | undefined): Promise<boolean | null> {
  if (!sessionId) return false;
  try {
    const client = await clerkClient();
    const session = await client.sessions.getSession(sessionId);
    return session.status === "active";
  } catch {
    return null;
  }
}
