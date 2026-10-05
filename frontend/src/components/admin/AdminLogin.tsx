"use client";

import { Eye, EyeOff, Info, KeyRound, Lock, Mail, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { FactoryMark } from "@/components/layout/Logo";
import { useAdminHost } from "@/lib/admin/api";
import { clearAdminSession, saveAdminSession } from "@/lib/admin/session";
import { api, ApiError } from "@/lib/api";

type Method = "password" | "clerk";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * /admin/login — two ways in:
 * - Admin account: email + password created by an X!Y administrator (checked by the backend).
 * - X!Y account: the normal X!Y (Clerk) email + password; the account must have admin access.
 */
export function AdminLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const host = useAdminHost();
  const [method, setMethod] = useState<Method>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState("");
  // Clerk asked for a one-time code (new device / two-step verification): the message to show.
  const [codeStep, setCodeStep] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [resent, setResent] = useState(false);
  const expired = host.search.get("expired") === "1";

  function switchTo(m: Method) {
    setMethod(m);
    setError("");
    setFieldErr({});
    leaveCodeStep();
  }

  function leaveCodeStep() {
    setCodeStep(null);
    setCode("");
    setCodeErr("");
    setResent(false);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setCodeErr("");
    if (!/^\d{6}$/.test(code.trim())) {
      setCodeErr("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      const res = await host.clerkVerifyCode(code);
      if (!res.ok) {
        setCodeErr(res.message);
        return;
      }
      clearAdminSession();
      setPassword("");
      leaveCodeStep();
      onSignedIn();
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setCodeErr("");
    setResent(false);
    try {
      await host.clerkResendCode();
      setResent(true);
    } catch {
      setCodeErr("Could not send a new code. Wait a moment and try again.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const errs: typeof fieldErr = {};
    if (!email.trim()) errs.email = "Enter your email.";
    else if (!EMAIL.test(email.trim())) errs.email = "Enter a valid email address.";
    if (!password) errs.password = "Enter your password.";
    setFieldErr(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      if (method === "password") {
        const res = await api<{ token: string; expiresAt: string }>("/admin/auth/login", "", {
          method: "POST",
          body: JSON.stringify({ email: email.trim(), password }),
        });
        saveAdminSession({ token: res.token, expiresAt: res.expiresAt });
        setPassword("");
        onSignedIn();
      } else {
        const res = await host.clerkSignIn(email.trim(), password);
        if (!res.ok) {
          if ("needsCode" in res) setCodeStep(res.message);
          else if (res.field === "email" || res.field === "password") setFieldErr({ [res.field]: res.message });
          else setError(res.message);
          return;
        }
        clearAdminSession();
        setPassword("");
        onSignedIn();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) setError("Cannot reach the X!Y server. Check your connection and try again.");
      else setError(err instanceof Error ? err.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-login">
      <div className="card adm-login-card">
        <div className="adm-login-brand">
          <FactoryMark className="topbar-factory-mark" />
          <span>X!Y</span>
          <span className="topbar-crumb">Admin</span>
        </div>
        <h1 className="adm-login-title">Sign in to the admin dashboard</h1>
        <p className="adm-login-sub">For authorized X!Y staff only.</p>

        <div className="adm-login-switch" role="tablist" aria-label="Sign-in method">
          <button
            type="button"
            role="tab"
            aria-selected={method === "password"}
            className={method === "password" ? "active" : ""}
            onClick={() => switchTo("password")}
          >
            <KeyRound size={15} /> Admin account
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={method === "clerk"}
            className={method === "clerk" ? "active" : ""}
            onClick={() => switchTo("clerk")}
          >
            <UserRound size={15} /> X!Y account
          </button>
        </div>

        {expired && !error && (
          <div className="adm-login-note" role="status">
            <Info size={16} /> Your session ended. Please sign in again.
          </div>
        )}

        {method === "clerk" && host.clerkEmail ? (
          <div className="adm-login-continue">
            <p>
              You are signed in to X!Y as <b>{host.clerkEmail}</b>.
            </p>
            <button type="button" className="btn-primary adm-login-submit" onClick={onSignedIn}>
              Continue as {host.clerkEmail}
            </button>
            <button
              type="button"
              className="btn-text"
              onClick={async () => {
                await host.clerkSignOut();
              }}
            >
              Use a different X!Y account
            </button>
          </div>
        ) : method === "clerk" && codeStep ? (
          <form onSubmit={verifyCode} noValidate>
            <div className="adm-login-note" role="status">
              <ShieldCheck size={16} /> {codeStep} This is needed when you sign in on a new device.
            </div>
            <div className="adm-login-field">
              <label htmlFor="adm-code">Verification code</label>
              <div className="input-wrap">
                <span className="input-icon">
                  <KeyRound size={16} />
                </span>
                <input
                  id="adm-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className={`has-icon${codeErr ? " error" : ""}`}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, ""));
                    setCodeErr("");
                  }}
                  placeholder="6-digit code"
                  autoFocus
                />
              </div>
              {codeErr && <p className="field-error">{codeErr}</p>}
              {resent && !codeErr && <p className="field-hint">A new code was sent.</p>}
            </div>
            <button type="submit" className="btn-primary adm-login-submit" disabled={busy}>
              {busy ? "Verifying…" : "Verify and sign in"}
            </button>
            <button type="button" className="btn-text" onClick={() => void resendCode()} disabled={busy}>
              Send a new code
            </button>
            <button type="button" className="btn-text" onClick={leaveCodeStep} disabled={busy}>
              Back
            </button>
          </form>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="adm-login-field">
              <label htmlFor="adm-email">Email</label>
              <div className="input-wrap">
                <span className="input-icon">
                  <Mail size={16} />
                </span>
                <input
                  id="adm-email"
                  type="email"
                  className={`has-icon${fieldErr.email ? " error" : ""}`}
                  autoComplete="username"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setFieldErr((f) => ({ ...f, email: undefined }));
                  }}
                  placeholder="you@company.com"
                  autoFocus
                />
              </div>
              {fieldErr.email && <p className="field-error">{fieldErr.email}</p>}
            </div>
            <div className="adm-login-field">
              <label htmlFor="adm-password">Password</label>
              <div className="input-wrap">
                <span className="input-icon">
                  <Lock size={16} />
                </span>
                <input
                  id="adm-password"
                  type={show ? "text" : "password"}
                  className={`has-icon adm-pw-input${fieldErr.password ? " error" : ""}`}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFieldErr((f) => ({ ...f, password: undefined }));
                  }}
                />
                <button
                  type="button"
                  className="adm-pw-toggle"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {fieldErr.password && <p className="field-error">{fieldErr.password}</p>}
            </div>
            {error && (
              <div className="adm-error adm-login-error" role="alert">
                {error}
              </div>
            )}
            <button type="submit" className="btn-primary adm-login-submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        <p className="adm-login-hint">
          {method === "password"
            ? "Use the admin email and password given to you by an X!Y administrator. Forgot it? Ask an administrator to reset it."
            : "Use the email and password of your X!Y account. It must have admin access."}
        </p>
      </div>
      <p className="adm-login-foot">
        <ShieldCheck size={14} /> Sign-ins are logged. Never share your password.
      </p>
    </div>
  );
}
