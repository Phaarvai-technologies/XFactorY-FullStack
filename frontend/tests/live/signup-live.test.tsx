// Live: the real Sign-up form, Google callback page and API client against a running backend on
// :8000 with a TEST database. Clerk's browser SDK is simulated (account created, email code
// accepted); the session tokens are real JWTs the backend verifies against its configured JWKS,
// and registration is finalized by the real backend endpoints in the real database.
// Needs LIVE_SIGNUP_TOKENS = path to {manual|google|unverified|unregistered|retry: {sub, token}}
// (backend's Clerk user lookup must know these users; "unverified" has an unverified email).
// Optional LIVE_DB_PSQL = psql connection string, to count rows directly.
// Skipped when LIVE_SIGNUP_TOKENS is not set.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const file = process.env.LIVE_SIGNUP_TOKENS;
const T: Record<string, { sub: string; token: string }> = file ? JSON.parse(readFileSync(file, "utf8")) : {};
const API = "http://localhost:8000/api/v1";

const h = vi.hoisted(() => ({
  pushed: [] as string[], replaced: [] as string[], setActive: vi.fn(), signOut: vi.fn(), removed: [] as string[],
  session: { id: "", token: "" }, signIn: {} as Record<string, unknown>, signUp: {} as Record<string, unknown>,
  search: new URLSearchParams(),
}));
vi.mock("@clerk/nextjs/legacy", () => ({
  useSignIn: () => ({ isLoaded: true, signIn: h.signIn, setActive: h.setActive }),
  useSignUp: () => ({ isLoaded: true, signUp: h.signUp, setActive: h.setActive }),
}));
vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({
    client: { sessions: [{ id: h.session.id, getToken: async () => h.session.token,
                          lastActiveToken: { getRawString: () => h.session.token },
                          remove: async () => { h.removed.push(h.session.id); } }] },
    session: null,
    signOut: (...a: unknown[]) => h.signOut(...a),
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (p: string) => h.pushed.push(p), replace: (p: string) => h.replaced.push(p), refresh: () => undefined }),
  useSearchParams: () => h.search,
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import { CustomSignInForm } from "@/components/auth/CustomSignInForm";
import { CustomSignUpForm, EMAIL_EXISTS } from "@/components/auth/CustomSignUpForm";
import SsoCallbackPage from "@/app/sso-callback/page";
import { TERMS_VERSION } from "@/lib/auth/registration";

const api = (path: string, token: string, init: RequestInit = {}) =>
  fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });

function rows(sub: string): number | null {
  const db = process.env.LIVE_DB_PSQL;
  if (!db) return null;
  return Number(execFileSync("psql", [db, "-Atc", `SELECT count(*) FROM users WHERE clerk_user_id = '${sub.replace(/'/g, "")}'`]).toString().trim());
}

async function settle(text: string) {
  for (let i = 0; i < 150 && screen.queryByText(text); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
  }
}

/** Manual Sign-up with the real form; Clerk "creates" the account whose session token is real. */
async function manualSignUp(account: string, redirectTo: string) {
  h.session = { id: `sess_${T[account].sub}`, token: T[account].token };
  h.signUp.create = vi.fn(async () => ({}));
  h.signUp.prepareEmailAddressVerification = vi.fn(async () => ({}));
  h.signUp.attemptEmailAddressVerification = vi.fn(async () => ({ status: "complete", createdSessionId: h.session.id }));
  render(<CustomSignUpForm redirectTo={redirectTo} />);
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Live Person" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: `${T[account].sub}@example.com` } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long-password-1" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "long-password-1" } });
  fireEvent.click(screen.getByLabelText("I agree to the Terms of Service and Privacy Policy."));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create account" })));
  await screen.findByLabelText("Verification code");
  fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "424242" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Verify email" })));
  await settle("Verifying...");
  await waitFor(() => expect(h.replaced.length + (screen.queryByRole("alert") ? 1 : 0) + h.removed.length + h.signOut.mock.calls.length).toBeGreaterThan(0), { timeout: 15000 });
}

