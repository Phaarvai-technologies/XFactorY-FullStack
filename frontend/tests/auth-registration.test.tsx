/**
 * Registration before sign-in: Sign-in, Sign-up and the Google callback with Clerk and the
 * X!Y backend replaced by stand-ins. Every "backend" answer goes through a fetch stub, so the
 * tests also check which requests are (and are not) made.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    signIn: {} as Record<string, unknown>,
    signUp: {} as Record<string, unknown>,
    setActive: undefined as unknown as ReturnType<typeof vi.fn>,
    signOut: undefined as unknown as ReturnType<typeof vi.fn>,
    sessions: [] as { id: string; getToken: () => Promise<string | null> }[],
    search: new URLSearchParams(),
    pushed: [] as string[],
    replaced: [] as string[],
    requests: [] as { url: string; method: string; auth: string | null; body: unknown }[],
    backend: {} as Record<string, (body: unknown, auth: string | null) => { status: number; json?: unknown } | "network">,
  };
  return state;
});

vi.mock("@clerk/nextjs/legacy", () => ({
  useSignIn: () => ({ isLoaded: true, signIn: h.signIn, setActive: h.setActive }),
  useSignUp: () => ({ isLoaded: true, signUp: h.signUp, setActive: h.setActive }),
}));
const clerkObject = {
  get client() {
    return { sessions: h.sessions };
  },
  session: null,
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

import { CustomSignInForm } from "@/components/auth/CustomSignInForm";
import { CustomSignUpForm } from "@/components/auth/CustomSignUpForm";
import SsoCallbackPage from "@/app/sso-callback/page";
import { SIGN_UP_FIRST_MESSAGE, TERMS_VERSION } from "@/lib/auth/registration";

const API = "http://localhost:8000/api/v1";

function clerkError(code: string, message: string, paramName?: string) {
  return { errors: [{ code, longMessage: message, meta: paramName ? { paramName } : {} }] };
}

beforeEach(() => {
  h.setActive = vi.fn(async () => undefined);
  h.signOut = vi.fn(async () => undefined);
  h.sessions = [];
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
    const auth = headers.Authorization ?? null;
    const body = init.body ? JSON.parse(String(init.body)) : null;
    h.requests.push({ url, method, auth, body });
    const handler = h.backend[`${method} ${url.replace(API, "")}`];
    if (!handler) throw new Error(`unexpected request ${method} ${url}`);
    const result = handler(body, auth);
    if (result === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(result.json ?? {}), { status: result.status });
  });
});

/** A session Clerk created; its token names it, so tests can see whose token was sent. */
function createdSession(id: string) {
  h.sessions.push({ id, getToken: async () => `token-for-${id}` });
}

function registration(answer: "registered" | "unregistered" | "down" | "500") {
  h.backend["GET /identity/registration"] = () =>
    answer === "down" ? "network" : answer === "500" ? { status: 500, json: { detail: "db" } }
      : { status: 200, json: { registered: answer === "registered" } };
}

async function fillSignIn(email = "a@example.com", password = "correct-horse") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  });
}

