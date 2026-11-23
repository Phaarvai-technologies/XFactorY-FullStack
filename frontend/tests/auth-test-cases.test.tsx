/**
 * Sign-in and Sign-up test cases SU-01 … SU-17 and SI-01 … SI-19, one test per row of the
 * "XfactorY Sign-in & Sign-up Test Cases" sheet (same IDs, same expected results). Clerk and the
 * XfactorY backend are replaced by stand-ins, so every case runs in CI without real accounts.
 * SI-05 (already signed in) runs on the server page: tests/auth-test-cases.server.test.tsx.
 * Cases only a person can judge (inbox placement, browser console) are listed as todo.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  signIn: {} as Record<string, unknown>,
  signUp: {} as Record<string, unknown>,
  setActive: undefined as unknown as ReturnType<typeof vi.fn>,
  signOut: undefined as unknown as ReturnType<typeof vi.fn>,
  sessions: [] as { id: string; getToken: () => Promise<string | null>; remove: () => Promise<void> }[],
  removed: [] as string[],
  current: null as null | { email: string; session: { id: string; getToken: () => Promise<string | null> } },
  search: new URLSearchParams(),
  pushed: [] as string[],
  replaced: [] as string[],
  requests: [] as { url: string; method: string; auth: string | null; body: unknown }[],
  backend: {} as Record<string, (body: unknown, auth: string | null) => { status: number; json?: unknown } | "network">,
}));

vi.mock("@clerk/nextjs/legacy", () => ({
  useSignIn: () => ({ isLoaded: true, signIn: h.signIn, setActive: h.setActive }),
  useSignUp: () => ({ isLoaded: true, signUp: h.signUp, setActive: h.setActive }),
}));
const clerkObject = {
  get client() {
    return { sessions: h.sessions };
  },
  get session() {
    return h.current?.session ?? null;
  },
  get user() {
    return h.current ? { primaryEmailAddress: { emailAddress: h.current.email } } : null;
  },
  signOut: (...args: unknown[]) => h.signOut(...args),
};
vi.mock("@clerk/nextjs", () => ({ useClerk: () => clerkObject }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (p: string) => h.pushed.push(p),
    replace: (p: string) => h.replaced.push(p),
    refresh: () => undefined,
  }),
  useSearchParams: () => h.search,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import SsoCallbackPage from "@/app/sso-callback/page";
import { CustomSignInForm } from "@/components/auth/CustomSignInForm";
import { CustomSignUpForm } from "@/components/auth/CustomSignUpForm";
import { BACKEND_WAKE, STARTING_UP_MESSAGE } from "@/lib/auth/registration";

const API = "http://localhost:8000/api/v1";
const SIGN_UP_FIRST = "/sign-up?notice=signup_required";
const START_FAILED = "We couldn't start creating your account right now. Please try again.";
const ACCOUNT_CREATED = "Account created. Enter the verification code sent to your email.";

function clerkError(code: string, message: string, paramName?: string) {
  return { errors: [{ code, longMessage: message, meta: paramName ? { paramName } : {} }] };
}

beforeEach(() => {
  h.setActive = vi.fn(async () => undefined);
  h.signOut = vi.fn(async () => undefined);
  h.sessions = [];
  h.removed = [];
  h.current = null;
  h.search = new URLSearchParams();
  h.pushed = [];
  h.replaced = [];
  h.requests = [];
  h.backend = {};
  h.signIn = {};
  h.signUp = {};
  window.sessionStorage.clear();
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : null;
    h.requests.push({ url, method, auth: headers.Authorization ?? null, body });
    const handler = h.backend[`${method} ${url.replace(API, "")}`];
    if (!handler) throw new Error(`unexpected request ${method} ${url}`);
    const result = handler(body, headers.Authorization ?? null);
    if (result === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(result.json ?? {}), { status: result.status });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  BACKEND_WAKE.pauseMs = 3000;
});

/** A session Clerk created; its token names it, so the tests see whose token was sent. */
function createdSession(id: string) {
  h.sessions.push({ id, getToken: async () => `token-for-${id}`, remove: async () => { h.removed.push(id); } });
}

