"use client";

import { useClerk } from "@clerk/nextjs";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseClerkError } from "@/lib/auth/clerkErrors";
import { activateRegisteredSession, endSession, tokenForCreatedSession, type ClerkLike } from "@/lib/auth/clerkSession";
import {
  accountStatusForEmail,
  ACCOUNT_EXISTS_MESSAGE,
  completeRegistration,
  noticeFor,
  oauthCallbackUrl,
  rememberOAuthIntent,
  SignUpFlowError,
  startSignUpFlow,
} from "@/lib/auth/registration";
import { safeRedirectPath } from "@/lib/auth/safeRedirect";
import { NEEDS_SECOND_STEP, pickSecondStep, sendSecondStepCode, type SecondStep } from "@/lib/auth/secondFactor";

type FieldErrors = {
  name?: string;
  email?: string;
  password?: string;
  password2?: string;
  code?: string;
  consent?: string;
};

type StatusTone = "error" | "warn" | "ok";

type StatusState = {
  tone: StatusTone;
  message: string;
  /** "sign-in": a Sign-in link follows the message (existing account). */
  action?: "sign-in";
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MIN_LENGTH_ERROR = "Password must be at least 8 characters.";

function StatusIcon({ tone }: { tone: StatusTone }) {
  if (tone === "ok") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <path
          d="M5 8.3L7 10.3L11 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (tone === "warn") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <path d="M8 4.5V8.5L10.5 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M8 4.5V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r="0.9" fill="currentColor" />
    </svg>
  );
}

function FieldError({ message }: { message?: string }) {
  return (
    <div className={`field-error${message ? " show" : ""}`}>
      <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
        <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <path d="M6.5 3.8V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="6.5" cy="9" r="0.7" fill="currentColor" />
      </svg>
      <span>{message}</span>
    </div>
  );
}

function formatPasswordClerkError(message: string): string {
  if (/15\s+characters/i.test(message) || /at least\s+15/i.test(message)) {
    return `${message} Update Clerk Dashboard → User & Authentication → Password: set minimum length to 8.`;
  }

  return message;
}

function validatePasswordLength(value: string): string | null {
  if (!value) {
    return "Please enter a password.";
  }

  if (value.length < PASSWORD_MIN_LENGTH) {
    return PASSWORD_MIN_LENGTH_ERROR;
  }

  return null;
}

function checkPasswordStrength(value: string) {
  if (!value) {
    return { tone: "", label: "" };
  }
  if (value.length < PASSWORD_MIN_LENGTH) {
    return { tone: "weak", label: "Weak password" };
  }
  if (value.length < 12 || !/[A-Z]/.test(value) || !/\d/.test(value)) {
    return { tone: "medium", label: "Medium password" };
  }
  return { tone: "strong", label: "Strong password" };
}

function splitName(fullName: string) {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstName: "", lastName: "" };
  }

  const [firstName, ...rest] = trimmed.split(/\s+/);
  return {
    firstName,
    lastName: rest.join(" "),
  };
}

const START_FAILED = "We couldn't start creating your account right now. Please try again.";
const TERMS_ERROR = "Please accept the Terms of Service and Privacy Policy to continue.";
/** Sign-up with an email that already has an account: stay on Sign-up and say so (with a Sign-in link). */
export const EMAIL_EXISTS = ACCOUNT_EXISTS_MESSAGE;
const flowErrorText = (error: unknown) => (error instanceof SignUpFlowError ? error.message : START_FAILED);

