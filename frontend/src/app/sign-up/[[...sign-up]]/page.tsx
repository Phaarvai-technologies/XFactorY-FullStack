import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { CustomSignUpForm } from "@/components/auth/CustomSignUpForm";
import { requestOrigin, safeRedirectPath } from "@/lib/auth/safeRedirect";

type SignUpPageProps = {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
};


export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const session = await auth();
  const params = await searchParams;
  const redirectTo = safeRedirectPath(params.redirect_url, requestOrigin(await headers())) ?? "/";

  if (session.userId) {
    redirect(redirectTo);
  }

  return (
    <AuthShell mode="sign-up">
      <CustomSignUpForm redirectTo={redirectTo} />
    </AuthShell>
  );
}