function registration(answer: "registered" | "unregistered") {
  h.backend["GET /identity/registration"] = () => ({ status: 200, json: { registered: answer === "registered" } });
}

function flowsOk() {
  h.backend["POST /identity/registration/flows"] = (body) => ({
    status: 201, json: { flowToken: `flow-${(body as { method: string }).method}` },
  });
}

/** Clerk's sign-up: create, email code sent, the code accepted with a new session. */
function clerkSignUpOk(sessionId = "sess_new") {
  createdSession(sessionId);
  h.signUp.create = vi.fn(async () => ({}));
  h.signUp.prepareEmailAddressVerification = vi.fn(async () => ({}));
  h.signUp.attemptEmailAddressVerification = vi.fn(async () => ({ status: "complete", createdSessionId: sessionId }));
  h.backend["POST /identity/registration/complete"] = () => ({ status: 200, json: { registered: true, alreadyRegistered: false } });
}

const byLabel = (label: string) => screen.getByLabelText(label);
const click = async (name: string) => {
  await act(async () => fireEvent.click(screen.getByRole("button", { name })));
};

function fillSignUpFields(over: Partial<Record<"name" | "email" | "password" | "confirm", string>> = {}, terms = true) {
  fireEvent.change(byLabel("Full name"), { target: { value: over.name ?? "Jordan Ellis" } });
  fireEvent.change(byLabel("Email"), { target: { value: over.email ?? "new@example.com" } });
  fireEvent.change(byLabel("Password"), { target: { value: over.password ?? "long-password-1" } });
  fireEvent.change(byLabel("Confirm password"), { target: { value: over.confirm ?? over.password ?? "long-password-1" } });
  if (terms) fireEvent.click(byLabel("I agree to the Terms of Service and Privacy Policy."));
}

async function signUp(over: Parameters<typeof fillSignUpFields>[0] = {}, terms = true) {
  fillSignUpFields(over, terms);
  await click("Create account");
}

async function enterSignUpCode(code = "424242") {
  fireEvent.change(byLabel("Verification code"), { target: { value: code } });
  await click("Verify email");
}

async function signIn(email = "a@example.com", password = "correct-horse") {
  fireEvent.change(byLabel("Email"), { target: { value: email } });
  fireEvent.change(byLabel("Password"), { target: { value: password } });
  await click("Sign in");
}

/** Password accepted, Clerk asks for the new-device email code (Device Trust). */
function deviceStepCreate() {
  return vi.fn(async () => {
    Object.assign(h.signIn, { id: "sia_1", status: "needs_client_trust" });
    return {
      status: "needs_client_trust",
      supportedSecondFactors: [{ strategy: "email_code", emailAddressId: "ea_1", safeIdentifier: "a***@example.com" }],
    };
  });
}

function storeIntent(value: unknown) {
  window.sessionStorage.setItem("xy-oauth-intent", JSON.stringify(value));
}

async function googleReturns() {
  await act(async () => {
    render(<SsoCallbackPage />);
  });
  await waitFor(() => expect(h.replaced.length).toBeGreaterThan(0), { timeout: 4000 });
}