// ------------------------------------------------------------------------------- Sign-in
describe("Sign-in", () => {
  it("unknown account → Sign-up with the notice; nothing activated, backend not asked", async () => {
    h.signIn.create = vi.fn(async () => {
      throw clerkError("form_identifier_not_found", "Couldn't find your account.", "identifier");
    });
    render(<CustomSignInForm redirectTo="/onboarding/roles" />);
    await fillSignIn("new@example.com");
    expect(h.replaced).toEqual(["/sign-up?notice=signup_required&redirect_url=%2Fonboarding%2Froles"]);
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.requests).toEqual([]);
  });

  it("Clerk account without X!Y registration → session never activated, ended, sent to Sign-up", async () => {
    createdSession("sess_1");
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_1" }));
    registration("unregistered");
    render(<CustomSignInForm redirectTo="/" />);
    await fillSignIn();
    expect(h.requests[0].auth).toBe("Bearer token-for-sess_1");
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalledWith({ sessionId: "sess_1" });
    expect(h.replaced).toEqual(["/sign-up?notice=signup_required"]);
    expect(h.pushed).toEqual([]);
  });

  it("registered user signs in", async () => {
    createdSession("sess_2");
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_2" }));
    registration("registered");
    render(<CustomSignInForm redirectTo="/manufacturer/dashboard" />);
    await fillSignIn();
    expect(h.setActive).toHaveBeenCalledWith({ session: "sess_2" });
    expect(h.pushed).toEqual(["/manufacturer/dashboard"]);
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("incorrect password keeps the existing field error", async () => {
    h.signIn.create = vi.fn(async () => {
      throw clerkError("form_password_incorrect", "Password is incorrect. Try again, or use another method.", "password");
    });
    render(<CustomSignInForm />);
    await fillSignIn("a@example.com", "wrong");
    expect(screen.getByText("Password is incorrect. Try again, or use another method.")).toBeInTheDocument();
    expect(h.replaced).toEqual([]);
    expect(h.requests).toEqual([]);
  });

  it.each(["down", "500"] as const)("backend %s → error message, never 'sign up first'", async (answer) => {
    createdSession("sess_3");
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_3" }));
    registration(answer);
    render(<CustomSignInForm />);
    await fillSignIn();
    expect(screen.getByText("We couldn't confirm your account right now. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText(SIGN_UP_FIRST_MESSAGE)).not.toBeInTheDocument();
    expect(h.replaced).toEqual([]);
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalledWith({ sessionId: "sess_3" });
  });

  it("new-device / MFA code step still works and is followed by the registration check", async () => {
    createdSession("sess_4");
    h.signIn.create = vi.fn(async () => ({
      status: "needs_second_factor",
      supportedSecondFactors: [{ strategy: "email_code", emailAddressId: "ea_1", safeIdentifier: "a***@example.com" }],
    }));
    h.signIn.prepareSecondFactor = vi.fn(async () => undefined);
    h.signIn.attemptSecondFactor = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_4" }));
    registration("registered");
    render(<CustomSignInForm redirectTo="/app" />);
    await fillSignIn();
    expect(h.signIn.prepareSecondFactor).toHaveBeenCalledWith({ strategy: "email_code", emailAddressId: "ea_1" });
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    });
    expect(h.setActive).toHaveBeenCalledWith({ session: "sess_4" });
    expect(h.pushed).toEqual(["/app"]);
  });

  it("password reset still completes, then the same registration rule applies", async () => {
    createdSession("sess_5");
    h.signIn.create = vi.fn(async () => ({}));
    h.signIn.attemptFirstFactor = vi.fn(async () => ({ status: "needs_new_password" }));
    h.signIn.resetPassword = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_5" }));
    registration("registered");
    render(<CustomSignInForm redirectTo="/app" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Forgot password?" })));
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "111111" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Verify code" })));
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password-1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "new-password-1" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Change password" })));
    expect(h.signIn.resetPassword).toHaveBeenCalled();
    expect(h.pushed).toEqual(["/app"]);
  });

  it("Google: sign-in intent stored, Clerk returns to the callback (not straight into the app)", async () => {
    h.signIn.authenticateWithRedirect = vi.fn(async () => undefined);
    render(<CustomSignInForm redirectTo="/visionaries/flow" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Continue with Google" })));
    expect(h.signIn.authenticateWithRedirect).toHaveBeenCalledWith({
      strategy: "oauth_google", redirectUrl: "/sso-callback", redirectUrlComplete: "/sso-callback",
    });
    expect(JSON.parse(window.sessionStorage.getItem("xy-oauth-intent") ?? "{}")).toEqual({
      purpose: "sign-in", returnPath: "/visionaries/flow",
    });
  });

  it("shows the post-registration notice and ends a stale unregistered session", async () => {
    h.search = new URLSearchParams("notice=registered");
    render(<CustomSignInForm staleSession />);
    expect(screen.getByText("Your account is ready. Please sign in to continue.")).toBeInTheDocument();
    await waitFor(() => expect(h.signOut).toHaveBeenCalledTimes(1));
  });
});

// ------------------------------------------------------------------------------- Sign-up
async function fillSignUp(email = "new@example.com") {
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Jordan Ellis" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long-password-1" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "long-password-1" } });
  fireEvent.click(screen.getByLabelText("I agree to the Terms of Service and Privacy Policy."));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create account" })));
}

