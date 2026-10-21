/**
 * Production "Continue with Google": Clerk must get the FULL callback address. In production
 * clerk-js passes the redirect URL to Clerk's servers unchanged, so a bare path such as
 * "/projects/xfactory/sso-callback" was not resolved against this site. The address also carries
 * the intent (sign-in / sign-up + the server-signed sign-up token). And an auth page is never a
 * post-sign-in destination (no Sign-in ↔ Sign-up ↔ dashboard loops).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(base: string) {
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", base);
  vi.resetModules();
  return {
    reg: await import("@/lib/auth/registration"),
    safe: (await import("@/lib/auth/safeRedirect")).safeRedirectPath,
  };
}

const ORIGIN = "http://localhost:3000";

describe.each(["", "/projects/xfactory"])("Google callback address (base path '%s')", (base) => {
  it("is absolute, on this site, under the base path, with the intent", async () => {
    const { reg } = await load(base);
    const signIn = new URL(reg.oauthCallbackUrl({ purpose: "sign-in", returnPath: "/manufacturer/dashboard" }));
    expect(signIn.origin).toBe(ORIGIN);
    expect(signIn.pathname).toBe(`${base}/sso-callback`);
    expect(Object.fromEntries(signIn.searchParams)).toEqual({ intent: "sign-in", redirect_url: "/manufacturer/dashboard" });
    const signUp = new URL(reg.oauthCallbackUrl({ purpose: "sign-up", returnPath: "/", flowToken: "tok.sig" }));
    expect(Object.fromEntries(signUp.searchParams)).toEqual({ intent: "sign-up", flow: "tok.sig" });
    // the callback reads it back (and a "sign-up" without a token stays a sign-in)
    expect(reg.takeOAuthIntent(signUp.searchParams)).toEqual({ purpose: "sign-up", returnPath: "/", flowToken: "tok.sig" });
    expect(reg.takeOAuthIntent(new URLSearchParams("intent=sign-up"))).toEqual({ purpose: "sign-in", returnPath: "/" });
  });

  it("Sign-in / Sign-up / the callback are never where a signed-in user is sent", async () => {
    const { safe } = await load(base);
    for (const page of ["/sign-in", "/sign-up?notice=signup_required", "/sso-callback", "/sign-in/factor-two"]) {
      expect(safe(`${ORIGIN}${base}${page}`, ORIGIN)).toBeNull();
      expect(safe(page, ORIGIN)).toBeNull();
    }
    expect(safe("/sign-inside", ORIGIN)).toBe("/sign-inside");
    expect(safe(`${ORIGIN}${base}/manufacturer/account`, ORIGIN)).toBe("/manufacturer/account");
  });
});
