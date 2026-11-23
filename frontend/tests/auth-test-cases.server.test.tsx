// @vitest-environment node
/**
 * SI-05 of the "XfactorY Sign-in & Sign-up Test Cases" sheet: opening Sign In while already
 * signed in goes straight to the account, without showing the form again.
 * The other rows are in tests/auth-test-cases.test.tsx.
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

beforeEach(() => {
  redirects.length = 0;
  serverAuth.userId = "user_signed_in";
  serverAuth.sessionId = "sess_live";
  serverAuth.sessionStatus = "active";
  serverAuth.sessionLookups = [];
  serverAuth.token = "cookie-token";
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ registered: true }), { status: 200 }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Sign-in test cases (server page)", () => {
  it("SI-05 already signed in, opens Sign In → taken straight to the account, no form", async () => {
    const { default: SignInPage } = await import("@/app/sign-in/[[...sign-in]]/page");
    await expect(
      SignInPage({ searchParams: Promise.resolve({ redirect_url: "/manufacturer/dashboard" }) }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(redirects).toEqual(["/manufacturer/dashboard"]);
  });
});
