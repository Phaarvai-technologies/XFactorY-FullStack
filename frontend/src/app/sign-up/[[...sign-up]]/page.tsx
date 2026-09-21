import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { CustomSignUpForm } from "@/components/auth/CustomSignUpForm";

type SignUpPageProps = {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
};

function safeInternalRedirect(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const session = await auth();
  const params = await searchParams;
  const redirectTo = safeInternalRedirect(params.redirect_url) ?? "/onboarding/roles";

  if (session.userId) {
    redirect(redirectTo);
  }

  return (
    <AuthShell mode="sign-up">
      <CustomSignUpForm />
    </AuthShell>
  );
}
