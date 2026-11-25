"use client";

import { useClerk } from "@clerk/nextjs";
import { useSignIn } from "@clerk/nextjs/legacy";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  acceptInvitation,
  INVITE_MESSAGES,
  INVITE_UNAVAILABLE,
  openInvitation,
} from "@/lib/auth/invitation";
import { onBackendWaking, STARTING_UP_MESSAGE } from "@/lib/auth/registration";
import { withBase } from "@/lib/basePath";

type Phase =
  | { kind: "loading" }
  | { kind: "terms"; companyName: string; contactName: string; email: string }
  | { kind: "message"; tone: "ok" | "warn" | "error"; text: string; signIn?: boolean; retry?: boolean }
  /** After the Terms: how they want to sign in next time (password, Google, or later). */
  | { kind: "sign-in-choice"; returnPath: string; email: string };

/**
 * The page the manufacturer's magic link opens. Steps:
 * 1. ask the backend for a fresh one-time sign-in ticket (the link works until set-up, 14 days);
 * 2. end any other account's session on this browser (shared computers), then sign in with the
 *    ticket: no password;
 * 3. the manufacturer accepts the Terms; the backend makes them owner of their company;
 * 4. they choose how to sign in next time: set a password, use Google, or decide later;
 * 5. on to the dashboard, where they check the details the XfactorY team entered.
 */
