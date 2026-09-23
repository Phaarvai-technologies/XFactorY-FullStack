"use client";

import { useSignIn } from "@clerk/nextjs/legacy";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { parseClerkError } from "@/lib/auth/clerkErrors";

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

export function CustomSignInForm() {
  const { isLoaded, setActive, signIn } = useSignIn();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<StatusState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const redirectTo = useMemo(
    () => searchParams.get("redirect_url") || "/",
    [searchParams],
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

  async function handleGoogleAuth() {
    setStatus(null);

    if (!isLoaded || !signIn) {
      return;
    }

    try {
      setIsSubmitting(true);
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: redirectTo,
      });
    } catch (error) {
      const parsed = parseClerkError(error);
      setStatus({ tone: "error", message: parsed.message });
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <h1 className="auth-card-heading">Welcome back</h1>

      <div className={`status-box status-${status?.tone ?? "error"}${status ? " show" : ""}`}>
        <StatusIcon tone={status?.tone ?? "error"} />
        <span>{status?.message}</span>
      </div>

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
          <Link href="#" className="link-inline">
            Forgot password?
          </Link>
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
    </form>
  );
}