describe.skipIf(!file)("Sign-up → signed in → dashboard (live backend + database)", () => {
  beforeEach(() => {
    cleanup();
    h.pushed = []; h.replaced = []; h.setActive = vi.fn(async () => undefined); h.signOut = vi.fn(async () => undefined); h.removed = [];
    h.signIn = {}; h.signUp = {}; h.search = new URLSearchParams();
    window.sessionStorage.clear();
  });

  it("manual Sign-up: registration finalized by the backend, then session activated and dashboard opened", async () => {
    expect(await (await api("/identity/registration", T.manual.token)).json()).toEqual({ registered: false });
    await manualSignUp("manual", "/manufacturer/dashboard");
    expect(h.setActive).toHaveBeenCalledWith({ session: `sess_${T.manual.sub}` });
    expect(h.signOut).not.toHaveBeenCalled();
    expect(h.replaced).toEqual(["/manufacturer/dashboard"]);
    // The same session now has application access (what the dashboard and proxy check).
    expect(await (await api("/identity/registration", T.manual.token)).json()).toEqual({ registered: true });
    expect((await api("/identity/me", T.manual.token)).status).toBe(200);
    expect((await api("/manufacturer/bootstrap", T.manual.token)).status).toBe(200);
    if (rows(T.manual.sub) !== null) expect(rows(T.manual.sub)).toBe(1);
  });

  it("repeating the completion (retry / second callback) is idempotent: one user, alreadyRegistered", async () => {
    const flow = await (await fetch(`${API}/identity/registration/flows`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "manual", returnPath: "/", termsAccepted: true, termsVersion: TERMS_VERSION }),
    })).json();
    const again = await api("/identity/registration/complete", T.manual.token, { method: "POST", body: JSON.stringify({ flowToken: flow.flowToken }) });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ registered: true, alreadyRegistered: true });
    if (rows(T.manual.sub) !== null) expect(rows(T.manual.sub)).toBe(1);
  });

  it("Google Sign-up: callback finalizes with the server-issued token, then activates and opens the dashboard", async () => {
    const flow = await (await fetch(`${API}/identity/registration/flows`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "google", returnPath: "/manufacturer/dashboard", termsAccepted: true, termsVersion: TERMS_VERSION }),
    })).json();
    window.sessionStorage.setItem("xy-oauth-intent", JSON.stringify({ purpose: "sign-up", returnPath: "/manufacturer/dashboard", flowToken: flow.flowToken }));
    h.session = { id: `sess_${T.google.sub}`, token: T.google.token };
    h.signUp = { status: "complete", createdSessionId: h.session.id, verifications: { externalAccount: { status: "verified" } } };
    await act(async () => { render(<SsoCallbackPage />); });
    await waitFor(() => expect(h.replaced.length).toBeGreaterThan(0), { timeout: 15000 });
    expect(h.setActive).toHaveBeenCalledWith({ session: h.session.id });
    expect(h.replaced).toEqual(["/manufacturer/dashboard"]);
    expect(await (await api("/identity/registration", T.google.token)).json()).toEqual({ registered: true });
    if (rows(T.google.sub) !== null) expect(rows(T.google.sub)).toBe(1);
  });

  it("Google flow token cannot be used twice (repeated callback creates nothing new)", async () => {
    const flow = await (await fetch(`${API}/identity/registration/flows`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "google", returnPath: "/", termsAccepted: true, termsVersion: TERMS_VERSION }),
    })).json();
    const first = await api("/identity/registration/complete", T.google.token, { method: "POST", body: JSON.stringify({ flowToken: flow.flowToken }) });
    const second = await api("/identity/registration/complete", T.google.token, { method: "POST", body: JSON.stringify({ flowToken: flow.flowToken }) });
    expect(first.status).toBe(200);
    expect([200, 400, 409]).toContain(second.status); // already registered or flow_used: never a second user
    if (rows(T.google.sub) !== null) expect(rows(T.google.sub)).toBe(1);
  });

  it("unverified email: backend refuses to finalize → no session activated, no dashboard, not registered", async () => {
    await manualSignUp("unverified", "/manufacturer/dashboard");
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.replaced).toEqual([]);
    expect(h.pushed).toEqual([]);
    expect(await (await api("/identity/registration", T.unverified.token)).json()).toEqual({ registered: false });
    expect((await api("/manufacturer/bootstrap", T.unverified.token)).status).toBe(403);
  });

  it("Terms not accepted: the backend will not issue a sign-up token", async () => {
    for (const body of [{ method: "manual", returnPath: "/" }, { method: "google", returnPath: "/", termsAccepted: false, termsVersion: TERMS_VERSION }]) {
      const res = await fetch(`${API}/identity/registration/flows`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });

  it("an account that never completed Sign-up is still blocked at Sign-in and sent to Sign-up", async () => {
    h.session = { id: `sess_${T.unregistered.sub}`, token: T.unregistered.token };
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: h.session.id }));
    render(<CustomSignInForm redirectTo="/manufacturer/dashboard" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: `${T.unregistered.sub}@example.com` } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign in" })); });
    await waitFor(() => expect(h.replaced.length).toBeGreaterThan(0), { timeout: 15000 });
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.removed).toEqual([h.session.id]);
    expect(h.signOut).not.toHaveBeenCalled(); // ended without Clerk's sign-out redirect
    expect(h.replaced[0]).toMatch(/^\/sign-up\?notice=signup_required/);
    expect((await api("/manufacturer/bootstrap", T.unregistered.token)).status).toBe(403);
  });

  it("the newly registered account signs in normally afterwards", async () => {
    h.session = { id: `sess_${T.manual.sub}_2`, token: T.manual.token };
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: h.session.id }));
    render(<CustomSignInForm redirectTo="/manufacturer/dashboard" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: `${T.manual.sub}@example.com` } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign in" })); });
    await waitFor(() => expect(h.pushed.length).toBeGreaterThan(0), { timeout: 15000 });
    expect(h.setActive).toHaveBeenCalledWith({ session: h.session.id });
    expect(h.pushed).toEqual(["/manufacturer/dashboard"]);
  });

  it("signing up again with an already registered email stays on Sign-up and says it already exists", async () => {
    h.session = { id: `sess_${T.manual.sub}_again`, token: T.manual.token };
    h.signUp.create = vi.fn(async () => {
      throw { errors: [{ code: "form_identifier_exists", longMessage: "That email address is taken. Please try another.",
                         meta: { paramName: "email_address" } }] };
    });
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: h.session.id }));
    render(<CustomSignUpForm redirectTo="/manufacturer/dashboard" />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Live Person" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: `${T.manual.sub}@example.com` } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long-password-1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "long-password-1" } });
    fireEvent.click(screen.getByLabelText("I agree to the Terms of Service and Privacy Policy."));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create account" })));
    await screen.findByText(EMAIL_EXISTS, undefined, { timeout: 15000 });
    expect(h.removed).toEqual([h.session.id]);  // temporary session ended without leaving the page
    expect(h.signOut).not.toHaveBeenCalled();
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.replaced).toEqual([]);
    expect(h.pushed).toEqual([]);
    if (rows(T.manual.sub) !== null) expect(rows(T.manual.sub)).toBe(1); // no duplicate account
  });
});
