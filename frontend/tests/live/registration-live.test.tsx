// Live: the real Sign-in form, the real proxy registration gate and the real API client against a
// running backend on :8000 with a TEST database. Only Clerk's browser SDK is simulated; the
// session tokens are real JWTs the backend verifies against its configured JWKS.
// Needs LIVE_REG_TOKENS = path to a JSON file {legacy|recent|fresh|noevidence: {sub, token}}:
//   legacy     - account from before explicit registration (no marker) with sign-up evidence
//   recent     - account created after the cutoff that never completed Sign-up
//   fresh      - account that completed the new explicit Sign-up
//   noevidence - old account without database evidence while Clerk's API is unreachable
// Skipped when the variable is not set.
import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const file = process.env.LIVE_REG_TOKENS;
const T: Record<string, { sub: string; token: string }> = file ? JSON.parse(readFileSync(file, "utf8")) : {};
const API = "http://localhost:8000/api/v1";

const h = vi.hoisted(() => ({
  pushed: [] as string[], replaced: [] as string[], setActive: vi.fn(), signOut: vi.fn(), removed: [] as string[],
  session: { id: "", token: "" }, signIn: {} as Record<string, unknown>,
}));
vi.mock("@clerk/nextjs/legacy", () => ({
  useSignIn: () => ({ isLoaded: true, signIn: h.signIn, setActive: h.setActive }),
  useSignUp: () => ({ isLoaded: true, signUp: {}, setActive: h.setActive }),
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
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import { CustomSignInForm } from "@/components/auth/CustomSignInForm";

async function signIn(account: keyof typeof T, password = "correct-password") {
  h.session = { id: `sess_${T[account].sub}`, token: T[account].token };
  h.signIn.create = vi.fn(async (args: { password: string }) => {
    if (args.password !== "correct-password") {
      throw { errors: [{ code: "form_password_incorrect", longMessage: "Password is incorrect. Try again, or use another method.", meta: { paramName: "password" } }] };
    }
    return { status: "complete", createdSessionId: h.session.id };
  });
  render(<CustomSignInForm redirectTo="/manufacturer/dashboard" />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: `${T[account].sub}@example.com` } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign in" })); });
  // wait for the real request to finish (the backend may wait up to 10 s on Clerk)
  for (let i = 0; i < 150 && screen.queryByText("Signing in…"); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
  }
}

const api = (path: string, token: string) => fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });

describe.skipIf(!file)("registration regression (live backend + database)", () => {
  beforeEach(() => {
    h.pushed = []; h.replaced = []; h.setActive = vi.fn(async () => undefined); h.signOut = vi.fn(async () => undefined); h.removed = [];
  });

  it("an existing registered account (from before explicit registration) signs in and reaches the dashboard", async () => {
    await signIn("legacy");
    expect(h.replaced).toEqual([]);
    expect(h.setActive).toHaveBeenCalledWith({ session: `sess_${T.legacy.sub}` });
    expect(h.pushed).toEqual(["/manufacturer/dashboard"]);
    expect((await api("/identity/me", T.legacy.token)).status).toBe(200);
    expect((await api("/manufacturer/bootstrap", T.legacy.token)).status).toBe(200);
  });

  it("a newly registered account signs in", async () => {
    await signIn("fresh");
    expect(h.pushed).toEqual(["/manufacturer/dashboard"]);
  });

  it("a genuinely unregistered account is still sent to Sign-up, and direct API calls are refused", async () => {
    await signIn("recent");
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.replaced).toEqual(["/sign-up?notice=signup_required&redirect_url=%2Fmanufacturer%2Fdashboard"]);
    const r = await api("/manufacturer/bootstrap", T.recent.token);
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("registration_required");
  });

  it("incorrect password keeps the existing error and never reaches the registration check", async () => {
    await signIn("legacy", "wrong");
    expect(screen.getByText("Password is incorrect. Try again, or use another method.")).toBeInTheDocument();
    expect(h.replaced).toEqual([]);
  });

  it("a service failure (Clerk API unreachable) is an error, not a Sign-up redirect", async () => {
    await signIn("noevidence");
    expect(screen.getByText("We couldn't confirm your account right now. Please try again.")).toBeInTheDocument();
    expect(h.replaced).toEqual([]);
    expect(h.setActive).not.toHaveBeenCalled();
    expect((await api("/identity/registration", T.noevidence.token)).status).toBeGreaterThanOrEqual(500);
  });

  it("an invalid token is rejected as authentication, not as 'unregistered'", async () => {
    const r = await api("/identity/registration", "not-a-token");
    expect(r.status).toBe(401);
  });
});

describe.skipIf(!file)("protected pages via the real proxy (live backend)", () => {
  it("direct dashboard URL: registered passes, unregistered is redirected", async () => {
    const { serverAuth } = await import("../mocks/clerkServer");
    const { NextRequest } = await import("next/server");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_proxy");
    const proxy = (await import("@/proxy")).default;
    const go = async (who: keyof typeof T) => {
      serverAuth.userId = T[who].sub;
      serverAuth.token = T[who].token;
      return proxy(new NextRequest("http://localhost:3000/manufacturer/dashboard"), {} as never);
    };
    const ok = await go("legacy");
    expect(ok?.headers.get("location") ?? null).toBeNull();
    const blocked = (await go("recent")) as Response;
    expect(blocked.status).toBe(307);
    expect(blocked.headers.get("location")).toMatch(/^\/sign-up\?notice=signup_required/);
  });
});
