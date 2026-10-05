import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { CustomSignInForm } from "@/components/auth/CustomSignInForm";
import { requestOrigin, safeRedirectPath } from "@/lib/auth/safeRedirect";

type SignInPageProps = {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
};


export default async function SignInPage({ searchParams }: SignInPageProps) {
  const session = await auth();
  const params = await searchParams;
  const redirectTo = safeRedirectPath(params.redirect_url, requestOrigin(await headers())) ?? "/";

  if (session.userId) {
    redirect(redirectTo);
  }

  return (
    <AuthShell mode="sign-in">
      <CustomSignInForm redirectTo={redirectTo} />
    </AuthShell>
  );
}
