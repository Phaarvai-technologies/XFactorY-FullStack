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
 * (an "opaque sign-up"), and the session is activated before X!Y is asked anything.
 *
 * Here, following Clerk's documented account-transfer checks:
 * - Sign-in with an unknown Google account → no transfer, no account: go to Sign-up with
 *   "Please sign up first, then sign in to continue."
 * - Sign-in with an existing account → the backend must confirm X!Y registration before the
 *   session is activated; unregistered → session ended, sent to Sign-up.
 * - Sign-up (new Google account, or an existing one Clerk transfers to sign-in) → X!Y
 *   registration is completed with the server-signed sign-up token; only once the backend
 *   confirms it is the session activated and the user sent to the dashboard (safe
 *   redirect). Not finalized → session ended, Sign-up shows the error; no access.
 * The stored intent only picks which branch to finish; it grants nothing by itself.
 */
export default function SsoCallbackPage() {
  const clerk = useClerk() as unknown as ClerkLike;
  const { isLoaded: signInLoaded, signIn, setActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !signInLoaded || !signUpLoaded || !signIn || !signUp || !setActive) return;
    ran.current = true;

    const intent: OAuthIntent = takeOAuthIntent() ?? { purpose: "sign-in", returnPath: "/" };
    const origin = window.location.origin;
    const returnPath = safeRedirectPath(intent.returnPath, origin) ?? "/";
    const go = (href: string) => router.replace(href);

    async function finishSignIn(sessionId: string) {
      const { token, activated } = await tokenForCreatedSession(clerk, setActive!, sessionId);
      const check = await checkRegistration(token);
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

    async function finishSignUp(sessionId: string, flowToken: string) {
      const { token, activated } = await tokenForCreatedSession(clerk, setActive!, sessionId);
      const result = await completeRegistration(token, flowToken);
      if (result.ok) {
        // Registration confirmed by the backend (new, or an existing X!Y user): signed in.
        go(await activateRegisteredSession(clerk, setActive!, sessionId, activated, returnPath));
        return;
      }
      // Not finalized: no active session, no access; Sign-up shows the existing error.
      await endSession(clerk, sessionId);
      go(authPageHref("/sign-up", returnPath, "signup_failed"));
    }

    async function run() {
      if (intent.purpose === "sign-up") {
        const external = signUp!.verifications?.externalAccount;
        // Clerk case 1: the Google account already belongs to a Clerk user → transfer to sign-in.
        if (external?.status === "transferable" && external.error?.code === "external_account_exists") {
          const res = await signIn!.create({ transfer: true });
          if (res.status === "complete" && res.createdSessionId) return finishSignUp(res.createdSessionId, intent.flowToken);
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
          Completing your authentication with X!Y.
        </p>
      </div>
    </div>
  );
}
