// @vitest-environment node
/**
 * Sign-up with an existing email, then Sign-in: no back-and-forth redirects.
 * Root cause covered: a session that was never activated must not end up in the browser's
 * Clerk cookies, and the auth pages must not treat a cookie whose session has ended as signed in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serverAuth } from "./mocks/clerkServer";

vi.mock("server-only", () => ({}));
const redirects: string[] = [];
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirects.push(to);
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));

let backend: "registered" | "unregistered";
let backendCalls: string[];

beforeEach(() => {
  redirects.length = 0;
  backendCalls = [];
  backend = "registered";
  serverAuth.userId = null;
  serverAuth.sessionId = null;
  serverAuth.sessionStatus = "active";
  serverAuth.sessionLookups = [];
  serverAuth.token = "cookie-token";
  vi.stubGlobal("fetch", async (url: string) => {
    backendCalls.push(String(url));
    return new Response(JSON.stringify({ registered: backend === "registered" }), { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function renderPage(which: "sign-in" | "sign-up", redirectUrl = "/manufacturer/dashboard") {
  const mod = which === "sign-in"
    ? await import("@/app/sign-in/[[...sign-in]]/page")
    : await import("@/app/sign-up/[[...sign-up]]/page");
  try {
    const el = await mod.default({ searchParams: Promise.resolve({ redirect_url: redirectUrl }) });
    return { redirected: null as string | null, el };
  } catch (e) {
    if (String(e).includes("NEXT_REDIRECT")) return { redirected: redirects[redirects.length - 1], el: null };
    throw e;
  }
}

describe("auth pages with a leftover Clerk cookie", () => {
  it.each(["sign-in", "sign-up"] as const)(
    "%s: cookie of an ENDED session (existing-email Sign-up attempt) → the form, no redirect, no backend call",
    async (which) => {
      serverAuth.userId = "user_existing";
      serverAuth.sessionId = "sess_attempt";
      serverAuth.sessionStatus = "removed";
      const { redirected, el } = await renderPage(which);
      expect(redirected).toBeNull();
      expect(el).not.toBeNull();
      expect(serverAuth.sessionLookups).toEqual(["sess_attempt"]);
      expect(backendCalls).toEqual([]); // nothing decided from a dead session's token
    },
  );

  it("the sequence repeated: Sign-up → Sign-in → Sign-up → Sign-in never redirects", async () => {
    serverAuth.userId = "user_existing";
    serverAuth.sessionId = "sess_attempt";
    serverAuth.sessionStatus = "removed";
    for (const which of ["sign-up", "sign-in", "sign-up", "sign-in"] as const) {
      vi.resetModules();
      expect((await renderPage(which)).redirected).toBeNull();
    }
    expect(redirects).toEqual([]);
  });

  it("Clerk API unreachable → the form (an outage is an error state, never a redirect loop)", async () => {
    serverAuth.userId = "user_existing";
    serverAuth.sessionStatus = "error";
    expect((await renderPage("sign-in")).redirected).toBeNull();
  });

  it("a LIVE registered session is still sent on (safe destination), as before", async () => {
    serverAuth.userId = "user_ok";
    serverAuth.sessionStatus = "active";
    expect((await renderPage("sign-in")).redirected).toBe("/manufacturer/dashboard");
    vi.resetModules();
    expect((await renderPage("sign-up")).redirected).toBe("/manufacturer/dashboard");
    vi.resetModules();
    expect((await renderPage("sign-in", "https://evil.example/x")).redirected).toBe("/");
  });

  it("under /xfactory the destination is the router path (Next adds the base)", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/xfactory");
    vi.resetModules();
    serverAuth.userId = "user_ok";
    expect((await renderPage("sign-in", "http://localhost:3000/xfactory/manufacturer/dashboard")).redirected)
      .toBe("/manufacturer/dashboard");
  });

  it("a live but unregistered session still gets the existing stale-session handling", async () => {
    serverAuth.userId = "user_unreg";
    backend = "unregistered";
    const { redirected, el } = await renderPage("sign-in");
    expect(redirected).toBeNull();
    const form = (el as { props: { children: { props: { staleSession: boolean } } } }).props.children;
    expect(form.props.staleSession).toBe(true);
  });
});

describe("the token of a session that is not active yet", () => {
  function jwt(expInSeconds: number) {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${b64({ alg: "RS256" })}.${b64({ sid: "sess_new", exp: Math.floor(Date.now() / 1000) + expInSeconds })}.sig`;
  }

  it("uses the token Clerk issued with the session: no getToken(), so Clerk writes no cookie", async () => {
    const { tokenForCreatedSession } = await import("@/lib/auth/clerkSession");
    const getToken = vi.fn(async () => "fetched");
    const setActive = vi.fn();
    const issued = jwt(55);
    const clerk = { signOut: vi.fn(), client: { sessions: [{ id: "sess_new", getToken, lastActiveToken: { getRawString: () => issued } }] } };
    expect(await tokenForCreatedSession(clerk, setActive, "sess_new")).toEqual({ token: issued, activated: false });
    expect(getToken).not.toHaveBeenCalled();
    expect(setActive).not.toHaveBeenCalled();
  });

  it.each([["expiring", jwt(5)], ["missing", ""], ["unreadable", "not-a-jwt"]])(
    "issued token %s → fetched instead (still not activated)",
    async (_label, issued) => {
      const { tokenForCreatedSession } = await import("@/lib/auth/clerkSession");
      const getToken = vi.fn(async () => "fetched");
      const clerk = { signOut: vi.fn(), client: { sessions: [{ id: "sess_new", getToken, lastActiveToken: issued ? { getRawString: () => issued } : null }] } };
      expect(await tokenForCreatedSession(clerk, vi.fn(), "sess_new")).toEqual({ token: "fetched", activated: false });
      expect(getToken).toHaveBeenCalledTimes(1);
    },
  );
});
