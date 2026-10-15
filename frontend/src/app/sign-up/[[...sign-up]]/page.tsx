import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { CustomSignUpForm } from "@/components/auth/CustomSignUpForm";
import { checkRegistration } from "@/lib/auth/registration";
import { sessionIsLive } from "@/lib/auth/liveSession";
import { requestOrigin, safeRedirectPath } from "@/lib/auth/safeRedirect";

type SignUpPageProps = {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
};


export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const session = await auth();
  const params = await searchParams;
  const redirectTo = safeRedirectPath(params.redirect_url, requestOrigin(await headers())) ?? "/";

  // Signed in already: continue only if the backend confirms a completed X!Y registration.
  // Signed in but not registered (or suspended): the form ends that stale session first.
  // Backend unreachable: just show the form (an outage is never "not registered").
  // A Clerk cookie is not enough: its session may already have been ended (its token stays valid
  // for about a minute, e.g. after a Sign-up attempt with an email that already has an account).
  // Only a session Clerk confirms is still active is handled here; otherwise the form is shown
  // as for a signed-out visitor, so the browser and the server can never send each other back
  // and forth between Sign-in and Sign-up.
  let staleSession = false;
  if (session.userId && (await sessionIsLive(session.sessionId)) === true) {
    const check = await checkRegistration(await session.getToken().catch(() => null), {
      signal: AbortSignal.timeout(5000),
    });
    if (check.state === "registered") redirect(redirectTo);
    staleSession = check.state === "unregistered" || check.state === "blocked";
  }

  return (
    <AuthShell mode="sign-up">
      <CustomSignUpForm redirectTo={redirectTo} staleSession={staleSession} />
    </AuthShell>
  );
}