// ================================================================================ Sign-up
describe("Sign-up test cases", () => {
  beforeEach(flowsOk);

  it("SU-01 new user signs up with email and password → code step, then signed in", async () => {
    clerkSignUpOk();
    render(<CustomSignUpForm redirectTo="/manufacturer/account" />);
    await signUp();
    expect(screen.getByText(ACCOUNT_CREATED)).toBeInTheDocument();
    expect(h.signUp.prepareEmailAddressVerification).toHaveBeenCalledWith({ strategy: "email_code" });
    await enterSignUpCode();
    expect(h.setActive).toHaveBeenCalledWith({ session: "sess_new" });
    expect(h.replaced).toEqual(["/manufacturer/account"]);
  });

  it.todo("SU-02 code email lands in the Inbox, not Spam (manual: Gmail and Outlook, or mail-tester.com)");

  it("SU-03 sign-up while the server is asleep → 'starting up' message, then the code step (no start error)", async () => {
    BACKEND_WAKE.deadlineMs = 5000;
    BACKEND_WAKE.pauseMs = 150;
    let calls = 0;
    h.backend["POST /identity/registration/flows"] = () => {
      calls += 1;
      return calls === 1 ? "network" : { status: 201, json: { flowToken: "flow-manual" } };
    };
    clerkSignUpOk();
    render(<CustomSignUpForm />);
    fillSignUpFields();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText(STARTING_UP_MESSAGE)).toBeInTheDocument();
    expect(await screen.findByText(ACCOUNT_CREATED, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(START_FAILED)).toBeNull();
    expect(h.signUp.create).toHaveBeenCalledTimes(1);
  });

  it("SU-04 new user signs up with Google → Google's account chooser, then registered and signed in", async () => {
    h.signUp.authenticateWithRedirect = vi.fn(async () => undefined);
    render(<CustomSignUpForm redirectTo="/app" />);
    fireEvent.click(byLabel("I agree to the Terms of Service and Privacy Policy."));
    await click("Continue with Google");
    expect(h.signUp.authenticateWithRedirect).toHaveBeenCalledWith(expect.objectContaining({
      strategy: "oauth_google", oidcPrompt: "select_account", legalAccepted: true,
    }));

    // Back from Google: the callback finishes the registration, then signs the user in.
    createdSession("sess_g");
    h.signUp = { status: "complete", createdSessionId: "sess_g", verifications: { externalAccount: { status: "verified" } } };
    h.backend["POST /identity/registration/complete"] = () => ({ status: 200, json: { registered: true, alreadyRegistered: false } });
    await googleReturns();
    expect(h.setActive).toHaveBeenCalledWith({ session: "sess_g" });
    expect(h.replaced).toEqual(["/app"]);
  });

  it("SU-05 resend the verification code → new code sent and confirmed", async () => {
    clerkSignUpOk();
    render(<CustomSignUpForm />);
    await signUp();
    await click("Resend code");
    expect(h.signUp.prepareEmailAddressVerification).toHaveBeenCalledTimes(2);
    expect(screen.getByText("A new verification code has been sent to your email.")).toBeInTheDocument();
  });

  it("SU-06 an account started but never finished → the password proves it, registration completes", async () => {
    createdSession("sess_old");
    h.signUp.create = vi.fn(async () => {
      throw clerkError("form_identifier_exists", "That email address is taken. Please try another.", "email_address");
    });
    h.backend["POST /identity/registration/account-status"] = () => ({ status: 200, json: { registered: false } });
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_old" }));
    h.backend["POST /identity/registration/complete"] = () => ({ status: 200, json: { registered: true, alreadyRegistered: false } });
    render(<CustomSignUpForm />);
    await signUp({ email: "old@example.com" });
    expect(h.signIn.create).toHaveBeenCalledWith({ identifier: "old@example.com", password: "long-password-1" });
    expect(h.setActive).toHaveBeenCalledWith({ session: "sess_old" });
    expect(h.replaced).toEqual(["/"]);
  });

  it("SU-07 email that already has an account → 'You already have an account. Please sign in.', no code", async () => {
    h.signUp.create = vi.fn(async () => {
      throw clerkError("form_identifier_exists", "That email address is taken. Please try another.", "email_address");
    });
    h.signUp.prepareEmailAddressVerification = vi.fn();
    h.signIn.create = vi.fn();
    h.backend["POST /identity/registration/account-status"] = () => ({ status: 200, json: { registered: true } });
    render(<CustomSignUpForm />);
    await signUp({ email: "exists@example.com" });
    expect(screen.getByText("You already have an account. Please sign in.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0);
    expect(h.signUp.prepareEmailAddressVerification).not.toHaveBeenCalled();
    expect(h.signIn.create).not.toHaveBeenCalled();
    expect(h.setActive).not.toHaveBeenCalled();
  });

  it("SU-08 Google sign-up with an already registered Google account → nothing created, 'already have an account'", async () => {
    storeIntent({ purpose: "sign-up", returnPath: "/app", flowToken: "flow-google" });
    createdSession("sess_reg");
    h.signUp = { verifications: { externalAccount: { status: "transferable", error: { code: "external_account_exists" } } } };
    h.signIn = { create: vi.fn(async () => ({ status: "complete", createdSessionId: "sess_reg" })) };
    registration("registered");
    await googleReturns();
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.removed).toEqual(["sess_reg"]);
    expect(h.replaced).toEqual(["/sign-up?notice=account_exists&redirect_url=%2Fapp"]);
  });

  it("SU-09 empty form → every required field says what is missing; nothing is sent", async () => {
    h.signUp.create = vi.fn();
    render(<CustomSignUpForm />);
    await click("Create account");
    for (const text of ["Please enter your full name.", "Please enter your email.", "Please enter a password.",
                        "Please confirm your password.",
                        "Please accept the Terms of Service and Privacy Policy to continue."]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(h.requests).toEqual([]);
    expect(h.signUp.create).not.toHaveBeenCalled();
  });

  it("SU-10 invalid email format → 'Please enter a valid email address.'", async () => {
    h.signUp.create = vi.fn();
    render(<CustomSignUpForm />);
    await signUp({ email: "abc@xyz" });
    expect(screen.getByText("Please enter a valid email address.")).toBeInTheDocument();
    expect(h.signUp.create).not.toHaveBeenCalled();
  });

  it("SU-11 password shorter than 8 characters → 'Password must be at least 8 characters.'", async () => {
    h.signUp.create = vi.fn();
    render(<CustomSignUpForm />);
    await signUp({ password: "short1" });
    expect(screen.getByText("Password must be at least 8 characters.")).toBeInTheDocument();
    expect(h.signUp.create).not.toHaveBeenCalled();
  });

  it("SU-12 passwords do not match → 'Passwords do not match.'", async () => {
    h.signUp.create = vi.fn();
    render(<CustomSignUpForm />);
    await signUp({ password: "long-password-1", confirm: "long-password-2" });
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(h.signUp.create).not.toHaveBeenCalled();
  });

  it("SU-13 Terms not accepted → message; neither email nor Google sign-up starts", async () => {
    h.signUp.create = vi.fn();
    h.signUp.authenticateWithRedirect = vi.fn();
    render(<CustomSignUpForm />);
    await signUp({}, false);
    expect(screen.getAllByText("Please accept the Terms of Service and Privacy Policy to continue.").length).toBeGreaterThan(0);
    await click("Continue with Google");
    expect(h.signUp.create).not.toHaveBeenCalled();
    expect(h.signUp.authenticateWithRedirect).not.toHaveBeenCalled();
    expect(h.requests).toEqual([]);
  });

  it("SU-14 common or leaked password → Clerk's refusal shown under Password, no code step", async () => {
    const pwned = "Password has been found in an online data breach. For account safety, please use a different password.";
    h.signUp.create = vi.fn(async () => {
      throw clerkError("form_password_pwned", pwned, "password");
    });
    h.signUp.prepareEmailAddressVerification = vi.fn();
    render(<CustomSignUpForm />);
    await signUp({ password: "password123" });
    expect(screen.getByText(/found in an online data breach/)).toBeInTheDocument();
    expect(h.signUp.prepareEmailAddressVerification).not.toHaveBeenCalled();
    expect(screen.queryByText(ACCOUNT_CREATED)).toBeNull();
  });

  it("SU-15 empty or wrong verification code → error, stays on the code step, not signed in", async () => {
    clerkSignUpOk();
    h.signUp.attemptEmailAddressVerification = vi.fn(async () => {
      throw clerkError("form_code_incorrect", "Incorrect code", "code");
    });
    render(<CustomSignUpForm />);
    await signUp();
    await click("Verify email");
    expect(screen.getByText("Please enter the verification code.")).toBeInTheDocument();
    await enterSignUpCode("000000");
    expect(screen.getByText("Incorrect code")).toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.replaced).toEqual([]);
  });

  it("SU-16 Google account Clerk refuses (e.g. a + address) → Clerk's message on the form, no account", async () => {
    h.signUp.authenticateWithRedirect = vi.fn(async () => {
      throw clerkError("not_allowed_access", "You do not have permission to access this page. Please contact your administrator.");
    });
    render(<CustomSignUpForm />);
    fireEvent.click(byLabel("I agree to the Terms of Service and Privacy Policy."));
    await click("Continue with Google");
    expect(screen.getByText(/do not have permission/)).toBeInTheDocument();
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.replaced).toEqual([]);
  });

  it("SU-17 server does not answer at all → 'We couldn't start creating your account', no Clerk account", async () => {
    BACKEND_WAKE.deadlineMs = 50;
    BACKEND_WAKE.pauseMs = 5;
    h.backend["POST /identity/registration/flows"] = () => "network";
    h.signUp.create = vi.fn();
    render(<CustomSignUpForm />);
    await signUp();
    expect(await screen.findByText(START_FAILED)).toBeInTheDocument();
    expect(h.signUp.create).not.toHaveBeenCalled();
  });
});

