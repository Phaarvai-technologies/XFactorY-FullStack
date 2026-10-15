/**
 * Working with a Clerk session that a sign-in / sign-up just created, BEFORE it becomes the
 * browser's active session. The X!Y backend is asked first (registration check / completion)
 * with that session's own token, so an unregistered identity is never given an active app
 * session, not even for a moment. Clerk keeps the new session in `clerk.client.sessions`;
 * if it is not listed there (unexpected), the session is activated as a fallback and the
 * caller signs it out again when access is not allowed.
 */

import { authPageHref } from "@/lib/auth/registration";

type SessionLike = {
  id: string;
  getToken: (options?: { skipCache?: boolean }) => Promise<string | null>;
  /** The token Clerk returned when it created the session (no request, no Clerk events). */
  lastActiveToken?: { getRawString: () => string } | null;
  /** Ends this session on Clerk's side without touching the browser's active session or page. */
  remove?: () => Promise<unknown>;
};

export type ClerkLike = {
  client?: { sessions?: SessionLike[] } | null;
  session?: SessionLike | null;
  signOut: (options?: { sessionId?: string; redirectUrl?: string }) => Promise<unknown>;
};

type SetActive = (params: { session: string }) => Promise<unknown>;

/** Seconds until a JWT expires (-1 when it cannot be read). */
function secondsLeft(jwt: string): number {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp - Date.now() / 1000 : -1;
  } catch {
    return -1;
  }
}

/**
 * The token of a session that is NOT active yet. Clerk's session.getToken() announces every
 * token it fetches as the browser's current one: Clerk then writes it into the __session
 * cookie and marks the browser signed in (__client_uat), although the session was never
 * activated. If X!Y then ends that session (already registered, not registered), those cookies
 * stay behind until the token expires, the server treats the browser as signed in while Clerk
 * in the page knows it is not, and Sign-in / Sign-up redirect back and forth (a hard refresh
 * cleared it). So the token Clerk returned when it created the session is used as is - no
 * request, no event, no cookie - and getToken() only when that token is missing or nearly expired.
 */
export async function tokenForCreatedSession(
  clerk: ClerkLike,
  setActive: SetActive,
  sessionId: string,
): Promise<{ token: string | null; activated: boolean }> {
  const created = clerk.client?.sessions?.find((s) => s.id === sessionId);
  if (created) {
    try {
      const issued = created.lastActiveToken?.getRawString?.() || "";
      if (issued && secondsLeft(issued) > 15) return { token: issued, activated: false };
    } catch {
      // Fall through to fetching one.
    }
    try {
      return { token: await created.getToken({ skipCache: true }), activated: false };
    } catch {
      // Fall through to activation.
    }
  }
  await setActive({ session: sessionId });
  try {
    return { token: (await clerk.session?.getToken({ skipCache: true })) ?? null, activated: true };
  } catch {
    return { token: null, activated: true };
  }
}

/**
 * After the backend has CONFIRMED the X!Y registration: make the session the browser's active
 * session and return where to go (the safe dashboard path). If Clerk cannot activate it, the
 * registration still stands, so the session is ended and the user is sent to Sign-in with
 * "Your account is ready" instead of being left half signed in.
 */
export async function activateRegisteredSession(
  clerk: ClerkLike,
  setActive: SetActive,
  sessionId: string,
  activated: boolean,
  destination: string,
): Promise<string> {
  try {
    if (!activated) await setActive({ session: sessionId });
    return destination;
  } catch {
    await endSession(clerk, sessionId);
    return authPageHref("/sign-in", destination, "registered");
  }
}

/**
 * Ends the session (active or not) WITHOUT leaving the current page. Never throws: callers are
 * already on an error path and decide themselves what to show or where to go next.
 *
 * Clerk's signOut() always navigates when the session is the only signed-in one (the normal
 * case during Sign-in / Sign-up): it goes to the "after sign-out" URL, the home page. That took
 * users out of Sign-up, e.g. when the email already had an account. So:
 *  - a session created by this sign-in / sign-up but never activated is removed directly
 *    (session.remove(): no navigation, the browser was never signed in with it);
 *  - the browser's active session is signed out with this same page as the destination.
 */
export async function endSession(clerk: ClerkLike, sessionId?: string | null): Promise<void> {
  const activeId = clerk.session?.id ?? null;
  const target = sessionId ?? activeId;
  const here = typeof window === "undefined" ? undefined : `${window.location.pathname}${window.location.search}`;
  try {
    const created = target ? clerk.client?.sessions?.find((s) => s.id === target) : undefined;
    if (target && target !== activeId && created?.remove) {
      await created.remove();
      return;
    }
  } catch {
    // Could not remove it directly: sign it out below instead.
  }
  try {
    await clerk.signOut({ ...(sessionId ? { sessionId } : {}), ...(here ? { redirectUrl: here } : {}) });
  } catch {
    // Ignore: the backend still refuses an unregistered session.
  }
}
