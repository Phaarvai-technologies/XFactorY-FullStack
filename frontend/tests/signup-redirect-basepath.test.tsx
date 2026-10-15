/**
 * After Sign-up the user is sent to the dashboard they came for. Under the /xfactory base path
 * Clerk hands back full addresses (".../xfactory/manufacturer/dashboard"); the app strips the
 * base (Next's router adds it again) and refuses anything off-site. Same for the fallback
 * "account is ready" Sign-in link when the session cannot be activated.
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
    safe: (await import("@/lib/auth/safeRedirect")).safeRedirectPath,
    activate: (await import("@/lib/auth/clerkSession")).activateRegisteredSession,
    withBase: (await import("@/lib/basePath")).withBase,
  };
}

const ORIGIN = "http://localhost:3000";

describe.each(["", "/xfactory"])("post-sign-up destination (base path '%s')", (base) => {
  it("dashboard address from Clerk → router path; Next adds the base back", async () => {
    const { safe, withBase } = await load(base);
    const target = safe(`${ORIGIN}${base}/manufacturer/dashboard?tab=1`, ORIGIN);
    expect(target).toBe("/manufacturer/dashboard?tab=1");
    expect(withBase(target!)).toBe(`${base}/manufacturer/dashboard?tab=1`);
    expect(safe("/visionaries/flow", ORIGIN)).toBe("/visionaries/flow");
  });

  it.each(["https://evil.example/x", "//evil.example", "/\\evil.example", "javascript:alert(1)"])(
    "off-site redirect %s is refused (falls back to the default)", async (bad) => {
      const { safe } = await load(base);
      expect(safe(bad, ORIGIN)).toBeNull();
    });

  it("activation → dashboard; activation failure → Sign-in notice, session ended", async () => {
    const { activate, withBase } = await load(base);
    const signOut = vi.fn(async () => undefined);
    const ok = vi.fn(async () => undefined);
    expect(await activate({ signOut }, ok, "sess_1", false, "/manufacturer/dashboard")).toBe("/manufacturer/dashboard");
    expect(ok).toHaveBeenCalledWith({ session: "sess_1" });
    const already = vi.fn(async () => undefined);
    expect(await activate({ signOut }, already, "sess_2", true, "/")).toBe("/");
    expect(already).not.toHaveBeenCalled();
    const broken = vi.fn(async () => { throw new Error("x"); });
    const removed: string[] = [];
    const clerk = { signOut, client: { sessions: [{ id: "sess_3", getToken: async () => "t", remove: async () => { removed.push("sess_3"); } }] } };
    const href = await activate(clerk, broken, "sess_3", false, "/manufacturer/dashboard");
    expect(href).toBe("/sign-in?notice=registered&redirect_url=%2Fmanufacturer%2Fdashboard");
    expect(withBase(href)).toBe(`${base}/sign-in?notice=registered&redirect_url=%2Fmanufacturer%2Fdashboard`);
    expect(removed).toEqual(["sess_3"]);
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("endSession never takes the user to the home page", () => {
  it("an active session is signed out with the current page as Clerk's destination", async () => {
    const { endSession } = await import("@/lib/auth/clerkSession");
    const signOut = vi.fn(async () => undefined);
    const prev = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { location: { pathname: "/xfactory/sign-up", search: "?notice=signup_required" } };
    try {
      await endSession({ signOut, session: { id: "sess_a", getToken: async () => "t" } });
      expect(signOut).toHaveBeenCalledWith({ redirectUrl: "/xfactory/sign-up?notice=signup_required" });
    } finally {
      (globalThis as { window?: unknown }).window = prev;
    }
  });
});