async function enterCode(button = "Verify email") {
  fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "424242" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: button })));
}

describe("Sign-up", () => {
  beforeEach(() => {
    h.backend["POST /identity/registration/flows"] = (body) => ({
      status: 201, json: { flowToken: `flow-${(body as { method: string }).method}` },
    });
  });

  it("shows the required notice from Sign-in", () => {
    h.search = new URLSearchParams("notice=signup_required");
    render(<CustomSignUpForm />);
    expect(screen.getByText(SIGN_UP_FIRST_MESSAGE)).toBeInTheDocument();
  });

  it("manual sign-up → registration finalized once with the new session's token → Sign-in", async () => {
    createdSession("sess_new");
    h.signUp.create = vi.fn(async () => ({}));
    h.signUp.prepareEmailAddressVerification = vi.fn(async () => ({}));
    h.signUp.attemptEmailAddressVerification = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_new" }));
    const completes: unknown[] = [];
    h.backend["POST /identity/registration/complete"] = (body, auth) => {
      completes.push({ body, auth });
      return { status: 200, json: { registered: true, alreadyRegistered: false } };
    };
    render(<CustomSignUpForm redirectTo="/manufacturer/account" />);
    await fillSignUp();
    expect(h.requests[0].url).toBe(`${API}/identity/registration/flows`); // before Clerk creates anything
    await enterCode();
    expect(completes).toEqual([{ body: { flowToken: "flow-manual" }, auth: "Bearer token-for-sess_new" }]);
    expect(h.setActive).not.toHaveBeenCalled(); // never an active app session
    expect(h.signOut).toHaveBeenCalledWith({ sessionId: "sess_new" });
    expect(h.replaced).toEqual(["/sign-in?notice=registered&redirect_url=%2Fmanufacturer%2Faccount"]);
  });

  it("server unreachable before sign-up → no Clerk account is created", async () => {
    h.backend["POST /identity/registration/flows"] = () => "network";
    h.signUp.create = vi.fn(async () => ({}));
    render(<CustomSignUpForm />);
    await fillSignUp();
    expect(h.signUp.create).not.toHaveBeenCalled();
    expect(screen.getByText("We couldn't start creating your account right now. Please try again.")).toBeInTheDocument();
  });

  it("completion fails (server down) → retry finishes it without re-verifying; no false notice", async () => {
    createdSession("sess_r");
    h.signUp.create = vi.fn(async () => ({}));
    h.signUp.prepareEmailAddressVerification = vi.fn(async () => ({}));
    h.signUp.attemptEmailAddressVerification = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_r" }));
    let up = false;
    h.backend["POST /identity/registration/complete"] = () =>
      up ? { status: 200, json: { registered: true, alreadyRegistered: false } } : { status: 503, json: { detail: "x" } };
    render(<CustomSignUpForm />);
    await fillSignUp();
    await enterCode();
    expect(screen.getByText("We couldn't finish creating your account. Please try again.")).toBeInTheDocument();
    expect(h.signOut).not.toHaveBeenCalled();
    up = true;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Verify email" })));
    expect(h.signUp.attemptEmailAddressVerification).toHaveBeenCalledTimes(1);
    expect(h.replaced).toEqual(["/sign-in?notice=registered"]);
  });

  it("email already in Clerk but never registered: the entered password proves it, then registers", async () => {
    createdSession("sess_old");
    h.signUp.create = vi.fn(async () => {
      throw clerkError("form_identifier_exists", "That email address is taken. Please try another.", "email_address");
    });
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_old" }));
    h.backend["POST /identity/registration/complete"] = () => ({ status: 200, json: { registered: true, alreadyRegistered: false } });
    render(<CustomSignUpForm />);
    await fillSignUp("old@example.com");
    expect(h.signIn.create).toHaveBeenCalledWith({ identifier: "old@example.com", password: "long-password-1" });
    expect(h.replaced).toEqual(["/sign-in?notice=registered"]);
  });

  it("email taken by a registered account (or wrong password) → Clerk's original message", async () => {
    h.signUp.create = vi.fn(async () => {
      throw clerkError("form_identifier_exists", "That email address is taken. Please try another.", "email_address");
    });
    h.signIn.create = vi.fn(async () => {
      throw clerkError("form_password_incorrect", "Password is incorrect.", "password");
    });
    render(<CustomSignUpForm />);
    await fillSignUp("taken@example.com");
    expect(screen.getByText("That email address is taken. Please try another.")).toBeInTheDocument();
    expect(h.replaced).toEqual([]);

    // Correct password, already registered: same message, session ended.
    createdSession("sess_reg");
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_reg" }));
    h.backend["POST /identity/registration/complete"] = () => ({ status: 200, json: { registered: true, alreadyRegistered: true } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create account" })));
    expect(screen.getByText("That email address is taken. Please try another.")).toBeInTheDocument();
    expect(h.signOut).toHaveBeenCalledWith({ sessionId: "sess_reg" });
    expect(h.replaced).toEqual([]);
  });

  it("Google sign-up stores a server-issued sign-up token for the callback", async () => {
    h.signUp.authenticateWithRedirect = vi.fn(async () => undefined);
    render(<CustomSignUpForm redirectTo="/visionaries/flow" />);
    fireEvent.click(screen.getByLabelText("I agree to the Terms of Service and Privacy Policy."));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Continue with Google" })));
    expect(JSON.parse(window.sessionStorage.getItem("xy-oauth-intent") ?? "{}")).toEqual({
      purpose: "sign-up", returnPath: "/visionaries/flow", flowToken: "flow-google",
    });
    expect(h.signUp.authenticateWithRedirect).toHaveBeenCalledWith(expect.objectContaining({
      strategy: "oauth_google", redirectUrl: "/sso-callback", redirectUrlComplete: "/sso-callback", legalAccepted: true,
    }));
  });
});

// ------------------------------------------------------------------------------- Google callback
function intent(value: unknown) {
  window.sessionStorage.setItem("xy-oauth-intent", JSON.stringify(value));
}

async function runCallback() {
  await act(async () => {
    render(<SsoCallbackPage />);
  });
  await waitFor(() => expect(h.replaced.length).toBeGreaterThan(0));
}

describe("Google callback", () => {
  it.each([
    ["sign-in intent", { purpose: "sign-in", returnPath: "/app" }],
    ["no stored intent", null],
    ["'sign-up' label without a server token", { purpose: "sign-up", returnPath: "/app" }],
  ])("unknown Google account (%s) is never turned into a sign-up", async (_label, stored) => {
    if (stored) intent(stored);
    h.signIn = { firstFactorVerification: { status: "transferable" }, status: "needs_identifier" };
    h.signUp = { create: vi.fn(), verifications: {} };
    await runCallback();
    expect((h.signUp.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.replaced[0]).toMatch(/^\/sign-up\?notice=signup_required/);
  });

  it("existing Google account, registered → activated and sent on", async () => {
    intent({ purpose: "sign-in", returnPath: "/manufacturer/dashboard" });
    createdSession("sess_g");
    h.signIn = { firstFactorVerification: { status: "verified" }, status: "complete", createdSessionId: "sess_g" };
    registration("registered");
    await runCallback();
    expect(h.setActive).toHaveBeenCalledWith({ session: "sess_g" });
    expect(h.replaced).toEqual(["/manufacturer/dashboard"]);
  });

  it("existing Google account, not registered → session ended, Sign-up notice", async () => {
    intent({ purpose: "sign-in", returnPath: "/" });
    createdSession("sess_u");
    h.signIn = { firstFactorVerification: { status: "verified" }, status: "complete", createdSessionId: "sess_u" };
    registration("unregistered");
    await runCallback();
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalledWith({ sessionId: "sess_u" });
    expect(h.replaced).toEqual(["/sign-up?notice=signup_required"]);
  });

  it("existing Google account, backend down → error, not 'sign up first'", async () => {
    intent({ purpose: "sign-in", returnPath: "/" });
    createdSession("sess_d");
    h.signIn = { firstFactorVerification: { status: "verified" }, status: "complete", createdSessionId: "sess_d" };
    registration("down");
    await runCallback();
    expect(h.replaced).toEqual(["/sign-in?notice=unavailable"]);
  });

  it("Google sign-up of a new account → registered with the token → Sign-in", async () => {
    intent({ purpose: "sign-up", returnPath: "/onboarding/roles", flowToken: "flow-google" });
    createdSession("sess_s");
    h.signUp = { status: "complete", createdSessionId: "sess_s", verifications: { externalAccount: { status: "verified" } } };
    const completes: unknown[] = [];
    h.backend["POST /identity/registration/complete"] = (body, auth) => {
      completes.push({ body, auth });
      return { status: 200, json: { registered: true, alreadyRegistered: false } };
    };
    await runCallback();
    expect(completes).toEqual([{ body: { flowToken: "flow-google" }, auth: "Bearer token-for-sess_s" }]);
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalledWith({ sessionId: "sess_s" });
    expect(h.replaced).toEqual(["/sign-in?notice=registered&redirect_url=%2Fonboarding%2Froles"]);
  });

  it("Google sign-up with an account Clerk already has → transferred to sign-in, then completed", async () => {
    intent({ purpose: "sign-up", returnPath: "/", flowToken: "flow-google" });
    createdSession("sess_t");
    h.signUp = { verifications: { externalAccount: { status: "transferable", error: { code: "external_account_exists" } } } };
    h.signIn = { create: vi.fn(async () => ({ status: "complete", createdSessionId: "sess_t" })) };
    h.backend["POST /identity/registration/complete"] = () => ({ status: 200, json: { registered: true, alreadyRegistered: false } });
    await runCallback();
    expect(h.signIn.create).toHaveBeenCalledWith({ transfer: true });
    expect(h.replaced).toEqual(["/sign-in?notice=registered"]);
  });

  it("registration completion refused → session ended, back to Sign-up with an error", async () => {
    intent({ purpose: "sign-up", returnPath: "/", flowToken: "flow-google" });
    createdSession("sess_f");
    h.signUp = { status: "complete", createdSessionId: "sess_f", verifications: {} };
    h.backend["POST /identity/registration/complete"] = () => ({ status: 503, json: { detail: "down" } });
    await runCallback();
    expect(h.signOut).toHaveBeenCalledWith({ sessionId: "sess_f" });
    expect(h.replaced).toEqual(["/sign-up?notice=signup_failed"]);
  });
});


// ------------------------------------------------------------------------------- Round 3
describe("Notice text", () => {
  it("is exactly the required sentence", () => {
    expect(SIGN_UP_FIRST_MESSAGE).toBe("Your account is not registered yet. Please sign up first, then sign in to continue.");
    h.search = new URLSearchParams("notice=signup_required");
    render(<CustomSignUpForm />);
    expect(screen.getByText("Your account is not registered yet. Please sign up first, then sign in to continue.")).toBeInTheDocument();
  });
});

describe("Sign-in edge cases", () => {
  it("Continue with Google starts Clerk auth and does not redirect to Sign-up", async () => {
    h.signIn.authenticateWithRedirect = vi.fn(async () => undefined);
    render(<CustomSignInForm />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Continue with Google" })));
    expect(h.signIn.authenticateWithRedirect).toHaveBeenCalledTimes(1);
    expect(h.replaced).toEqual([]);
    expect(h.requests).toEqual([]);
  });

  it("Clerk network failure → error on Sign-in, never the not-registered notice", async () => {
    h.signIn.create = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    render(<CustomSignInForm />);
    await fillSignIn();
    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    expect(h.replaced).toEqual([]);
  });
});

describe("Terms and Conditions", () => {
  const flowBodies: unknown[] = [];
  beforeEach(() => {
    flowBodies.length = 0;
    h.backend["POST /identity/registration/flows"] = (body) => {
      flowBodies.push(body);
      return { status: 201, json: { flowToken: "flow-t" } };
    };
  });

  it("checkbox starts unticked; neither method proceeds without it", async () => {
    h.signUp.create = vi.fn(async () => ({}));
    h.signUp.authenticateWithRedirect = vi.fn(async () => undefined);
    render(<CustomSignUpForm />);
    expect((screen.getByLabelText("I agree to the Terms of Service and Privacy Policy.") as HTMLInputElement).checked).toBe(false);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Continue with Google" })));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Jo Ellis" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jo@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long-password-1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "long-password-1" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create account" })));
    expect(h.signUp.authenticateWithRedirect).not.toHaveBeenCalled();
    expect(h.signUp.create).not.toHaveBeenCalled();
    expect(h.requests).toEqual([]);
    expect(screen.getByText("Please accept the Terms of Service and Privacy Policy to continue.")).toBeInTheDocument();
  });

  it("manual sign-up sends the explicit acceptance and version to the backend and Clerk", async () => {
    createdSession("sess_t1");
    h.signUp.create = vi.fn(async () => ({}));
    h.signUp.prepareEmailAddressVerification = vi.fn(async () => ({}));
    h.signUp.attemptEmailAddressVerification = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_t1" }));
    h.backend["POST /identity/registration/complete"] = () => ({ status: 200, json: { registered: true, alreadyRegistered: false } });
    render(<CustomSignUpForm />);
    await fillSignUp();
    expect(flowBodies).toEqual([{ method: "manual", returnPath: "/", termsAccepted: true, termsVersion: TERMS_VERSION }]);
    expect(h.signUp.create).toHaveBeenCalledWith(expect.objectContaining({ legalAccepted: true }));
    await enterCode();
    expect(h.replaced).toEqual(["/sign-in?notice=registered"]);
  });

  it("Google sign-up sends the explicit acceptance with the flow request", async () => {
    h.signUp.authenticateWithRedirect = vi.fn(async () => undefined);
    render(<CustomSignUpForm />);
    fireEvent.click(screen.getByLabelText("I agree to the Terms of Service and Privacy Policy."));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Continue with Google" })));
    expect(flowBodies).toEqual([{ method: "google", returnPath: "/", termsAccepted: true, termsVersion: TERMS_VERSION }]);
  });

  it("backend refuses outdated Terms → its message, no Clerk account created", async () => {
    h.backend["POST /identity/registration/flows"] = () => ({
      status: 409, json: { detail: { code: "terms_outdated", message: "The Terms of Service or Privacy Policy changed. Please review and accept them again." } },
    });
    h.signUp.create = vi.fn(async () => ({}));
    render(<CustomSignUpForm />);
    await fillSignUp();
    expect(screen.getByText("The Terms of Service or Privacy Policy changed. Please review and accept them again.")).toBeInTheDocument();
    expect(h.signUp.create).not.toHaveBeenCalled();
  });
});

describe("Google sign-up that needs more details", () => {
  it("callback sends missing_requirements to the Sign-up details step (no registration yet)", async () => {
    intent({ purpose: "sign-up", returnPath: "/app", flowToken: "flow-google" });
    h.signUp = { status: "missing_requirements", missingFields: ["legal_accepted"], verifications: {} };
    await runCallback();
    expect(h.replaced).toEqual(["/sign-up?continue=google-details&redirect_url=%2Fapp"]);
    expect(h.requests).toEqual([]);
  });

  it("details step asks only for what is missing, requires the Terms tick, then registers", async () => {
    createdSession("sess_gd");
    h.search = new URLSearchParams("continue=google-details");
    const flowBodies: unknown[] = [];
    h.backend["POST /identity/registration/flows"] = (body) => { flowBodies.push(body); return { status: 201, json: { flowToken: "flow-gd" } }; };
    const completes: unknown[] = [];
    h.backend["POST /identity/registration/complete"] = (body, auth) => {
      completes.push({ body, auth });
      return { status: 200, json: { registered: true, alreadyRegistered: false } };
    };
    h.signUp = {
      status: "missing_requirements",
      missingFields: ["legal_accepted", "first_name"],
      update: vi.fn(async () => ({ status: "complete", createdSessionId: "sess_gd" })),
    };
    render(<CustomSignUpForm />);
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Gee Oogle" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create account" })));
    expect(h.signUp.update).not.toHaveBeenCalled(); // not ticked
    expect(h.requests).toEqual([]);
    fireEvent.click(screen.getByLabelText("I agree to the Terms of Service and Privacy Policy."));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create account" })));
    expect(flowBodies).toEqual([{ method: "google", returnPath: "/", termsAccepted: true, termsVersion: TERMS_VERSION }]);
    expect(h.signUp.update).toHaveBeenCalledWith({ legalAccepted: true, firstName: "Gee", lastName: "Oogle" });
    expect(completes).toEqual([{ body: { flowToken: "flow-gd" }, auth: "Bearer token-for-sess_gd" }]);
    expect(h.setActive).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalledWith({ sessionId: "sess_gd" });
    expect(h.replaced).toEqual(["/sign-in?notice=registered"]);
  });
});


