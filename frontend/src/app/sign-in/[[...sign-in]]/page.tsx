import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { CustomSignInForm } from "@/components/auth/CustomSignInForm";

type SignInPageProps = {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
};

function safeInternalRedirect(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const session = await auth();
  const params = await searchParams;
  const redirectTo = safeInternalRedirect(params.redirect_url) ?? "/";

  if (session.userId) {
    redirect(redirectTo);
  }

  return (
    <AuthShell mode="sign-in">
      <CustomSignInForm />
    </AuthShell>
  );
}