export function CustomSignUpForm({
  redirectTo: checkedRedirect,
  staleSession = false,
}: { redirectTo?: string; staleSession?: boolean } = {}) {
  const { isLoaded, setActive, signUp } = useSignUp();
  const { signIn } = useSignIn();
  const clerk = useClerk() as unknown as ClerkLike;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [consent, setConsent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPassword2, setShowPassword2] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // ?notice=signup_required ("Please sign up first, then sign in to continue.") and other
  // fixed messages; the text is never taken from the URL.
  const [status, setStatus] = useState<StatusState | null>(() => noticeFor(searchParams.get("notice")));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  /** Server-signed token that marks this attempt as an explicit sign-up (needed to register). */
  const flowToken = useRef<string | null>(null);
  /** Clerk finished, XfactorY registration did not (e.g. server unreachable): "Verify" retries it. */
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  /** Existing-account path: the code step is Clerk's second step of a password sign-in. */
  const [secondStep, setSecondStep] = useState<SecondStep | null>(null);
  /** Clerk's "email taken" message, shown again if the existing account is already registered. */
  const existingAccountError = useRef<string | null>(null);

  const redirectTo = useMemo(
    // Checked on the server by the page; only this site's own addresses are allowed.
    () =>
      checkedRedirect ??
      safeRedirectPath(
        searchParams.get("redirect_url"),
        typeof window === "undefined" ? "http://localhost:3000" : window.location.origin,
      ) ??
      "/",
    [checkedRedirect, searchParams],
  );
  const passwordStrength = checkPasswordStrength(password);

  function clearField(field: keyof FieldErrors) {
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  /** "You already have an account. Please sign in." with a Sign-in link; nothing was created. */
  function showAccountExists() {
    setNeedsVerification(false);
    setSecondStep(null);
    setStatus({ tone: "warn", message: EMAIL_EXISTS, action: "sign-in" });
  }

  const signInHref =
    redirectTo && redirectTo !== "/" ? `/sign-in?redirect_url=${encodeURIComponent(redirectTo)}` : "/sign-in";

  // Signed in with an identity that never completed XfactorY sign-up (e.g. sent here by the
  // proxy): end that session so sign-up can run. Only a session present when the page opened.
  const endStaleSession = useRef(staleSession);
  useEffect(() => {
    if (!endStaleSession.current) return;
    endStaleSession.current = false;
    void endSession(clerk);
  }, [clerk]);

  /*
   * Google sign-up that Clerk could not finish ("missing_requirements"), sent back here by
   * /sso-callback with ?continue=google-details. Only the missing existing fields are asked
   * for (Full name, and always the Terms checkbox, unticked); no account exists until it is
   * complete and registered.
   */
  const completingGoogle =
    searchParams.get("continue") === "google-details" && signUp?.status === "missing_requirements";
  const missing = signUp?.missingFields ?? [];
  const needsName = completingGoogle && (missing.includes("first_name") || missing.includes("last_name"));

  async function handleCompleteGoogle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    const nextErrors: FieldErrors = {};
    if (needsName && !name.trim()) nextErrors.name = "Please enter your full name.";
    if (!consent) nextErrors.consent = TERMS_ERROR;
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length || !signUp) return;
    try {
      setIsSubmitting(true);
      let token: string;
      try {
        token = await startSignUpFlow("google", redirectTo, consent);
      } catch (error) {
        setStatus({ tone: "error", message: flowErrorText(error) });
        return;
      }
      const { firstName, lastName } = splitName(name);
      const result = await signUp.update({
        legalAccepted: true,
        ...(needsName ? { firstName, lastName: lastName || undefined } : {}),
      });
      if (result.status === "complete" && result.createdSessionId) {
        flowToken.current = token;
        await finishRegistration(result.createdSessionId);
        return;
      }
      setStatus({
        tone: "error",
        message: "We still need more information to create your account. Please try again or contact XfactorY support.",
      });
    } catch (error) {
      setStatus({ tone: "error", message: parseClerkError(error).message });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function ensureFlowToken(): Promise<string> {
    // Carries the user's explicit Terms acceptance; the backend refuses a token without it.
    if (!flowToken.current) flowToken.current = await startSignUpFlow("manual", redirectTo, consent);
    return flowToken.current;
  }

  /**
   * Clerk created (or, for an existing identity, signed in) the account and its session.
   * Registration is finalized by the backend with that session's token BEFORE the session is
   * ever active; only after the backend confirms it is the session activated and the user
   * sent to the dashboard they came for (safe redirect). Failure: no active session.
   */
  async function finishRegistration(sessionId: string) {
    if (!setActive) return;
    const { token, activated } = await tokenForCreatedSession(clerk, setActive, sessionId);
    let result = await completeRegistration(token, await ensureFlowToken());
    if (!result.ok && (result.code === "flow_expired" || result.code === "invalid_flow" || result.code === "flow_used")) {
      flowToken.current = null; // long pause on the code step, or a second attempt: fresh token once
      result = await completeRegistration(token, await ensureFlowToken());
    }
    if (result.ok) {
      flowToken.current = null; // single use: a later attempt on this page gets its own
      setPendingSession(null);
      if (result.alreadyRegistered && existingAccountError.current) {
        // Existing, already-registered account on the Sign-up page: say so, nothing signed in.
        await endSession(clerk, sessionId);
        existingAccountError.current = null;
        showAccountExists();
        return;
      }
      router.replace(await activateRegisteredSession(clerk, setActive, sessionId, activated, redirectTo));
      return;
    }
    if (result.retryable) {
      // Keep the Clerk session so "Verify email" can retry; nothing is active meanwhile.
      setPendingSession(sessionId);
      setStatus({ tone: "error", message: result.message });
      return;
    }
    setPendingSession(null);
    await endSession(clerk, sessionId);
    setStatus({ tone: "error", message: result.message });
  }

  /**
   * "Email taken" during manual sign-up: the Clerk identity may exist without ever having
   * completed XfactorY sign-up (an older accidental sign-in, or a sign-up whose last step failed).
   * Signing in with the password just entered proves ownership; registration then completes.
   * A wrong password (or a Google-only account) shows Clerk's original message.
   */
  async function registerExistingIdentity(takenMessage: string) {
    if (!signIn) {
      showAccountExists();
      return;
    }
    existingAccountError.current = takenMessage;
    try {
      const result = await signIn.create({ identifier: email.trim(), password });
      if (result.status === "complete" && result.createdSessionId) {
        await finishRegistration(result.createdSessionId);
        return;
      }
      const step = NEEDS_SECOND_STEP.has(result.status ?? "") ? pickSecondStep(result.supportedSecondFactors) : null;
      if (step) {
        await sendSecondStepCode(signIn, step);
        setSecondStep(step);
        setNeedsVerification(true);
        setVerificationCode("");
        setStatus({
          tone: "ok",
          message:
            step.strategy === "totp"
              ? "Enter the code from your authenticator app."
              : "Verification code sent to your email.",
        });
        return;
      }
    } catch {
      // Wrong password, Google-only account, rate limit...: fall back to Clerk's message.
    }
    existingAccountError.current = null;
    showAccountExists();
  }

  function validateForm() {
    const nextErrors: FieldErrors = {};

    if (!name.trim()) {
      nextErrors.name = "Please enter your full name.";
    }

    if (!email.trim()) {
      nextErrors.email = "Please enter your email.";
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = "Please enter a valid email address.";
    }

    const passwordLengthError = validatePasswordLength(password);
    if (passwordLengthError) {
      nextErrors.password = passwordLengthError;
    }

    if (!password2) {
      nextErrors.password2 = "Please confirm your password.";
    } else if (password2 !== password) {
      nextErrors.password2 = "Passwords do not match.";
    }

    if (!consent) {
      nextErrors.consent = "Please accept the Terms of Service and Privacy Policy to continue.";
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function beginVerification() {
    if (!signUp) {
      return;
    }

    await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
    setNeedsVerification(true);
    setStatus({
      tone: "ok",
      message: "Account created. Enter the verification code sent to your email.",
    });
  }

  async function handleCreateAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);

    if (!validateForm() || !isLoaded || !signUp) {
      return;
    }

    const { firstName, lastName } = splitName(name);

    try {
      setIsSubmitting(true);
      // No Clerk account is created while the XfactorY server cannot register it.
      try {
        await ensureFlowToken();
      } catch (error) {
        setStatus({ tone: "error", message: flowErrorText(error) });
        return;
      }

      await signUp.create({
        firstName,
        lastName: lastName || undefined,
        emailAddress: email.trim(),
        password,
        legalAccepted: consent,
      });

      await beginVerification();
    } catch (error) {
      const parsed = parseClerkError(error);

      if (parsed.paramName === "first_name" || parsed.paramName === "last_name") {
        setFieldErrors((current) => ({ ...current, name: parsed.message }));
      } else if (parsed.code === "form_identifier_exists") {
        // One quick question to XfactorY first: a registered account gets the message at once
        // (no Clerk sign-in, no code e-mailed, nothing written). Only a Clerk identity that never
        // finished XfactorY sign-up goes on to the password check that completes its registration.
        if ((await accountStatusForEmail(email.trim())) === "registered") showAccountExists();
        else await registerExistingIdentity(EMAIL_EXISTS);
      } else if (parsed.paramName === "email_address") {
        setFieldErrors((current) => ({ ...current, email: parsed.message }));
      } else if (parsed.paramName === "password") {
        setFieldErrors((current) => ({
          ...current,
          password: formatPasswordClerkError(parsed.message),
        }));
      } else {
        setStatus({ tone: "error", message: formatPasswordClerkError(parsed.message) });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifyEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    clearField("code");

    if (pendingSession) {
      // The code was already accepted; only the XfactorY registration step needs a retry.
      try {
        setIsSubmitting(true);
        await finishRegistration(pendingSession);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!verificationCode.trim() || !isLoaded || !signUp || !setActive) {
      if (!verificationCode.trim()) {
        setFieldErrors((current) => ({
          ...current,
          code: "Please enter the verification code.",
        }));
      }
      return;
    }

    try {
      setIsSubmitting(true);
      if (secondStep && signIn) {
        const signInResult = await signIn.attemptSecondFactor({
          strategy: secondStep.strategy,
          code: verificationCode.trim(),
        });
        if (signInResult.status === "complete" && signInResult.createdSessionId) {
          await finishRegistration(signInResult.createdSessionId);
          return;
        }
        setStatus({ tone: "warn", message: "Verification is still required before continuing." });
        return;
      }

      const result = await signUp.attemptEmailAddressVerification({
        code: verificationCode.trim(),
      });

      if (result.status === "complete" && result.createdSessionId) {
        await finishRegistration(result.createdSessionId);
        return;
      }

      setStatus({
        tone: "warn",
        message: "Verification is still required before continuing.",
      });
    } catch (error) {
      const parsed = parseClerkError(error);
      setFieldErrors((current) => ({ ...current, code: parsed.message }));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendCode() {
    setStatus(null);

    if (!isLoaded || !signUp) {
      return;
    }

    try {
      setIsSubmitting(true);
      if (secondStep && signIn) await sendSecondStepCode(signIn, secondStep);
      else await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setStatus({
        tone: "ok",
        message: "A new verification code has been sent to your email.",
      });
    } catch (error) {
      const parsed = parseClerkError(error);
      setStatus({ tone: "error", message: parsed.message });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleAuth() {
    setStatus(null);

    if (!isLoaded || !signUp) {
      return;
    }

    if (!consent) {
      setFieldErrors((current) => ({
        ...current,
        consent: "Please accept the Terms of Service and Privacy Policy to continue.",
      }));
      return;
    }

    try {
      setIsSubmitting(true);
      let googleFlow: string;
      try {
        googleFlow = await startSignUpFlow("google", redirectTo, consent);
      } catch (error) {
        setStatus({ tone: "error", message: flowErrorText(error) });
        setIsSubmitting(false);
        return;
      }
      // Explicit sign-up intent for the callback, backed by the server-signed token; it travels
      // in the full callback address too (a bare path is resolved by Clerk's servers in
      // production, not by the browser: see oauthCallbackUrl).
      const intent = { purpose: "sign-up", returnPath: redirectTo, flowToken: googleFlow } as const;
      rememberOAuthIntent(intent);
      const callback = oauthCallbackUrl(intent);
      await signUp.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: callback,
        redirectUrlComplete: callback,
        emailAddress: email.trim() || undefined,
        legalAccepted: consent,
      });
    } catch (error) {
      const parsed = parseClerkError(error);
      if (parsed.code === "form_identifier_exists") {
        showAccountExists();
      } else {
        setStatus({ tone: "error", message: parsed.message });
      }
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="auth-form"
      onSubmit={needsVerification ? handleVerifyEmail : completingGoogle ? handleCompleteGoogle : handleCreateAccount}
    >
      <h1 className="auth-card-heading">Create your XfactorY Factory account</h1>

      <div className={`status-box status-${status?.tone ?? "ok"}${status ? " show" : ""}`}>
        <StatusIcon tone={status?.tone ?? "ok"} />
        <span>
          <span>{status?.message}</span>
          {status?.action === "sign-in" && (
            <>
              {" "}
              <Link href={signInHref} className="auth-link-button">
                Sign in
              </Link>
            </>
          )}
        </span>
      </div>

      {/* Always mounted so Clerk bot protection can initialize (custom sign-up flows). */}
      <div id="clerk-captcha" />

      {!needsVerification ? (
        <>
          

          {(!completingGoogle || needsName) && (
          <div className="field">
            <label htmlFor="ca-name">Full name</label>
            <div className="input-wrap">
              <svg className="field-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="5.2" r="2.4" stroke="currentColor" strokeWidth="1.2" fill="none" />
                <path
                  d="M2.8 13.2c0-2.6 2.3-4.2 5.2-4.2s5.2 1.6 5.2 4.2"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
              <input
                type="text"
                id="ca-name"
                placeholder="Jordan Ellis"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  clearField("name");
                }}
                className={fieldErrors.name ? "invalid" : undefined}
                autoComplete="name"
              />
            </div>
            <FieldError message={fieldErrors.name} />
          </div>

          )}
          {!completingGoogle && (
          <>
          <div className="field">
            <label htmlFor="ca-email">Email</label>
            <div className="input-wrap">
              <svg className="field-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M2 4.5h12a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                />
                <path
                  d="M2 5l6 4.2L14 5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <input
                type="email"
                id="ca-email"
                placeholder="you@company.com"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearField("email");
                }}
                className={fieldErrors.email ? "invalid" : undefined}
                autoComplete="email"
              />
            </div>
            <FieldError message={fieldErrors.email} />
          </div>

          <div className="field">
            <label htmlFor="ca-password">Password</label>
            <div className="input-wrap">
              <svg className="field-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <rect
                  x="3.5"
                  y="7"
                  width="9"
                  height="6.5"
                  rx="1.2"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                />
                <path
                  d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                />
              </svg>
              <input
                type={showPassword ? "text" : "password"}
                id="ca-password"
                value={password}
                minLength={PASSWORD_MIN_LENGTH}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearField("password");
                }}
                className={fieldErrors.password ? "invalid" : undefined}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="toggle-visibility"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((current) => !current)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    fill="none"
                  />
                  <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
                </svg>
              </button>
            </div>
            <div className={`pw-meter ${passwordStrength.tone}`} style={{ display: password ? "flex" : "none" }}>
              <i />
              <i />
              <i />
            </div>
            <span className="pw-meter-label" style={{ display: password ? "block" : "none" }}>
              {passwordStrength.label}
            </span>
            <FieldError message={fieldErrors.password} />
          </div>

          <div className="field">
            <label htmlFor="ca-password2">Confirm password</label>
            <div className="input-wrap">
              <svg className="field-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <rect
                  x="3.5"
                  y="7"
                  width="9"
                  height="6.5"
                  rx="1.2"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                />
                <path
                  d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                />
              </svg>
              <input
                type={showPassword2 ? "text" : "password"}
                id="ca-password2"
                value={password2}
                minLength={PASSWORD_MIN_LENGTH}
                onChange={(event) => {
                  setPassword2(event.target.value);
                  clearField("password2");
                }}
                className={fieldErrors.password2 ? "invalid" : undefined}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="toggle-visibility"
                aria-label={showPassword2 ? "Hide password" : "Show password"}
                onClick={() => setShowPassword2((current) => !current)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    fill="none"
                  />
                  <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
                </svg>
              </button>
            </div>
            <FieldError message={fieldErrors.password2} />
          </div>
<div className="divider">OR</div>
          <button
            type="button"
            className="provider-btn"
            onClick={handleGoogleAuth}
            disabled={isSubmitting || !isLoaded}
          >
            <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9a8.7 8.7 0 0 0 2.7-6.62z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.55-1.84.87-3.06.87-2.36 0-4.36-1.6-5.07-3.75H.9v2.33A9 9 0 0 0 9 18z"
              />
              <path
                fill="#FBBC05"
                d="M3.93 10.68A5.4 5.4 0 0 1 3.64 9c0-.58.1-1.15.29-1.68V4.99H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.01l3.03-2.33z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .9 4.99l3.03 2.33C4.64 5.18 6.64 3.58 9 3.58z"
              />
            </svg>
            Continue with Google
          </button>


          </>
          )}
          <div className="consent">
            <input
              type="checkbox"
              id="ca-consent"
              checked={consent}
              onChange={(event) => {
                setConsent(event.target.checked);
                clearField("consent");
              }}
            />
            <label htmlFor="ca-consent">
              I agree to the Terms of Service and Privacy Policy.
            </label>
          </div>
          <div className={`consent-error${fieldErrors.consent ? " show" : ""}`}>
            <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <path d="M6.5 3.8V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="6.5" cy="9" r="0.7" fill="currentColor" />
            </svg>
            {fieldErrors.consent}
          </div>
          <div className="consent-versions">Terms v1.2 · Privacy Policy v1.4</div>

          <div className="permission-note">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <path d="M7 4.6V7.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="7" cy="9.6" r="0.7" fill="currentColor" />
            </svg>
            <span>
              Your marketplace role does not determine your permissions — that&apos;s set
              separately once you&apos;re in.
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="auth-verification-note">
            Enter the verification code sent to <strong>{email}</strong> to continue.
          </div>

          <div className="field">
            <label htmlFor="ca-code">Verification code</label>
            <div className="input-wrap">
              <input
                type="text"
                id="ca-code"
                placeholder="123456"
                value={verificationCode}
                onChange={(event) => {
                  setVerificationCode(event.target.value);
                  clearField("code");
                }}
                className={fieldErrors.code ? "invalid auth-code-input" : "auth-code-input"}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </div>
            <FieldError message={fieldErrors.code} />
          </div>

          <div className="auth-verification-actions">
            <button
              type="button"
              className="auth-link-button"
              onClick={handleResendCode}
              disabled={isSubmitting || !isLoaded}
            >
              Resend code
            </button>
          </div>
        </>
      )}

      <button className={`primary-cta${isSubmitting ? " loading" : ""}`} disabled={isSubmitting || !isLoaded}>
        {isSubmitting ? (
          <>
            <span className="spinner" aria-hidden="true" />
            {needsVerification ? "Verifying…" : "Creating account…"}
          </>
        ) : needsVerification ? (
          "Verify email"
        ) : (
          "Create account"
        )}
      </button>

      <div className="switch-row">
        Already have an account?{" "}
        <Link href={signInHref}>Sign in</Link>
      </div>
    </form>
  );
}
