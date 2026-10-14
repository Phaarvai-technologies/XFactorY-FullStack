// @vitest-environment node
/**
 * The proxy's registration gate (direct URLs and existing sessions), with Clerk's server
 * helpers replaced by tests/mocks/clerkServer.ts and the backend by a fetch stub.
 * Runs once for the standalone deployment and once under the /xfactory base path.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serverAuth } from "./mocks/clerkServer";

let answer: "registered" | "unregistered" | "down" | "suspended";
let calls: string[];

beforeEach(() => {
  serverAuth.userId = null;
  serverAuth.token = "server-token";
  serverAuth.protected = [];
  calls = [];
  answer = "registered";
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_proxy");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push(`${String(url)} ${(init.headers as Record<string, string>)?.Authorization}`);
    if (answer === "down") throw new TypeError("fetch failed");
    if (answer === "suspended") return new Response(JSON.stringify({ detail: "suspended" }), { status: 403 });
    return new Response(JSON.stringify({ registered: answer === "registered" }), { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadProxy(basePath: string) {
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", basePath);
  vi.resetModules();
  return (await import("@/proxy")).default;
}

function request(path: string, basePath: string, cookie?: string) {
  const headers = cookie ? { cookie } : undefined;
  return new NextRequest(`http://localhost:3000${basePath}${path}`, {
    headers,
    nextConfig: basePath ? { basePath } : undefined,
  });
}

describe.each(["", "/xfactory"])("proxy registration gate (base path '%s')", (base) => {
  it("signed-in but unregistered → Sign-up with the notice, keeping the base path", async () => {
    const proxy = await loadProxy(base);
    serverAuth.userId = "user_x";
    answer = "unregistered";
    const res = (await proxy(request("/onboarding/roles?step=2", base), {} as never)) as Response;
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `${base}/sign-up?notice=signup_required&redirect_url=%2Fonboarding%2Froles%3Fstep%3D2`,
    );
    expect(calls).toEqual(["http://localhost:8000/api/v1/identity/registration Bearer server-token"]);
  });

  it("also guards Manufacturer profile setup for signed-in users", async () => {
    const proxy = await loadProxy(base);
    serverAuth.userId = "user_x";
    answer = "unregistered";
    const res = (await proxy(request("/manufacturer/account", base), {} as never)) as Response;
    expect(res.headers.get("location")).toMatch(new RegExp(`^${base}/sign-up\\?notice=signup_required`));
  });

  it("registered → served, and remembered briefly in a signed, user-bound cookie", async () => {
    const proxy = await loadProxy(base);
    serverAuth.userId = "user_r";
    const res = (await proxy(request("/manufacturer/dashboard", base), {} as never)) as Response;
    expect(res.headers.get("location")).toBeNull();
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^xy_reg=user_r\\.\\d+\\.[\\w-]+; Path=${base || "/"}`));
    expect(cookie).toMatch(/HttpOnly/i);
    const value = cookie.split(";")[0];

    calls = [];
    await proxy(request("/manufacturer/dashboard", base, value), {} as never);
    expect(calls).toEqual([]); // cached

    serverAuth.userId = "user_other"; // another user on the same browser: cookie does not apply
    answer = "unregistered";
    const other = (await proxy(request("/manufacturer/dashboard", base, value), {} as never)) as Response;
    expect(other.status).toBe(307);

    serverAuth.userId = "user_r"; // tampered signature
    const forged = value.replace(/\.[\w-]+$/, ".AAAA");
    const res2 = (await proxy(request("/manufacturer/dashboard", base, forged), {} as never)) as Response;
    expect(res2.status).toBe(307);
  });

  it.each(["down", "suspended"] as const)("backend %s → page served, no 'sign up first' redirect", async (state) => {
    const proxy = await loadProxy(base);
    serverAuth.userId = "user_d";
    answer = state;
    const res = await proxy(request("/visionaries/flow", base), {} as never);
    expect(res?.headers.get("location") ?? null).toBeNull();
    expect(res?.headers.get("set-cookie") ?? null).toBeNull();
  });

  it("signed-out visitors and public pages are unchanged", async () => {
    const proxy = await loadProxy(base);
    await proxy(request("/onboarding/roles", base), {} as never);
    expect(serverAuth.protected).toEqual(["/onboarding/roles"]); // Clerk's own protection
    serverAuth.userId = "user_x";
    answer = "unregistered";
    for (const path of ["/", "/sign-in", "/sign-up", "/sso-callback", "/manufacturer", "/visionaries"]) {
      const res = await proxy(request(path, base), {} as never);
      expect(res?.headers.get("location") ?? null).toBeNull();
    }
    expect(calls).toEqual([]);
  });
});