describe("Regression: registered users are not sent to Sign-up", () => {
  it("email linked to an account under another sign-in: specific error, no Sign-up redirect", async () => {
    createdSession("sess_m");
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_m" }));
    h.backend["GET /identity/registration"] = () => ({ status: 409, json: { detail: {
      code: "identity_mismatch",
      message: "This email is linked to an existing X!Y account that uses a different sign-in. Please contact X!Y support - do not create a new account." } } });
    render(<CustomSignInForm />);
    await fillSignIn();
    expect(screen.getByText(/linked to an existing X!Y account that uses a different sign-in/)).toBeInTheDocument();
    expect(h.replaced).toEqual([]);
    expect(h.setActive).not.toHaveBeenCalled();
  });

  it("Google callback: same case goes to Sign-in with its own notice", async () => {
    intent({ purpose: "sign-in", returnPath: "/" });
    createdSession("sess_gm");
    h.signIn = { firstFactorVerification: { status: "verified" }, status: "complete", createdSessionId: "sess_gm" };
    h.backend["GET /identity/registration"] = () => ({ status: 409, json: { detail: { code: "identity_mismatch", message: "x" } } });
    await runCallback();
    expect(h.replaced).toEqual(["/sign-in?notice=account_mismatch"]);
  });

  it("token rejected by the backend (401): retry error, never the Sign-up notice", async () => {
    createdSession("sess_401");
    h.signIn.create = vi.fn(async () => ({ status: "complete", createdSessionId: "sess_401" }));
    h.backend["GET /identity/registration"] = () => ({ status: 401, json: { detail: "Invalid Clerk token" } });
    render(<CustomSignInForm />);
    await fillSignIn();
    expect(screen.getByText("We couldn't confirm your account right now. Please try again.")).toBeInTheDocument();
    expect(h.replaced).toEqual([]);
  });
});
