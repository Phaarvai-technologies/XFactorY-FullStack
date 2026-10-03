/**
 * Admin email + password session (the "Admin account" sign-in).
 *
 * Kept in sessionStorage: it lives only in this browser tab and disappears when the
 * tab or browser is closed. The backend also ends it after 60 minutes idle / 12 hours,
 * on logout, on a password change or when the admin is suspended.
 * Clerk sign-ins do not use this: Clerk keeps its own session.
 */
const KEY = "xy_admin_session";

export type AdminSession = { token: string; expiresAt: string };

// Fallback when sessionStorage is unavailable (storage blocked by the browser).
let memory: AdminSession | null = null;

export function readAdminSession(): AdminSession | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AdminSession;
    if (!s.token || new Date(s.expiresAt).getTime() <= Date.now()) {
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function saveAdminSession(session: AdminSession): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* storage blocked: the session then lasts until the page is reloaded */
  }
  memory = session;
}

export function clearAdminSession(): void {
  memory = null;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function currentAdminToken(): string | null {
  return readAdminSession()?.token ?? (memory && new Date(memory.expiresAt).getTime() > Date.now() ? memory.token : null);
}
