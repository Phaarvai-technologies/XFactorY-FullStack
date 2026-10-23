"use client";

import { useClerk } from "@clerk/nextjs";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { activateRegisteredSession, endSession, tokenForCreatedSession, type ClerkLike } from "@/lib/auth/clerkSession";
import {
  authPageHref,
  checkRegistration,
  completeRegistration,
  takeOAuthIntent,
  type OAuthIntent,
} from "@/lib/auth/registration";
import { safeRedirectPath } from "@/lib/auth/safeRedirect";

/**
 * Return point for "Continue with Google" on both Sign-in and Sign-up.
 *
 * This replaces `clerk.handleRedirectCallback({})`. With the installed Clerk SDK
 * (@clerk/nextjs 7.9.8 → clerk-js 6) its `transferable` option defaults to `true`: an
 * unknown Google account on the Sign-in page is silently turned into a new Clerk sign-up
 * (an "opaque sign-up"), and the session is activated before XfactorY is asked anything.
 *
 * Here, following Clerk's documented account-transfer checks:
 * - Sign-in with an unknown Google account → no transfer, no account: go to Sign-up with
 *   "Please sign up first, then sign in to continue."
 * - Sign-in with an existing account → the backend must confirm XfactorY registration before the
 *   session is activated; unregistered → session ended, sent to Sign-up.
 * - Sign-up (new Google account, or an existing one Clerk transfers to sign-in) → XfactorY
 *   registration is completed with the server-signed sign-up token; only once the backend
 *   confirms it is the session activated and the user sent to the dashboard (safe
 *   redirect). Not finalized → session ended, Sign-up shows the error; no access.
 * - Sign-up with a Google account that already has a REGISTERED XfactorY account → nothing is created
 *   or changed: session ended, Sign-up shows "You already have an account. Please sign in."
 * The intent (from the callback address, else this tab's storage) only picks which branch to
 * finish; it grants nothing by itself. If Clerk never answers, the page gives up after
 * CALLBACK_TIMEOUT_MS with "Google sign-in didn't complete" instead of spinning forever.
 */
const CALLBACK_TIMEOUT_MS = 45000;

