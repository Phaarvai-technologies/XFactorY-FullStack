/**
 * Working with a Clerk session that a sign-in / sign-up just created, BEFORE it becomes the
 * browser's active session. The X!Y backend is asked first (registration check / completion)
 * with that session's own token, so an unregistered identity is never given an active app
 * session, not even for a moment. Clerk keeps the new session in `clerk.client.sessions`;
 * if it is not listed there (unexpected), the session is activated as a fallback and the
 * caller signs it out again when access is not allowed.
 */

type SessionLike = { id: string; getToken: (options?: { skipCache?: boolean }) => Promise<string | null> };

export type ClerkLike = {
  client?: { sessions?: SessionLike[] } | null;
  session?: SessionLike | null;
  signOut: (options?: { sessionId?: string; redirectUrl?: string }) => Promise<unknown>;
};

type SetActive = (params: { session: string }) => Promise<unknown>;

export async function tokenForCreatedSession(
  clerk: ClerkLike,
  setActive: SetActive,
  sessionId: string,
): Promise<{ token: string | null; activated: boolean }> {
  const created = clerk.client?.sessions?.find((s) => s.id === sessionId);
  if (created) {
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

/** Ends the session (active or not). Never throws: callers are already on an error path. */
export async function endSession(clerk: ClerkLike, sessionId?: string | null): Promise<void> {
  try {
    await clerk.signOut(sessionId ? { sessionId } : undefined);
  } catch {
    // Ignore: the backend still refuses an unregistered session.
  }
}
