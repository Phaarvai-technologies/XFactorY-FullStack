/**
 * A sleeping backend (Render free instance: ~50 s to start). Browser requests of the Sign-in /
 * Sign-up flow keep retrying instead of failing after the first 15 s, the pages say the server is
 * starting up, and the pages start waking it as soon as they open.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  signIn: {} as Record<string, unknown>,
  setActive: undefined as unknown as ReturnType<typeof vi.fn>,
  pushed: [] as string[],
}));
vi.mock("@clerk/nextjs/legacy", () => ({
  useSignIn: () => ({ isLoaded: true, signIn: h.signIn, setActive: h.setActive }),
  useSignUp: () => ({ isLoaded: true, signUp: {}, setActive: h.setActive }),
}));
vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({
    client: { sessions: [{ id: "sess_1", getToken: async () => "token-sess_1", remove: async () => undefined }] },
    session: null, user: null, signOut: async () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (p: string) => h.pushed.push(p), replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { CustomSignInForm } from "@/components/auth/CustomSignInForm";
import {
  BACKEND_WAKE,
  checkRegistration,
  onBackendWaking,
  startSignUpFlow,
  STARTING_UP_MESSAGE,
  wakeBackend,
} from "@/lib/auth/registration";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const asleep = () => Promise.reject(new TypeError("Failed to fetch"));

beforeEach(() => {
  h.signIn = {};
  h.setActive = vi.fn(async () => undefined);
  h.pushed = [];
  BACKEND_WAKE.deadlineMs = 5000;   // the real value is 90 s; short here so the tests stay fast
  BACKEND_WAKE.pauseMs = 1;
});
afterEach(() => {
  vi.unstubAllGlobals();
  BACKEND_WAKE.pauseMs = 3000;
});

describe("requests wait for a server that is starting up", () => {
  it("no answer at first (asleep): retried until it answers; the pages are told meanwhile", async () => {
    const answers = [asleep, asleep, async () => ok({ flowToken: "flow-1" })];
    const fetchImpl = vi.fn(() => answers.shift()!());
    const seen: boolean[] = [];
    const stop = onBackendWaking((waking) => seen.push(waking));
    await expect(startSignUpFlow("manual", "/", true, fetchImpl as unknown as typeof fetch)).resolves.toBe("flow-1");
    stop();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(seen).toEqual([true, false]);              // "starting up" shown, then cleared
  });

  it("502 / 503 / 504 while the server starts are retried too", async () => {
    const answers = [
      async () => new Response("<html>starting</html>", { status: 503 }),
      async () => new Response("bad gateway", { status: 502 }),
      async () => ok({ registered: true }),
    ];
    const fetchImpl = vi.fn(() => answers.shift()!());
    await expect(checkRegistration("token", { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .resolves.toEqual({ state: "registered" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("real answers are never retried (e.g. 403 not registered)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ detail: { code: "registration_required" } }), { status: 403 }));
    await expect(checkRegistration("token", { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .resolves.toEqual({ state: "unregistered" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after the time limit with the usual message", async () => {
    BACKEND_WAKE.deadlineMs = 30;
    const fetchImpl = vi.fn(asleep);
    await expect(startSignUpFlow("manual", "/", true, fetchImpl as unknown as typeof fetch))
      .rejects.toThrow("We couldn't start creating your account right now. Please try again.");
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
  });

  it("a caller's own abort signal keeps the single attempt (server-side checks)", async () => {
    const fetchImpl = vi.fn(asleep);
    const result = await checkRegistration("token", {
      fetchImpl: fetchImpl as unknown as typeof fetch, signal: new AbortController().signal,
    });
    expect(result.state).toBe("error");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("Sign-in page", () => {
  it("shows 'server is starting up' while it waits, then signs in normally", async () => {
    BACKEND_WAKE.pauseMs = 150;
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_1" }));
    h.setActive = vi.fn(async () => undefined);
    let calls = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (!String(url).endsWith("/identity/registration")) throw new Error(`unexpected request ${url}`);
      calls += 1;
      return calls === 1 ? asleep() : ok({ registered: true });
    });
    render(<CustomSignInForm redirectTo="/app" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign in" })); });
    expect(await screen.findByText(STARTING_UP_MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(h.pushed).toEqual(["/app"]));
    expect(screen.queryByText(STARTING_UP_MESSAGE)).toBeNull();      // cleared once the server answered
  });

  it("opening the page starts waking the server once (its health address, nothing else)", () => {
    BACKEND_WAKE.prewarm = true;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    render(<CustomSignInForm />);
    wakeBackend();                                                   // a second call does nothing
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toMatch(/^https?:\/\/[^/]+\/health$/);
  });
});
