import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { CustomSignInForm } from "@/components/auth/CustomSignInForm";
import { checkRegistration } from "@/lib/auth/registration";
import { requestOrigin, safeRedirectPath } from "@/lib/auth/safeRedirect";

type SignInPageProps = {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
};


export default async function SignInPage({ searchParams }: SignInPageProps) {
  const session = await auth();
  const params = await searchParams;
  const redirectTo = safeRedirectPath(params.redirect_url, requestOrigin(await headers())) ?? "/";

  // Signed in already: continue only if the backend confirms a completed X!Y registration.
  // Signed in but not registered (or suspended): the form ends that stale session first.
  // Backend unreachable: just show the form (an outage is never "not registered").
  let staleSession = false;
  if (session.userId) {
    const check = await checkRegistration(await session.getToken().catch(() => null), {
      signal: AbortSignal.timeout(5000),
    });
    if (check.state === "registered") redirect(redirectTo);
    staleSession = check.state === "unregistered" || check.state === "blocked";
  }

  return (
    <AuthShell mode="sign-in">
      <CustomSignInForm redirectTo={redirectTo} staleSession={staleSession} />
    </AuthShell>
  );
}
