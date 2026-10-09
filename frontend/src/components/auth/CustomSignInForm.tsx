"use client";

import { useSignIn } from "@clerk/nextjs/legacy";
import { withBase } from "@/lib/basePath";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { parseClerkError } from "@/lib/auth/clerkErrors";
import { safeRedirectPath } from "@/lib/auth/safeRedirect";

type FieldErrors = {
  email?: string;
  password?: string;
};

type StatusTone = "error" | "warn" | "ok";

type StatusState = {
  tone: StatusTone;
  message: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export function CustomSignInForm({ redirectTo: checkedRedirect }: { redirectTo?: string } = {}) {
  const { isLoaded, setActive, signIn } = useSignIn();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<StatusState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetStep, setResetStep] = useState<"email" | "code" | "password">("email");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // New-device verification (Clerk Device Trust / two-step verification): the code step
  // shown after a correct password. `null` = not needed.
  const [deviceStep, setDeviceStep] = useState<DeviceStep | null>(null);
  const [deviceCode, setDeviceCode] = useState("");

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

  function clearField(field: keyof FieldErrors) {
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  function validateFields() {
    const nextErrors: FieldErrors = {};

    if (!email.trim()) {
      nextErrors.email = "Please enter your email.";
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = "Please enter a valid email address.";
    }

    if (!password) {
      nextErrors.password = "Please enter your password.";
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);

    if (!validateFields() || !isLoaded || !signIn || !setActive) {
      return;
    }

    try {
      setIsSubmitting(true);

      const result = await signIn.create({
        identifier: email.trim(),
        password,
      });

      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        router.push(redirectTo);
        router.refresh();
        return;
      }

      const step =
        result.status === "needs_client_trust" || result.status === "needs_second_factor"
          ? pickDeviceStep(result.supportedSecondFactors)
          : null;
      if (step) {
        await sendDeviceCode(signIn, step);
        setDeviceStep(step);
        setDeviceCode("");
        setStatus({
          tone: "ok",
          message:
            step.strategy === "totp"
              ? "Enter the code from your authenticator app."
              : "Verification code sent to your email.",
        });
        return;
      }

      setStatus({
        tone: "warn",
        message: "Additional verification is required before you can continue.",
      });
    } catch (error) {
      const parsed = parseClerkError(error);

      if (
        parsed.paramName === "identifier" ||
        parsed.paramName === "email_address" ||
        parsed.code === "form_identifier_not_found"
      ) {
        setFieldErrors((current) => ({ ...current, email: parsed.message }));
      } else if (
        parsed.paramName === "password" ||
        parsed.code === "form_password_incorrect"
      ) {
        setFieldErrors((current) => ({ ...current, password: parsed.message }));
      } else if (parsed.code === "session_exists") {
        router.push(redirectTo);
        router.refresh();
        return;
      } else if (parsed.code === "too_many_requests") {
        setStatus({ tone: "warn", message: parsed.message });
      } else {
        setStatus({ tone: "error", message: parsed.message });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleForgotPassword() {
  setStatus(null);

  const trimmedEmail = email.trim();

  if (!trimmedEmail) {
    setFieldErrors((current) => ({
      ...current,
      email: "Please enter your email first.",
    }));
    return;
  }

  if (!EMAIL_PATTERN.test(trimmedEmail)) {
    setFieldErrors((current) => ({
      ...current,
      email: "Please enter a valid email address.",
    }));
    return;
  }

  if (!isLoaded || !signIn) {
    return;
  }

  try {
    setIsResettingPassword(true);

    await signIn.create({
      strategy: "reset_password_email_code",
      identifier: trimmedEmail,
    });

    setResetStep("code");

    setStatus({
      tone: "ok",
      message: "Password reset code sent to your email.",
    });
  } catch (error) {
    const parsed = parseClerkError(error);

    setStatus({
      tone: "error",
      message: parsed.message,
    });
  } finally {
    setIsResettingPassword(false);
  }
}

async function handleResetCode() {
  setStatus(null);

  if (!resetCode.trim()) {
    setStatus({
      tone: "error",
      message: "Please enter the verification code.",
    });
    return;
  }

  if (!isLoaded || !signIn) {
    return;
  }

  try {
    setIsResettingPassword(true);

    const result = await signIn.attemptFirstFactor({
      strategy: "reset_password_email_code",
      code: resetCode.trim(),
    });

    if (result.status === "needs_new_password") {
      setResetStep("password");

      setStatus({
        tone: "ok",
        message: "Code verified. Please create your new password.",
      });
    } else {
      setStatus({
        tone: "warn",
        message: "Additional verification is required before you can continue.",
      });
    }
  } catch (error) {
    const parsed = parseClerkError(error);

    setStatus({
      tone: "error",
      message: parsed.message,
    });
  } finally {
    setIsResettingPassword(false);
  }
}

async function handleNewPassword() {
  setStatus(null);

  if (!newPassword) {
    setStatus({
      tone: "error",
      message: "Please enter a new password.",
    });
    return;
  }

  if (newPassword.length < 8) {
    setStatus({
      tone: "error",
      message: "Password must be at least 8 characters.",
    });
    return;
  }

  if (newPassword !== confirmPassword) {
    setStatus({
      tone: "error",
      message: "Passwords do not match.",
    });
    return;
  }

  if (!isLoaded || !signIn || !setActive) {
    return;
  }

  try {
    setIsResettingPassword(true);

    const result = await signIn.resetPassword({
      password: newPassword,
    });

    if (result.status === "complete" && result.createdSessionId) {
      await setActive({
        session: result.createdSessionId,
      });

      router.push(redirectTo);
      router.refresh();
    } else {
      setStatus({
        tone: "warn",
        message: "Password changed. Please sign in with your new password.",
      });
      setResetStep("email");
      setPassword("");
    }
  } catch (error) {
    const parsed = parseClerkError(error);

    setStatus({
      tone: "error",
      message: parsed.message,
    });
  } finally {
    setIsResettingPassword(false);
  }
}

async function handleDeviceCode() {
  setStatus(null);

  if (!deviceCode.trim()) {
    setStatus({
      tone: "error",
      message: "Please enter the verification code.",
    });
    return;
  }

  if (!isLoaded || !signIn || !setActive || !deviceStep) {
    return;
  }

  try {
    setIsSubmitting(true);

    const result = await signIn.attemptSecondFactor({
      strategy: deviceStep.strategy,
      code: deviceCode.trim(),
    });

    if (result.status === "complete" && result.createdSessionId) {
      await setActive({ session: result.createdSessionId });
      router.push(redirectTo);
      router.refresh();
      return;
    }

    setStatus({
      tone: "warn",
      message: "Additional verification is required before you can continue.",
    });
  } catch (error) {
    const parsed = parseClerkError(error);

    if (parsed.code === "session_exists") {
      router.push(redirectTo);
      router.refresh();
      return;
    }

    setStatus({
      tone: "error",
      message: parsed.message,
    });
  } finally {
    setIsSubmitting(false);
  }
}

async function handleResendDeviceCode() {
  setStatus(null);

  if (!isLoaded || !signIn || !deviceStep) {
    return;
  }

  try {
    setIsSubmitting(true);
    await sendDeviceCode(signIn, deviceStep);
    setStatus({
      tone: "ok",
      message: "A new verification code has been sent.",
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

    if (!isLoaded || !signIn) {
      return;
    }

    try {
      setIsSubmitting(true);
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: withBase("/sso-callback"),
        redirectUrlComplete: withBase(redirectTo),
      });
    } catch (error) {
      const parsed = parseClerkError(error);
      setStatus({ tone: "error", message: parsed.message });
      setIsSubmitting(false);
    }
  }

  return (
    <form
  className="auth-form"
  onSubmit={
    deviceStep
      ? (event) => {
          event.preventDefault();
          handleDeviceCode();
        }
      : resetStep === "code"
      ? (event) => {
          event.preventDefault();
          handleResetCode();
        }
      : resetStep === "password"
        ? (event) => {
            event.preventDefault();
            handleNewPassword();
          }
        : handleSubmit
  }
>

      <div className={`status-box status-${status?.tone ?? "error"}${status ? " show" : ""}`}>
        <StatusIcon tone={status?.tone ?? "error"} />
        <span>{status?.message}</span>
      </div>

      {resetStep === "email" && !deviceStep && (
  <>
      <h1 className="auth-card-heading">Welcome back</h1>
  
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

      <div className="divider">OR</div>

      <div className="field">
        <label htmlFor="si-email">Email</label>
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
            id="si-email"
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
        <div className="field-row-between">
          <label htmlFor="si-password" style={{ marginBottom: 0 }}>
            Password
          </label>
          <button
              type="button"
              className="link-inline"
              onClick={handleForgotPassword}
              disabled={isResettingPassword || !isLoaded}
           >
              {isResettingPassword ? "Sending..." : "Forgot password?"}
           </button>
        </div>
        <div className="input-wrap auth-input-spaced">
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
            id="si-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              clearField("password");
            }}
            className={fieldErrors.password ? "invalid" : undefined}
            autoComplete="current-password"
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
        <FieldError message={fieldErrors.password} />
      </div>

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

      <button className={`primary-cta${isSubmitting ? " loading" : ""}`} disabled={isSubmitting || !isLoaded}>
        {isSubmitting ? (
          <>
            <span className="spinner" aria-hidden="true" />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </button>

      <div className="switch-row">
        Don&apos;t have an account?{" "}
        <Link
          href={
            redirectTo && redirectTo !== "/"
              ? `/sign-up?redirect_url=${encodeURIComponent(redirectTo)}`
              : "/sign-up"
          }
        >
          Create account
        </Link>
      </div>
  </>

  )}


  

      {resetStep === "email" && deviceStep && (
  <>
    <h1 className="auth-card-heading">Verify it&apos;s you</h1>

    <p className="auth-description">
      {deviceStep.strategy === "totp" ? (
        <>Enter the code from your authenticator app to sign in as <strong>{email}</strong>.</>
      ) : (
        <>
          You&apos;re signing in on a new device. Enter the verification code sent to{" "}
          <strong>{deviceStep.sentTo || email}</strong>.
        </>
      )}
    </p>

    <div className="field">
      <label htmlFor="device-code">Verification code</label>

      <input
        type="text"
        id="device-code"
        value={deviceCode}
        onChange={(event) => setDeviceCode(event.target.value)}
        placeholder="Enter verification code"
        autoComplete="one-time-code"
        inputMode="numeric"
      />
    </div>

    <button
      type="submit"
      className={`primary-cta${isSubmitting ? " loading" : ""}`}
      disabled={isSubmitting || !isLoaded}
    >
      {isSubmitting ? "Verifying..." : "Verify and sign in"}
    </button>

    {deviceStep.strategy !== "totp" && (
      <button
        type="button"
        className="link-inline"
        onClick={handleResendDeviceCode}
        disabled={isSubmitting || !isLoaded}
      >
        Resend code
      </button>
    )}

    <button
      type="button"
      className="link-inline"
      onClick={() => {
        setDeviceStep(null);
        setDeviceCode("");
        setStatus(null);
      }}
    >
      Back to sign in
    </button>
  </>
)}

      {resetStep === "code" && (
  <>
    <h1 className="auth-card-heading">Verify your email</h1>

    <p className="auth-description">
      Enter the verification code sent to{" "}
      <strong>{email}</strong>.
    </p>

    <div className="field">
      <label htmlFor="reset-code">Verification code</label>

      <input
        type="text"
        id="reset-code"
        value={resetCode}
        onChange={(event) => setResetCode(event.target.value)}
        placeholder="Enter verification code"
        autoComplete="one-time-code"
        inputMode="numeric"
      />
    </div>

    <button
      type="submit"
      className={`primary-cta${isResettingPassword ? " loading" : ""}`}
      disabled={isResettingPassword || !isLoaded}
    >
      {isResettingPassword ? "Verifying..." : "Verify code"}
    </button>

    <button
      type="button"
      className="link-inline"
      onClick={() => {
        setResetStep("email");
        setResetCode("");
        setStatus(null);
      }}
    >
      Back to sign in
    </button>
  </>
)}


{resetStep === "password" && (
  <>
    <h1 className="auth-card-heading">Create a new password</h1>

    <p className="auth-description">
      Enter your new password below.
    </p>

    <div className="field">
      <label htmlFor="new-password">New password</label>

      <input
        type="password"
        id="new-password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        placeholder="Enter new password"
        autoComplete="new-password"
      />
    </div>

    <div className="field">
      <label htmlFor="confirm-password">Confirm password</label>

      <input
        type="password"
        id="confirm-password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        placeholder="Confirm new password"
        autoComplete="new-password"
      />
    </div>

    <button
      type="submit"
      className={`primary-cta${isResettingPassword ? " loading" : ""}`}
      disabled={isResettingPassword || !isLoaded}
    >
      {isResettingPassword ? "Changing password..." : "Change password"}
    </button>

    <button
      type="button"
      className="link-inline"
      onClick={() => {
        setResetStep("code");
        setStatus(null);
      }}
    >
      Back to verification code
    </button>
  </>
)}

      
    </form>
  );
}

// ---------------------------------------------------------------------------
// New-device verification (Clerk Device Trust) helpers.
// Clerk asks for a code after a correct password on a new device/browser.

type SignInResource = NonNullable<ReturnType<typeof useSignIn>["signIn"]>;
type SecondFactor = NonNullable<SignInResource["supportedSecondFactors"]>[number];
type DeviceStep = { strategy: "email_code" | "phone_code" | "totp"; id?: string; sentTo?: string };

/** Email code first (what Device Trust uses), then text message, then authenticator app. */
function pickDeviceStep(factors: SecondFactor[] | null | undefined): DeviceStep | null {
  const list = factors ?? [];
  for (const f of list) {
    if (f.strategy === "email_code") return { strategy: "email_code", id: f.emailAddressId, sentTo: f.safeIdentifier };
  }
  for (const f of list) {
    if (f.strategy === "phone_code") return { strategy: "phone_code", id: f.phoneNumberId, sentTo: f.safeIdentifier };
  }
  if (list.some((f) => f.strategy === "totp")) return { strategy: "totp" };
  return null;
}

/** Asks Clerk to send the email / text code (authenticator apps need nothing). */
async function sendDeviceCode(signIn: SignInResource, step: DeviceStep): Promise<void> {
  if (step.strategy === "email_code") {
    await signIn.prepareSecondFactor({ strategy: "email_code", emailAddressId: step.id });
  } else if (step.strategy === "phone_code") {
    await signIn.prepareSecondFactor({ strategy: "phone_code", phoneNumberId: step.id });
  }
}