// ================================================================================ Sign-in
describe("Sign-in test cases", () => {
  it("SI-01 registered user signs in with email and password", async () => {
    createdSession("sess_1");
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_1" }));
    registration("registered");
    render(<CustomSignInForm redirectTo="/manufacturer/dashboard" />);
    await signIn();
    expect(h.requests[0].auth).toBe("Bearer token-for-sess_1");
    expect(h.setActive).toHaveBeenCalledWith({ session: "sess_1" });
    expect(h.pushed).toEqual(["/manufacturer/dashboard"]);
  });

  it("SI-02 registered user signs in with Google → account chooser, then signed in", async () => {
    h.signIn.authenticateWithRedirect = vi.fn(async () => undefined);
    render(<CustomSignInForm redirectTo="/app" />);
    await click("Continue with Google");
    expect(h.signIn.authenticateWithRedirect).toHaveBeenCalledWith(expect.objectContaining({
      strategy: "oauth_google", oidcPrompt: "select_account",
    }));

    createdSession("sess_g");
    h.signIn = { firstFactorVerification: { status: "verified" }, status: "complete", createdSessionId: "sess_g" };
    registration("registered");
    await googleReturns();
    expect(h.setActive).toHaveBeenCalledWith({ session: "sess_g" });
    expect(h.replaced).toEqual(["/app"]);
  });

  it("SI-03 new device (Device Trust) → code sent, then signed in", async () => {
    createdSession("sess_d");
    h.signIn.create = deviceStepCreate();
    h.signIn.prepareSecondFactor = vi.fn(async () => undefined);
    h.signIn.attemptSecondFactor = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_d" }));
    registration("registered");
    render(<CustomSignInForm redirectTo="/app" />);
    await signIn();
    expect(screen.getByText("Verification code sent to your email.")).toBeInTheDocument();
    fireEvent.change(byLabel("Verification code"), { target: { value: "123456" } });
    await click("Verify and sign in");
    expect(h.setActive).toHaveBeenCalledWith({ session: "sess_d" });
    expect(h.pushed).toEqual(["/app"]);
  });

  it("SI-04 sign in while the server is asleep → 'starting up' message, then signed in", async () => {
    BACKEND_WAKE.deadlineMs = 5000;
    BACKEND_WAKE.pauseMs = 150;
    createdSession("sess_w");
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_w" }));
    let calls = 0;
    h.backend["GET /identity/registration"] = () => {
      calls += 1;
      return calls === 1 ? "network" : { status: 200, json: { registered: true } };
    };
    render(<CustomSignInForm redirectTo="/app" />);
    fireEvent.change(byLabel("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(byLabel("Password"), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(STARTING_UP_MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(h.pushed).toEqual(["/app"]), { timeout: 3000 });
    expect(screen.queryByText("We couldn't confirm your account right now. Please try again.")).toBeNull();
  });

  it("SI-06 reset a forgotten password → code, new password, signed in", async () => {
    createdSession("sess_r");
    h.signIn.create = vi.fn(async () => ({}));
    h.signIn.attemptFirstFactor = vi.fn(async () => ({ status: "needs_new_password" }));
    h.signIn.resetPassword = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_r" }));
    registration("registered");
    render(<CustomSignInForm redirectTo="/app" />);
    fireEvent.change(byLabel("Email"), { target: { value: "a@example.com" } });
    await click("Forgot password?");
    expect(screen.getByText("Password reset code sent to your email.")).toBeInTheDocument();
    fireEvent.change(byLabel("Verification code"), { target: { value: "111111" } });
    await click("Verify code");
    expect(screen.getByText("Code verified. Please create your new password.")).toBeInTheDocument();
    fireEvent.change(byLabel("New password"), { target: { value: "new-password-1" } });
    fireEvent.change(byLabel("Confirm password"), { target: { value: "new-password-1" } });
    await click("Change password");
    expect(h.signIn.resetPassword).toHaveBeenCalledWith(expect.objectContaining({ password: "new-password-1" }));
    expect(h.pushed).toEqual(["/app"]);
  });

  it("SI-07 shared computer: a second person signing in never lands in the first person's account", async () => {
    h.current = { email: "priya@example.com", session: { id: "sess_priya", getToken: async () => "token-priya" } };
    h.signIn.create = vi.fn(async () => {
      throw clerkError("session_exists", "You're already signed in.");
    });
    render(<CustomSignInForm redirectTo="/app" />);
    await signIn("ravi@example.com");
    await waitFor(() => expect(h.signOut).toHaveBeenCalledTimes(1));
    expect(String((h.signOut.mock.calls[0][0] as { redirectUrl: string }).redirectUrl)).toContain("notice=other_account_signed_out");
    expect(h.pushed).toEqual([]);
    expect(h.requests).toEqual([]);

    h.search = new URLSearchParams("notice=other_account_signed_out");
    render(<CustomSignInForm />);
    expect(screen.getByText(/Another account was still signed in on this browser/)).toBeInTheDocument();
  });

  it.todo("SI-08 sign out, then Back does not show account pages (manual: account menu → Sign out)");

  it("SI-09 email with no account → Create Account with 'Please sign up first'", async () => {
    h.signIn.create = vi.fn(async () => {
      throw clerkError("form_identifier_not_found", "Couldn't find your account.", "identifier");
    });
    render(<CustomSignInForm />);
    await signIn("nobody@example.com");
    expect(h.replaced).toEqual([SIGN_UP_FIRST]);
    expect(h.setActive).not.toHaveBeenCalled();
  });

  it("SI-10 Google account that was never registered → Create Account with 'Please sign up first', nothing created", async () => {
    storeIntent({ purpose: "sign-in", returnPath: "/" });
    h.signIn = { firstFactorVerification: { status: "transferable" }, status: "needs_identifier" };
    h.signUp = { create: vi.fn(), verifications: {} };
    await googleReturns();
    expect(h.signUp.create).not.toHaveBeenCalled();
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.replaced[0]).toMatch(/^\/sign-up\?notice=signup_required/);
  });

  it("SI-11 account that never finished sign-up → Create Account with 'Please sign up first', not signed in", async () => {
    createdSession("sess_u");
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_u" }));
    registration("unregistered");
    render(<CustomSignInForm />);
    await signIn();
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.removed).toEqual(["sess_u"]);
    expect(h.replaced).toEqual([SIGN_UP_FIRST]);
  });

  it("SI-12 wrong password → error under Password, not signed in", async () => {
    h.signIn.create = vi.fn(async () => {
      throw clerkError("form_password_incorrect", "Password is incorrect. Try again, or use another method.", "password");
    });
    render(<CustomSignInForm />);
    await signIn("a@example.com", "wrong-password");
    expect(screen.getByText("Password is incorrect. Try again, or use another method.")).toBeInTheDocument();
    expect(h.setActive).not.toHaveBeenCalled();
  });

  it("SI-13 empty fields and invalid email → the matching messages; Clerk is not called", async () => {
    h.signIn.create = vi.fn();
    render(<CustomSignInForm />);
    await click("Sign in");
    expect(screen.getByText("Please enter your email.")).toBeInTheDocument();
    expect(screen.getByText("Please enter your password.")).toBeInTheDocument();
    await signIn("abc@xyz", "some-password");
    expect(screen.getByText("Please enter a valid email address.")).toBeInTheDocument();
    expect(h.signIn.create).not.toHaveBeenCalled();
  });

  it("SI-14 empty or wrong new-device code → error, not signed in", async () => {
    h.signIn.create = deviceStepCreate();
    h.signIn.prepareSecondFactor = vi.fn(async () => undefined);
    h.signIn.attemptSecondFactor = vi.fn(async () => {
      throw clerkError("form_code_incorrect", "Incorrect code", "code");
    });
    render(<CustomSignInForm />);
    await signIn();
    await click("Verify and sign in");
    expect(screen.getByText("Please enter the verification code.")).toBeInTheDocument();
    fireEvent.change(byLabel("Verification code"), { target: { value: "000000" } });
    await click("Verify and sign in");
    expect(screen.getByText("Incorrect code")).toBeInTheDocument();
    expect(h.setActive).not.toHaveBeenCalled();
  });

  it("SI-15 suspended account → 'This account has been suspended…', not signed in", async () => {
    const suspended = "This account has been suspended. Please contact XfactorY support.";
    createdSession("sess_s");
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_s" }));
    h.backend["GET /identity/registration"] = () => ({ status: 403, json: { detail: suspended } });
    render(<CustomSignInForm />);
    await signIn();
    expect(screen.getByText(suspended)).toBeInTheDocument();
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.replaced).toEqual([]);
  });

  it("SI-16 email linked to a different sign-in → its own message, never sent to Sign-up", async () => {
    const mismatch = "This email is linked to an existing XfactorY account that uses a different sign-in. " +
      "Please contact XfactorY support - do not create a new account.";
    createdSession("sess_m");
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_m" }));
    h.backend["GET /identity/registration"] = () => ({ status: 409, json: { detail: { code: "identity_mismatch", message: mismatch } } });
    render(<CustomSignInForm />);
    await signIn();
    expect(screen.getByText(mismatch)).toBeInTheDocument();
    expect(h.replaced).toEqual([]);
    expect(h.setActive).not.toHaveBeenCalled();
  });

  it("SI-17 password reset input errors → email first, 8+ characters, passwords match", async () => {
    h.signIn.create = vi.fn(async () => ({}));
    h.signIn.attemptFirstFactor = vi.fn(async () => ({ status: "needs_new_password" }));
    h.signIn.resetPassword = vi.fn();
    render(<CustomSignInForm />);
    await click("Forgot password?");
    expect(screen.getByText("Please enter your email first.")).toBeInTheDocument();
    expect(h.signIn.create).not.toHaveBeenCalled();

    fireEvent.change(byLabel("Email"), { target: { value: "a@example.com" } });
    await click("Forgot password?");
    fireEvent.change(byLabel("Verification code"), { target: { value: "111111" } });
    await click("Verify code");
    fireEvent.change(byLabel("New password"), { target: { value: "short1" } });
    fireEvent.change(byLabel("Confirm password"), { target: { value: "short1" } });
    await click("Change password");
    expect(screen.getByText("Password must be at least 8 characters.")).toBeInTheDocument();
    fireEvent.change(byLabel("New password"), { target: { value: "new-password-1" } });
    fireEvent.change(byLabel("Confirm password"), { target: { value: "new-password-2" } });
    await click("Change password");
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(h.signIn.resetPassword).not.toHaveBeenCalled();
  });

  it("SI-18 Google sign-in cancelled → back on Sign In with 'Google sign-in didn't complete'", async () => {
    storeIntent({ purpose: "sign-in", returnPath: "/" });
    h.signIn = { firstFactorVerification: { status: "failed" }, status: "needs_first_factor" };
    await googleReturns();
    expect(h.replaced).toEqual(["/sign-in?notice=oauth_failed"]);
    expect(h.setActive).not.toHaveBeenCalled();

    h.search = new URLSearchParams("notice=oauth_failed");
    render(<CustomSignInForm />);
    expect(screen.getByText("Google sign-in didn't complete. Please try again.")).toBeInTheDocument();
  });

  it.todo("SI-19 red Cloudflare lines in the browser console are expected (manual: F12 Console during SU-01 and SI-01)");
});
