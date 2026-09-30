import type { useSignIn } from "@clerk/nextjs/legacy";

type SignInResource = NonNullable<ReturnType<typeof useSignIn>["signIn"]>;
type SignInSecondFactor = NonNullable<SignInResource["supportedSecondFactors"]>[number];

/** The extra step Clerk asks for after a correct password: Device Trust on a new device
 * (email code) or the user's own two-step verification (text message / authenticator app). */
export type SecondStep = { strategy: "email_code" | "phone_code" | "totp"; id?: string; sentTo?: string };

export const NEEDS_SECOND_STEP = new Set(["needs_client_trust", "needs_second_factor"]);

/** Email code first (what Device Trust uses), then text message, then authenticator app. */
export function pickSecondStep(factors: SignInSecondFactor[] | null | undefined): SecondStep | null {
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

/** Sends the email / text code (authenticator apps need nothing). */
export async function sendSecondStepCode(signIn: SignInResource, step: SecondStep): Promise<void> {
  if (step.strategy === "email_code") await signIn.prepareSecondFactor({ strategy: "email_code", emailAddressId: step.id });
  else if (step.strategy === "phone_code") await signIn.prepareSecondFactor({ strategy: "phone_code", phoneNumberId: step.id });
}

export function secondStepPrompt(step: SecondStep): string {
  return step.strategy === "totp"
    ? "Enter the 6-digit code from your authenticator app."
    : `We sent a verification code to ${step.sentTo || "your email"}.`;
}
