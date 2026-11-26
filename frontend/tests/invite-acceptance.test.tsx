/**
 * Manufacturer magic link page (/invite/{code}): the link signs the manufacturer in with a fresh
 * one-time ticket, they accept the Terms, the backend makes them owner, on to the dashboard.
 * Clerk and the backend are stand-ins.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  signIn: {} as Record<string, unknown>,
  setActive: undefined as unknown as ReturnType<typeof vi.fn>,
  signOut: undefined as unknown as ReturnType<typeof vi.fn>,
  session: null as null | { getToken: () => Promise<string> },
  email: null as string | null,
  replaced: [] as string[],
  requests: [] as { url: string; auth: string | null; body: unknown }[],
  open: {} as Record<string, unknown>,
  accept: { status: 200, json: { accepted: true, returnPath: "/manufacturer/dashboard" } } as { status: number; json: unknown },
  updatePassword: undefined as unknown as ReturnType<typeof vi.fn>,
  createExternalAccount: undefined as unknown as ReturnType<typeof vi.fn>,
  assigned: [] as string[],
}));

vi.mock("@clerk/nextjs/legacy", () => ({
  useSignIn: () => ({ isLoaded: true, signIn: h.signIn, setActive: h.setActive }),
}));
vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({
    get session() { return h.session; },
    get user() {
      return h.session || h.email
        ? { primaryEmailAddress: h.email ? { emailAddress: h.email } : null,
            updatePassword: h.updatePassword, createExternalAccount: h.createExternalAccount }
        : null;
    },
    signOut: (...args: unknown[]) => h.signOut(...args),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: (p: string) => h.replaced.push(p), push: () => undefined }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import { InviteAcceptance } from "@/components/auth/InviteAcceptance";

const OPEN = { status: "open", ticket: "ticket-1", companyName: "Kaveri Kitchenware", email: "meena@kaveri.in",
               contactName: "Meena Raghavan" };

beforeEach(() => {
  h.setActive = vi.fn(async () => undefined);
  h.signOut = vi.fn(async () => undefined);
  h.session = null;
  h.email = null;
  h.replaced = [];
  h.requests = [];
  h.open = OPEN;
  h.accept = { status: 200, json: { accepted: true, returnPath: "/manufacturer/dashboard" } };
  h.updatePassword = vi.fn(async () => ({}));
  h.createExternalAccount = vi.fn(async () => ({
    verification: { externalVerificationRedirectURL: new URL("https://accounts.google.com/o/oauth2/auth?x=1") },
  }));
  h.assigned = [];
  h.signIn = {
    create: vi.fn(async () => {
      h.session = { getToken: async () => "token-meena" };
      return { status: "complete", createdSessionId: "sess_meena" };
    }),
  };
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    h.requests.push({ url: String(input), auth: headers.Authorization ?? null, body: init.body ? JSON.parse(String(init.body)) : null });
    if (String(input).endsWith("/open")) return new Response(JSON.stringify(h.open), { status: 200 });
    if (String(input).endsWith("/accept")) return new Response(JSON.stringify(h.accept.json), { status: h.accept.status });
    if (String(input).endsWith("/claim")) {
      const body = JSON.parse(String(init.body)) as { email: string };
      return new Response(JSON.stringify({ status: "verify", email: body.email.toLowerCase() }), { status: 200 });
    }
    throw new Error(`unexpected ${input}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

async function openPage() {
  await act(async () => {
    render(<InviteAcceptance code="abc123" />);
  });
}

describe("Manufacturer magic link page", () => {
  it("signs in with the ticket (no password), Terms, then the dashboard", async () => {
    await openPage();
    expect(await screen.findByText(/Welcome, Meena/)).toBeInTheDocument();
    expect(h.signIn.create).toHaveBeenCalledWith({ strategy: "ticket", ticket: "ticket-1" });
    expect(h.setActive).toHaveBeenCalledWith({ session: "sess_meena" });
    expect(h.requests[0]).toMatchObject({ url: expect.stringMatching(/\/invitations\/abc123\/open$/), auth: null });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open my account" })));
    expect(screen.getByText("Please accept the Terms of Service and Privacy Policy to continue.")).toBeInTheDocument();
    expect(h.requests.some((r) => r.url.endsWith("/accept"))).toBe(false);

    fireEvent.click(screen.getByLabelText(/I agree to the/));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open my account" })));
    const accept = h.requests.find((r) => r.url.endsWith("/accept"))!;
    expect(accept.auth).toBe("Bearer token-meena");
    expect(accept.body).toEqual({ termsAccepted: true, termsVersion: "terms-1.2;privacy-1.4" });

    // first visit: how to sign in next time
    expect(await screen.findByText("How will you sign in next time?")).toBeInTheDocument();
    expect(h.replaced).toEqual([]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Later, go to my account" })));
    expect(h.replaced).toEqual(["/manufacturer/dashboard"]);
  });

  async function acceptTerms() {
    await openPage();
    await screen.findByText(/Welcome, Meena/);
    fireEvent.click(screen.getByLabelText(/I agree to the/));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open my account" })));
    await screen.findByText("How will you sign in next time?");
  }

  it("first visit: set a password (checked), then the dashboard", async () => {
    await acceptTerms();
    fireEvent.click(screen.getByRole("button", { name: "Set a password" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "short" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save password and continue" })));
    expect(screen.getByText("Password must be at least 8 characters.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "kaveri-pans-2026" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "kaveri-pans-2027" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save password and continue" })));
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(h.updatePassword).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "kaveri-pans-2026" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save password and continue" })));
    expect(h.updatePassword).toHaveBeenCalledWith({ newPassword: "kaveri-pans-2026" });
    expect(h.replaced).toEqual(["/manufacturer/dashboard"]);
  });

  it("first visit: a password Clerk refuses shows Clerk's reason", async () => {
    h.updatePassword = vi.fn(async () => {
      throw { errors: [{ code: "form_password_pwned", longMessage: "Password has been found in an online data breach." }] };
    });
    await acceptTerms();
    fireEvent.click(screen.getByRole("button", { name: "Set a password" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password123" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save password and continue" })));
    expect(screen.getByText("Password has been found in an online data breach.")).toBeInTheDocument();
    expect(h.replaced).toEqual([]);
  });

  it("first visit: Google sign-in connects Google and comes back to the dashboard", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, origin: "http://localhost:3000", href: "http://localhost:3000/invite/abc123" });
    await acceptTerms();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use Google sign-in" })));
    expect(h.createExternalAccount).toHaveBeenCalledWith({
      strategy: "oauth_google", redirectUrl: expect.stringMatching(/\/manufacturer\/dashboard$/),
    });
    expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/auth?x=1");
  });

  it("someone else signed in on this browser: signed out first, nobody lands in their account", async () => {
    h.session = { getToken: async () => "token-other" };
    h.email = "other@example.com";
    await openPage();
    await waitFor(() => expect(h.signOut).toHaveBeenCalledTimes(1));
    expect(h.signIn.create).not.toHaveBeenCalled();
  });

  it("already signed in as the invited person: straight to the Terms", async () => {
    h.session = { getToken: async () => "token-meena" };
    h.email = "MEENA@kaveri.in";
    await openPage();
    expect(await screen.findByText(/Welcome, Meena/)).toBeInTheDocument();
    expect(h.signIn.create).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", "This link has expired. Please ask XfactorY to send you a new one."],
    ["cancelled", "This link is no longer active. Please ask XfactorY to send you a new one."],
    ["invalid", "This link is not valid. Please check it, or ask XfactorY to send you a new one."],
  ])("%s link: a clear message, no sign-in", async (status, message) => {
    h.open = { status, companyName: "Kaveri Kitchenware", email: "meena@kaveri.in", contactName: "Meena" };
    await openPage();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(h.signIn.create).not.toHaveBeenCalled();
  });

  it("account already set up: points to Sign in", async () => {
    h.open = { status: "accepted", companyName: "Kaveri Kitchenware", email: "meena@kaveri.in", contactName: "Meena" };
    await openPage();
    expect(await screen.findByText(/already set up/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  });

  it("the backend refuses the acceptance: its message, still on the page", async () => {
    h.accept = { status: 409, json: { detail: "This company already has an owner on XfactorY.", code: "has_owner" } };
    await openPage();
    await screen.findByText(/Welcome, Meena/);
    fireEvent.click(screen.getByLabelText(/I agree to the/));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open my account" })));
    expect(await screen.findByText("This company already has an owner on XfactorY.")).toBeInTheDocument();
    expect(h.replaced).toEqual([]);
  });

  it("a ticket Clerk does not complete: asks to sign in instead", async () => {
    h.signIn = { create: vi.fn(async () => ({ status: "needs_first_factor" })) };
    await openPage();
    expect(await screen.findByText(/couldn't sign you in automatically/)).toBeInTheDocument();
    expect(h.setActive).not.toHaveBeenCalled();
  });

  it("link made without an email: they enter their email, confirm the code Clerk sends, then the Terms", async () => {
    h.open = { status: "claim", companyName: "Vaigai Polymers", email: "", contactName: "" };
    const create = vi.fn(async () => ({
      supportedFirstFactors: [{ strategy: "email_code", emailAddressId: "idn_selvi" }],
    }));
    const prepareFirstFactor = vi.fn(async () => ({}));
    const attemptFirstFactor = vi.fn(async () => {
      h.session = { getToken: async () => "token-selvi" };
      return { status: "complete", createdSessionId: "sess_selvi" };
    });
    h.signIn = { create, prepareFirstFactor, attemptFirstFactor };
    await openPage();
    expect(await screen.findByText(/set up an account for/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();                       // no ticket, nobody signed in yet

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Selvi Arun" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Selvi@Vaigai.in" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Email me a code" })));
    const claim = h.requests.find((r) => r.url.endsWith("/claim"))!;
    expect(claim.body).toEqual({ email: "Selvi@Vaigai.in", name: "Selvi Arun" });
    expect(create).toHaveBeenCalledWith({ identifier: "selvi@vaigai.in" });
    expect(prepareFirstFactor).toHaveBeenCalledWith({ strategy: "email_code", emailAddressId: "idn_selvi" });

    expect(await screen.findByText(/We sent a code to/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "424242" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Continue" })));
    expect(attemptFirstFactor).toHaveBeenCalledWith({ strategy: "email_code", code: "424242" });
    expect(h.setActive).toHaveBeenCalledWith({ session: "sess_selvi" });
    expect(await screen.findByText(/You are signed in as selvi@vaigai.in/)).toBeInTheDocument();
  });

  it("a claimed link opened again asks for the email code, never signs in by itself", async () => {
    h.open = { status: "verify", companyName: "Vaigai Polymers", email: "selvi@vaigai.in", contactName: "Selvi" };
    await openPage();
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send code" })).toBeInTheDocument();
    expect(h.signIn.create).not.toHaveBeenCalled();
  });
});
