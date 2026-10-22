/** The backend answers mapped by the registration client and the shared API client. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/lib/api";
import { authPageHref, checkRegistration, noticeFor, takeOAuthIntent } from "@/lib/auth/registration";

const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("checkRegistration", () => {
  it.each([
    ["registered", json(200, { registered: true }), "registered"],
    ["not registered", json(200, { registered: false }), "unregistered"],
    ["registration_required", json(403, { detail: "x", code: "registration_required" }), "unregistered"],
    ["suspended", json(403, { detail: "This account has been suspended." }), "blocked"],
    ["database down (500)", json(500, { detail: "db" }), "error"],
    ["gateway 502 HTML", async () => new Response("<html>", { status: 502 }), "error"],
    ["network failure", async () => { throw new TypeError("Failed to fetch"); }, "error"],
    ["odd 200 body", json(200, {}), "error"],
    ["token rejected (401, e.g. Clerk config mismatch)", json(401, { detail: "Invalid Clerk token" }), "error"],
    ["account under another sign-in (409)", json(409, { detail: { code: "identity_mismatch", message: "x" } }), "blocked"],
    ["clerk unreachable (503)", json(503, { detail: "Unable to reach Clerk right now." }), "error"],
  ])("%s → %s", async (_label, fetchImpl, state) => {
    expect((await checkRegistration("t", { fetchImpl: fetchImpl as typeof fetch })).state).toBe(state);
  });

  it("no token is an error, not 'unregistered'", async () => {
    expect((await checkRegistration(null)).state).toBe("error");
  });
});

describe("notices and intent", () => {
  it("only known notice codes produce text", () => {
    expect(noticeFor("signup_required")?.message).toBe(
      "Please sign up first, then sign in to continue.",
    );
    expect(noticeFor("<script>")).toBeNull();
    expect(authPageHref("/sign-up", "/", "signup_required")).toBe("/sign-up?notice=signup_required");
  });

  it("a stored 'sign-up' without a token is read as sign-in", () => {
    window.sessionStorage.setItem("xy-oauth-intent", JSON.stringify({ purpose: "sign-up", returnPath: "/x" }));
    expect(takeOAuthIntent()).toEqual({ purpose: "sign-in", returnPath: "/x" });
    expect(window.sessionStorage.getItem("xy-oauth-intent")).toBeNull(); // single use
  });
});

describe("api() and registration_required", () => {
  it("ends the session and goes to Sign-up only for the explicit answer", async () => {
    const signOut = vi.fn(async () => undefined);
    const assign = vi.fn();
    vi.stubGlobal("Clerk", { signOut });
    const location = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...location, assign, pathname: "/onboarding/roles", search: "" } });
    try {
      vi.stubGlobal("fetch", json(403, { detail: "This account has been suspended." }));
      await expect(api("/identity/me", "t")).rejects.toMatchObject({ status: 403, code: null });
      expect(signOut).not.toHaveBeenCalled();

      vi.stubGlobal("fetch", json(500, { detail: "db" }));
      await expect(api("/identity/me", "t")).rejects.toBeInstanceOf(ApiError);
      expect(signOut).not.toHaveBeenCalled();

      vi.stubGlobal("fetch", json(403, { detail: "Please sign up first, then sign in to continue.", code: "registration_required" }));
      await expect(api("/identity/me", "t")).rejects.toMatchObject({ status: 403, code: "registration_required" });
      await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/sign-up?notice=signup_required&redirect_url=%2Fonboarding%2Froles"));
      expect(signOut).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: location });
    }
  });
});