export default function SsoCallbackPage() {
  const clerk = useClerk() as unknown as ClerkLike;
  const { isLoaded: signInLoaded, signIn, setActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const router = useRouter();
  const ran = useRef(false);
  const settled = useRef(false);

  // Clerk did not load / answer at all (blocked script, network): leave with an error.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (settled.current) return;
      settled.current = true;
      router.replace(authPageHref("/sign-in", null, "oauth_failed"));
    }, CALLBACK_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [router]);

  useEffect(() => {
    if (ran.current || !signInLoaded || !signUpLoaded || !signIn || !signUp || !setActive) return;
    ran.current = true;

    const intent: OAuthIntent =
      takeOAuthIntent(new URLSearchParams(window.location.search)) ?? { purpose: "sign-in", returnPath: "/" };
    const origin = window.location.origin;
    const returnPath = safeRedirectPath(intent.returnPath, origin) ?? "/";
    const go = (href: string) => {
      if (settled.current) return; // the timeout already left this page
      settled.current = true;
      router.replace(href);
    };

    async function finishSignIn(sessionId: string) {
      const { token, activated } = await tokenForCreatedSession(clerk, setActive!, sessionId);
      const check = await checkWithRetry(sessionId, token);
      if (check.state === "registered") {
        if (!activated) await setActive!({ session: sessionId });
        go(returnPath);
        return;
      }
      await endSession(clerk, sessionId);
      if (check.state === "unregistered") go(authPageHref("/sign-up", returnPath, "signup_required"));
      else if (check.state === "blocked")
        go(authPageHref("/sign-in", returnPath, check.code === "identity_mismatch" ? "account_mismatch" : "suspended"));
      else go(authPageHref("/sign-in", returnPath, "unavailable"));
    }

    /** A newly issued token for the session (the one Clerk minted during the Google redirect can
     * be refused by the backend, e.g. its authorized party is not this site's address). */
    async function freshToken(sessionId: string): Promise<string | null> {
      const session = clerk.client?.sessions?.find((s) => s.id === sessionId) ??
        (clerk.session?.id === sessionId ? clerk.session : null);
      try {
        return (await session?.getToken({ skipCache: true })) ?? null;
      } catch {
        return null;
      }
    }

    /** Registration check; "could not confirm" (token refused, server blip) is retried with a
     * fresh token before giving up. "Not registered" / "blocked" are final answers. */
    async function checkWithRetry(sessionId: string, token: string | null) {
      let check = await checkRegistration(token);
      for (let attempt = 1; check.state === "error" && attempt <= 2; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        check = await checkRegistration((await freshToken(sessionId)) ?? token);
      }
      return check;
    }

    async function finishSignUp(sessionId: string, flowToken: string) {
      const { token, activated } = await tokenForCreatedSession(clerk, setActive!, sessionId);
      let result = await completeRegistration(token, flowToken);
      // First Google sign-up: a refused / transient answer is retried with a fresh token (the
      // backend call is idempotent), instead of failing once and working on the second try.
      for (let attempt = 1; !result.ok && result.retryable && attempt <= 2; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        result = await completeRegistration((await freshToken(sessionId)) ?? token, flowToken);
      }
      if (result.ok) {
        // Registration confirmed by the backend (new, or an existing XfactorY user): signed in.
        go(await activateRegisteredSession(clerk, setActive!, sessionId, activated, returnPath));
        return;
      }
      // Not finalized: no active session, no access; Sign-up shows the existing error.
      console.warn("[XfactorY] Google sign-up not completed:", result.code ?? "unknown", result.message);
      await endSession(clerk, sessionId);
      go(authPageHref("/sign-up", returnPath, "signup_failed"));
    }

    /**
     * Sign-up with a Google account Clerk already knows (transferred to a sign-in). Already a
     * registered XfactorY user: nothing is created or changed, the session is ended and Sign-up says
     * "You already have an account. Please sign in." A Clerk identity that never finished XfactorY
     * sign-up: registration completes now with this sign-up's token (Terms accepted).
     */
    async function finishExistingOnSignUp(sessionId: string, flowToken: string) {
      const { token } = await tokenForCreatedSession(clerk, setActive!, sessionId);
      const check = await checkWithRetry(sessionId, token);
      if (check.state === "unregistered") return finishSignUp(sessionId, flowToken);
      await endSession(clerk, sessionId);
      if (check.state === "registered") go(authPageHref("/sign-up", returnPath, "account_exists"));
      else if (check.state === "blocked")
        go(authPageHref("/sign-in", returnPath, check.code === "identity_mismatch" ? "account_mismatch" : "suspended"));
      else go(authPageHref("/sign-up", returnPath, "unavailable"));
    }

    async function run() {
      if (intent.purpose === "sign-up") {
        const external = signUp!.verifications?.externalAccount;
        // Clerk case 1: the Google account already belongs to a Clerk user → transfer to sign-in.
        if (external?.status === "transferable") {
          const res = await signIn!.create({ transfer: true });
          if (res.status === "complete" && res.createdSessionId) {
            return finishExistingOnSignUp(res.createdSessionId, intent.flowToken);
          }
          if (res.status === "needs_second_factor" || res.status === "needs_client_trust") {
            // Sign-in finishes on the sign-in page; registration then needs a new Sign-up.
            return go(authPageHref("/sign-in", returnPath, undefined, { continue: "second-factor" }));
          }
          return go(authPageHref("/sign-up", returnPath, "oauth_failed"));
        }
        if (signUp!.status === "complete" && signUp!.createdSessionId) {
          return finishSignUp(signUp!.createdSessionId, intent.flowToken);
        }
        if (signUp!.status === "missing_requirements") {
          // Google did not supply everything Clerk requires (e.g. name, Terms acceptance):
          // finish on the Sign-up page, which asks only for what is missing. No account yet.
          return go(authPageHref("/sign-up", returnPath, undefined, { continue: "google-details" }));
        }
        // Clerk already finished the Google sign-up and made its session the browser's session
        // (the sign-up attempt is then no longer reported): complete XfactorY registration with it.
        const created = signUp!.createdSessionId ?? clerk.session?.id ?? null;
        if (created) return finishSignUp(created, intent.flowToken);
        return go(authPageHref("/sign-up", returnPath, "signup_failed"));
      }

      // Sign-in (also the default when no intent was stored).
      if (signIn!.firstFactorVerification?.status === "transferable") {
        // Unknown Google account on Sign-in: never create it here (no signUp.create({transfer})).
        return go(authPageHref("/sign-up", returnPath, "signup_required"));
      }
      if (signIn!.status === "complete" && signIn!.createdSessionId) return finishSignIn(signIn!.createdSessionId);
      if (signIn!.status === "needs_second_factor" || signIn!.status === "needs_client_trust") {
        return go(authPageHref("/sign-in", returnPath, undefined, { continue: "second-factor" }));
      }
      return go(authPageHref("/sign-in", returnPath, "oauth_failed"));
    }

    run().catch(() => go(authPageHref(intent.purpose === "sign-up" ? "/sign-up" : "/sign-in", returnPath, "oauth_failed")));
  }, [signInLoaded, signUpLoaded, signIn, signUp, setActive, clerk, router]);

  return (
    <div className="auth-page">
      <div className="wrap" style={{ maxWidth: 520, textAlign: "center" }}>
        <h1 style={{ fontSize: 28, marginBottom: 12 }}>Signing you in…</h1>
        <p style={{ color: "var(--ink-soft)", marginBottom: 0, lineHeight: 1.6 }}>
          Completing your authentication with XfactorY.
        </p>
      </div>
    </div>
  );
}
