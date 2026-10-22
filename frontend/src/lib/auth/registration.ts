/**
 * X!Y registration (completed Sign-up) is separate from Clerk authentication.
 *
 * A Clerk session proves who someone is; only the backend knows whether that person
 * completed X!Y sign-up (users.registration_completed_at). Every check here asks the backend
 * and maps its answer to one of four states. Only an explicit "not registered" answer ever
 * leads to "Please sign up first": a network / server failure is `error` (retry), never
 * `unregistered`.
 *
 * Works in the browser, in server components and in the proxy (plain fetch, no Clerk import).
 */

import { withBase } from "@/lib/basePath";

export const SIGN_UP_FIRST_MESSAGE = "Please sign up first, then sign in to continue.";

/** Sign-up (manual or Google) with an account that is already registered. */
export const ACCOUNT_EXISTS_MESSAGE = "You already have an account. Please sign in.";

/**
 * Version of the Terms of Service + Privacy Policy shown on the Sign-up page
 * ("Terms v1.2 · Privacy Policy v1.4"). Sent with the user's explicit acceptance; the backend
 * refuses registration for any other version (setting TERMS_VERSION there must match).
 */
export const TERMS_VERSION = "terms-1.2;privacy-1.4";

/** Thrown by startSignUpFlow: `message` is safe to show (fixed text from the backend or ours). */
export class SignUpFlowError extends Error {
  constructor(message: string, public code: string | null) {
    super(message);
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export type RegistrationCheck =
  | { state: "registered" }
  | { state: "unregistered" }
  | { state: "blocked"; message: string; code?: "identity_mismatch" }
  | { state: "error"; message: string };

type Fetch = typeof fetch;

/** Every request to the X!Y backend gives up after this long: an answer or an error, never an
 * endless "Creating account…" / "Signing you in…". */
const REQUEST_TIMEOUT_MS = 15000;

function timeoutSignal(signal?: AbortSignal): AbortSignal | undefined {
  if (signal) return signal;
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
}

function detailText(payload: unknown, fallback: string): string {
  const detail = (payload as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") {
    return (detail as { message: string }).message;
  }
  return fallback;
}

function detailCode(payload: unknown): string | null {
  const p = payload as { code?: unknown; detail?: { code?: unknown } } | null;
  if (typeof p?.code === "string") return p.code;
  if (p?.detail && typeof p.detail === "object" && typeof p.detail.code === "string") return p.detail.code;
  return null;
}

const UNAVAILABLE = "We couldn't confirm your account right now. Please try again.";

/** GET /identity/registration with a Clerk session token. */
export async function checkRegistration(
  token: string | null | undefined,
  options: { fetchImpl?: Fetch; signal?: AbortSignal } = {},
): Promise<RegistrationCheck> {
  if (!token) return { state: "error", message: UNAVAILABLE };
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${API_URL}/identity/registration`, {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
      signal: timeoutSignal(options.signal),
    });
  } catch {
    return { state: "error", message: UNAVAILABLE };
  }
  const payload = await response.json().catch(() => null);
  if (response.ok) {
    const registered = (payload as { registered?: unknown } | null)?.registered;
    if (registered === true) return { state: "registered" };
    if (registered === false) return { state: "unregistered" };
    return { state: "error", message: UNAVAILABLE };
  }
  if (response.status === 403 && detailCode(payload) === "registration_required") return { state: "unregistered" };
  if (response.status === 403) return { state: "blocked", message: detailText(payload, "Access denied.") };
  // The email belongs to an existing X!Y account under a different sign-in: never "sign up".
  if (response.status === 409 && detailCode(payload) === "identity_mismatch") {
    return { state: "blocked", message: detailText(payload, UNAVAILABLE), code: "identity_mismatch" };
  }
  // 401 (token not accepted, e.g. a Clerk configuration mismatch), 5xx, anything else: retry.
  return { state: "error", message: UNAVAILABLE };
}

const START_FAILED = "We couldn't start creating your account right now. Please try again.";

/**
 * Sign-up page: a short-lived, server-signed token marking this attempt as an explicit sign-up
 * in which the user ticked the Terms checkbox. The backend refuses it without acceptance.
 */
export async function startSignUpFlow(
  method: "manual" | "google",
  returnPath: string,
  termsAccepted: boolean,
  fetchImpl: Fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(`${API_URL}/identity/registration/flows`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, returnPath, termsAccepted, termsVersion: TERMS_VERSION }),
      signal: timeoutSignal(),
    });
  } catch {
    throw new SignUpFlowError(START_FAILED, null);
  }
  const payload = await response.json().catch(() => null);
  const token = (payload as { flowToken?: unknown } | null)?.flowToken;
  if (response.ok && typeof token === "string") return token;
  const code = detailCode(payload);
  // 4xx about the Terms: the backend's fixed message. Anything else: retry message.
  if (code === "terms_required" || code === "terms_outdated") throw new SignUpFlowError(detailText(payload, START_FAILED), code);
  throw new SignUpFlowError(START_FAILED, code);
}

export type CompletionResult =
  | { ok: true; alreadyRegistered: boolean }
  | { ok: false; code: string | null; message: string; retryable: boolean };

/** POST /identity/registration/complete (idempotent on the backend). */
export async function completeRegistration(
  token: string | null | undefined,
  flowToken: string,
  fetchImpl: Fetch = fetch,
): Promise<CompletionResult> {
  const failed = "We couldn't finish creating your account. Please try again.";
  if (!token) return { ok: false, code: null, message: failed, retryable: true };
  let response: Response;
  try {
    response = await fetchImpl(`${API_URL}/identity/registration/complete`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ flowToken }),
      signal: timeoutSignal(),
    });
  } catch {
    return { ok: false, code: null, message: failed, retryable: true };
  }
  const payload = await response.json().catch(() => null);
  if (response.ok && (payload as { registered?: unknown } | null)?.registered === true) {
    return { ok: true, alreadyRegistered: Boolean((payload as { alreadyRegistered?: unknown }).alreadyRegistered) };
  }
  const code = detailCode(payload);
  const retryable = response.status === 401 || response.status >= 500 || code === "flow_expired";
  return { ok: false, code, message: retryable ? failed : detailText(payload, failed), retryable };
}

/**
 * Sign-up page, after Clerk said the email already has an account: is it a REGISTERED X!Y
 * account? "registered" → "You already have an account. Please sign in." at once (no Clerk
 * sign-in, no code e-mailed, nothing written). "not_registered" → a Clerk identity that never
 * finished X!Y sign-up (the entered password then proves it and registration completes).
 * "unknown" (server unreachable) → callers fall back to the password check.
 */
export async function accountStatusForEmail(
  email: string,
  fetchImpl: Fetch = fetch,
): Promise<"registered" | "not_registered" | "unknown"> {
  try {
    const response = await fetchImpl(`${API_URL}/identity/registration/account-status`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      signal: timeoutSignal(),
    });
    if (!response.ok) return "unknown";
    const registered = ((await response.json().catch(() => null)) as { registered?: unknown } | null)?.registered;
    return registered === true ? "registered" : registered === false ? "not_registered" : "unknown";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Fixed messages shown on the sign-in / sign-up pages, selected by ?notice=<code>.
// (Codes only: no text is ever taken from the URL.)

export type NoticeCode =
  | "signup_required"
  | "registered"
  | "unavailable"
  | "signup_failed"
  | "oauth_failed"
  | "suspended"
  | "account_mismatch"
  | "account_exists";

/** `action: "sign-in"`: the page shows a Sign-in link next to the message. */
export type Notice = { tone: "error" | "warn" | "ok"; message: string; action?: "sign-in" };

export const NOTICES: Record<NoticeCode, Notice> = {
  signup_required: { tone: "warn", message: SIGN_UP_FIRST_MESSAGE },
  registered: { tone: "ok", message: "Your account is ready. Please sign in to continue." },
  unavailable: { tone: "error", message: UNAVAILABLE },
  signup_failed: { tone: "error", message: "We couldn't finish creating your account. Please try again." },
  oauth_failed: { tone: "error", message: "Google sign-in didn't complete. Please try again." },
  suspended: { tone: "error", message: "This account has been suspended. Please contact X!Y support." },
  account_mismatch: {
    tone: "error",
    message: "This email is linked to an existing X!Y account that uses a different sign-in. Please contact X!Y support - do not create a new account.",
  },
  account_exists: { tone: "warn", message: ACCOUNT_EXISTS_MESSAGE, action: "sign-in" },
};

export function noticeFor(value: string | null | undefined): Notice | null {
  return value && value in NOTICES ? NOTICES[value as NoticeCode] : null;
}

/** "/sign-up?notice=signup_required&redirect_url=%2Fx" (router / <Link> add the base path). */
export function authPageHref(
  page: "/sign-in" | "/sign-up",
  returnTo: string | null | undefined,
  notice?: NoticeCode,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams();
  if (notice) params.set("notice", notice);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  if (returnTo && returnTo !== "/") params.set("redirect_url", returnTo);
  const query = params.toString();
  return query ? `${page}?${query}` : page;
}

// ---------------------------------------------------------------------------
// Google redirect: what the user started. It travels in the callback address Clerk returns to
// (?intent=…&flow=…&redirect_url=…) and, as before, in this tab's sessionStorage, so it
// survives the round trip to Google even when one of the two is lost. Only used to choose
// which Clerk resource to finish. It grants nothing: completing registration needs the
// server-signed sign-up token, which the backend verifies, and a missing / unreadable intent is
// always treated as a sign-in.

const INTENT_KEY = "xy-oauth-intent";

export type OAuthIntent = { purpose: "sign-in"; returnPath: string } | { purpose: "sign-up"; returnPath: string; flowToken: string };

export function rememberOAuthIntent(intent: OAuthIntent): void {
  try {
    window.sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
  } catch {
    // Storage blocked: the callback then treats the attempt as a sign-in (safe default).
  }
}

function readIntent(value: { purpose?: unknown; returnPath?: unknown; flowToken?: unknown }): OAuthIntent {
  const returnPath = typeof value.returnPath === "string" && value.returnPath ? value.returnPath : "/";
  if (value.purpose === "sign-up" && typeof value.flowToken === "string" && value.flowToken) {
    return { purpose: "sign-up", returnPath, flowToken: value.flowToken };
  }
  return { purpose: "sign-in", returnPath };
}

/**
 * The intent of this callback: from the callback address when Clerk kept it, else from this
 * tab's storage (always cleared, so a repeated callback cannot reuse it), else null (sign-in).
 */
export function takeOAuthIntent(search?: URLSearchParams | null): OAuthIntent | null {
  let stored: OAuthIntent | null = null;
  try {
    const raw = window.sessionStorage.getItem(INTENT_KEY);
    window.sessionStorage.removeItem(INTENT_KEY);
    if (raw) stored = readIntent(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    stored = null;
  }
  const purpose = search?.get("intent");
  if (purpose === "sign-in" || purpose === "sign-up") {
    return readIntent({ purpose, returnPath: search?.get("redirect_url"), flowToken: search?.get("flow") });
  }
  return stored;
}

/**
 * The FULL address Clerk sends the browser back to after Google, carrying the intent.
 *
 * In production clerk-js passes a redirect URL to Clerk's servers unchanged (only development
 * instances turn a path into a full address), so a bare path such as "/sso-callback" was
 * resolved by Clerk instead of by the browser - not on this site, or not under the website's
 * /projects/xfactory prefix. Google sign-in then never came back to this app's callback.
 */
export function oauthCallbackUrl(intent: OAuthIntent): string {
  const params = new URLSearchParams({ intent: intent.purpose });
  if (intent.returnPath && intent.returnPath !== "/") params.set("redirect_url", intent.returnPath);
  if (intent.purpose === "sign-up") params.set("flow", intent.flowToken);
  return `${window.location.origin}${withBase("/sso-callback")}?${params.toString()}`;
}
