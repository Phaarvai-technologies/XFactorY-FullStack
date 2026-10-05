"use client";

import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import { useSignIn } from "@clerk/nextjs/legacy";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminHostContext, type AdminHost, type ClerkSignInResult } from "@/lib/admin/api";
import { parseClerkError } from "@/lib/auth/clerkErrors";
import { NEEDS_SECOND_STEP, pickSecondStep, secondStepPrompt, sendSecondStepCode, type SecondStep } from "@/lib/auth/secondFactor";

/** Connects the admin screens to the Next.js router and Clerk. */
export function AdminRoot() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { getToken, isSignedIn, isLoaded: authLoaded } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { isLoaded, signIn, setActive } = useSignIn();

  const go = useCallback<AdminHost["go"]>(
    (href, options) => (options?.replace ? router.replace(href, { scroll: false }) : router.push(href)),
    [router],
  );
  const getClerkToken = useCallback(async () => (isSignedIn ? getToken() : null), [getToken, isSignedIn]);

  // The second step Clerk asked for (Device Trust on a new device, or two-step verification).
  const pending = useRef<SecondStep | null>(null);

  const sendCode = useCallback(async (step: SecondStep) => {
    if (signIn) await sendSecondStepCode(signIn, step);
  }, [signIn]);

  const clerkSignIn = useCallback(
    async (email: string, password: string): Promise<ClerkSignInResult> => {
      if (!isLoaded || !signIn || !setActive) return { ok: false, message: "Sign-in is still loading. Try again." };
      pending.current = null;
      try {
        const result = await signIn.create({ identifier: email, password });
        if (result.status === "complete" && result.createdSessionId) {
          await setActive({ session: result.createdSessionId });
          return { ok: true };
        }
        if (NEEDS_SECOND_STEP.has(result.status ?? "")) {
          const step = pickSecondStep(result.supportedSecondFactors);
          if (step) {
            await sendCode(step);
            pending.current = step;
            return { ok: false, needsCode: true, message: secondStepPrompt(step) };
          }
        }
        return {
          ok: false,
          message: "This account needs an extra verification step. Sign in on the X!Y sign-in page, then open /admin.",
        };
      } catch (error) {
        const parsed = parseClerkError(error);
        if (parsed.code === "session_exists") return { ok: true };
        const field =
          parsed.paramName === "identifier" || parsed.code === "form_identifier_not_found"
            ? "email"
            : parsed.paramName === "password" || parsed.code === "form_password_incorrect"
              ? "password"
              : undefined;
        return { ok: false, message: parsed.message, field };
      }
    },
    [isLoaded, signIn, setActive, sendCode],
  );

  const clerkVerifyCode = useCallback(
    async (code: string): Promise<ClerkSignInResult> => {
      const step = pending.current;
      if (!signIn || !setActive || !step) return { ok: false, message: "Start again: enter your email and password." };
      try {
        const result = await signIn.attemptSecondFactor({ strategy: step.strategy, code: code.trim() });
        if (result.status === "complete" && result.createdSessionId) {
          pending.current = null;
          await setActive({ session: result.createdSessionId });
          return { ok: true };
        }
        return { ok: false, message: "This account needs another verification step. Use the X!Y sign-in page." };
      } catch (error) {
        const parsed = parseClerkError(error);
        if (parsed.code === "session_exists") return { ok: true };
        return { ok: false, message: parsed.message, field: "code" };
      }
    },
    [signIn, setActive],
  );

  const clerkResendCode = useCallback(async () => {
    if (pending.current) await sendCode(pending.current);
  }, [sendCode]);

  const clerkSignOut = useCallback(async () => {
    if (isSignedIn) await signOut();
  }, [isSignedIn, signOut]);

  const clerkEmail = isSignedIn ? (user?.primaryEmailAddress?.emailAddress ?? null) : null;
  const host = useMemo<AdminHost>(
    () => ({
      ready: authLoaded,
      path: pathname,
      search: new URLSearchParams(searchParams.toString()),
      go,
      getClerkToken,
      clerkEmail,
      clerkSignIn,
      clerkVerifyCode,
      clerkResendCode,
      clerkSignOut,
    }),
    [authLoaded, pathname, searchParams, go, getClerkToken, clerkEmail, clerkSignIn, clerkVerifyCode, clerkResendCode, clerkSignOut],
  );

  return (
    <AdminHostContext.Provider value={host}>
      <AdminShell />
    </AdminHostContext.Provider>
  );
}