export function InviteAcceptance({ code }: { code: string }) {
  const router = useRouter();
  const clerk = useClerk();
  const { isLoaded, signIn, setActive } = useSignIn();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [waking, setWaking] = useState(false);
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => onBackendWaking(setWaking), []);

  useEffect(() => {
    if (!isLoaded || !signIn || !setActive || started.current) return;
    started.current = true;
    (async () => {
      let opened;
      try {
        opened = await openInvitation(code);
      } catch (caught) {
        setPhase({ kind: "message", tone: "error", text: (caught as Error).message || INVITE_UNAVAILABLE, retry: true });
        return;
      }
      if (opened.status !== "open") {
        setPhase({
          kind: "message",
          tone: opened.status === "accepted" ? "ok" : "warn",
          text: INVITE_MESSAGES[opened.status],
          signIn: opened.status === "accepted",
        });
        return;
      }
      const details = { companyName: opened.companyName, contactName: opened.contactName, email: opened.email };
      const current = clerk.user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null;
      if (clerk.session && current === opened.email.toLowerCase()) {
        setPhase({ kind: "terms", ...details }); // already signed in as the invited person
        return;
      }
      if (clerk.session) {
        // Someone else is signed in on this browser: sign them out, then this page opens again.
        await clerk.signOut({ redirectUrl: window.location.href });
        return;
      }
      try {
        const result = await signIn.create({ strategy: "ticket", ticket: opened.ticket });
        if (result.status === "complete" && result.createdSessionId) {
          await setActive({ session: result.createdSessionId });
          setPhase({ kind: "terms", ...details });
          return;
        }
      } catch {
        // falls through to the message below
      }
      setPhase({
        kind: "message",
        tone: "error",
        text: `We couldn't sign you in automatically. Please sign in with ${opened.email} using "Email code" or Google.`,
        signIn: true,
      });
    })();
  }, [isLoaded, signIn, setActive, clerk, code]);

  async function handleAccept(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!consent) {
      setConsentError(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const token = await clerk.session?.getToken();
      if (!token) throw new Error("Your session ended. Please open the link again.");
      const { returnPath } = await acceptInvitation(code, token);
      setBusy(false);
      setPhase({ kind: "sign-in-choice", returnPath, email: phase.kind === "terms" ? phase.email : "" });
    } catch (caught) {
      setError((caught as Error).message || INVITE_UNAVAILABLE);
      setBusy(false);
    }
  }

  if (phase.kind === "sign-in-choice") {
    return <SignInChoice returnPath={phase.returnPath} email={phase.email} onDone={(path) => router.replace(path)} />;
  }

  if (phase.kind === "loading") {
    return (
      <div className="auth-form" aria-busy="true">
        <h1 className="auth-card-heading">Opening your account…</h1>
        <p className="auth-description">{waking ? STARTING_UP_MESSAGE : "This takes a few seconds."}</p>
      </div>
    );
  }

  if (phase.kind === "message") {
    return (
      <div className="auth-form">
        <h1 className="auth-card-heading">Your XfactorY account</h1>
        <div className={`status-box status-${phase.tone} show`} role="status">
          <span>{phase.text}</span>
        </div>
        {phase.signIn ? (
          <Link href="/sign-in" className="primary-cta" style={{ display: "block", textAlign: "center" }}>
            Sign in
          </Link>
        ) : null}
        {phase.retry ? (
          <button type="button" className="primary-cta" onClick={() => window.location.reload()}>
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={handleAccept}>
      <h1 className="auth-card-heading">Welcome{phase.contactName ? `, ${phase.contactName.split(" ")[0]}` : ""}</h1>
      <p className="auth-description">
        The XfactorY team set up an account for <b>{phase.companyName}</b>. You are signed in as {phase.email}, with no
        password needed.
      </p>
      <p className="auth-description">
        Next you will see your company details. Check them, change anything that is not right, then press Confirm
        details.
      </p>
      <div className={`status-box status-error${error ? " show" : ""}`} role="alert">
        <span>{error}</span>
      </div>
      <div className="consent">
        <input
          type="checkbox"
          id="invite-consent"
          checked={consent}
          onChange={(event) => {
            setConsent(event.target.checked);
            setConsentError(false);
          }}
        />
        <label htmlFor="invite-consent">
          I agree to the <Link href="/terms">Terms of Service</Link> and{" "}
          <Link href="/privacy-policy">Privacy Policy</Link>.
        </label>
      </div>
      <div className={`consent-error${consentError ? " show" : ""}`}>
        Please accept the Terms of Service and Privacy Policy to continue.
      </div>
      <button className={`primary-cta${busy ? " loading" : ""}`} disabled={busy}>
        {busy ? "Opening…" : "Open my account"}
      </button>
    </form>
  );
}

const PASSWORD_MIN = 8;

/** Clerk's own message for a refused password (too common, found in a breach…), else ours. */
function clerkMessage(error: unknown, fallback: string): string {
  const first = (error as { errors?: { longMessage?: string; message?: string }[] })?.errors?.[0];
  return first?.longMessage || first?.message || fallback;
}

/**
 * First visit through the magic link, after the Terms: the manufacturer picks how to sign in
 * next time. A password is set on their Clerk account; Google connects their Google account
 * (Clerk then returns them to the dashboard); "Later" goes straight to the dashboard
 * ("Sign-in options" on the dashboard keeps both available).
 */
function SignInChoice({ returnPath, email, onDone }: { returnPath: string; email: string; onDone: (path: string) => void }) {
  const clerk = useClerk();
  const [mode, setMode] = useState<"choose" | "password">("choose");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password.length < PASSWORD_MIN) return setError(`Password must be at least ${PASSWORD_MIN} characters.`);
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    setError("");
    try {
      if (!clerk.user) throw new Error("Your session ended. Please open the link again.");
      await clerk.user.updatePassword({ newPassword: password });
      onDone(returnPath);
    } catch (caught) {
      setError(clerkMessage(caught, (caught as Error)?.message || "We couldn't save the password. Please try again."));
      setBusy(false);
    }
  }

  async function connectGoogle() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!clerk.user) throw new Error("Your session ended. Please open the link again.");
      const account = await clerk.user.createExternalAccount({
        strategy: "oauth_google",
        redirectUrl: `${window.location.origin}${withBase(returnPath)}`,
      });
      const next = account.verification?.externalVerificationRedirectURL;
      if (!next) throw new Error("Google sign-in could not be started. Please try again.");
      window.location.assign(next.toString());
    } catch (caught) {
      setError(clerkMessage(caught, (caught as Error)?.message || "Google sign-in could not be started."));
      setBusy(false);
    }
  }

  if (mode === "password") {
    return (
      <form className="auth-form" onSubmit={savePassword}>
        <h1 className="auth-card-heading">Set your password</h1>
        <p className="auth-description">Next time, sign in with {email || "your email"} and this password.</p>
        <div className={`status-box status-error${error ? " show" : ""}`} role="alert">
          <span>{error}</span>
        </div>
        <div className="field">
          <label htmlFor="invite-password">Password</label>
          <input id="invite-password" type="password" autoComplete="new-password" value={password}
            onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="invite-password-confirm">Confirm password</label>
          <input id="invite-password-confirm" type="password" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button className={`primary-cta${busy ? " loading" : ""}`} disabled={busy}>
          {busy ? "Saving…" : "Save password and continue"}
        </button>
        <button type="button" className="auth-link-button" onClick={() => { setMode("choose"); setError(""); }}>
          Back
        </button>
      </form>
    );
  }

  return (
    <div className="auth-form">
      <h1 className="auth-card-heading">How will you sign in next time?</h1>
      <p className="auth-description">
        Your account is ready. Choose how to sign in when you come back. You can change this later under Sign-in options.
      </p>
      <div className={`status-box status-error${error ? " show" : ""}`} role="alert">
        <span>{error}</span>
      </div>
      <button type="button" className="primary-cta" disabled={busy} onClick={() => setMode("password")}>
        Set a password
      </button>
      <button type="button" className="primary-cta" disabled={busy} onClick={() => void connectGoogle()}>
        {busy ? "Opening Google…" : "Use Google sign-in"}
      </button>
      <button type="button" className="auth-link-button" disabled={busy} onClick={() => onDone(returnPath)}>
        Later, go to my account
      </button>
    </div>
  );
}
