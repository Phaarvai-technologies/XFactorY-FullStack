import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/layout/Logo";

export default async function AccountVerifyPage() {
  const session = await auth();

  if (!session.userId) {
    redirect("/sign-in");
  }

  return (
    <div className="auth-page">
      <div className="wrap" style={{ maxWidth: 520, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <Logo />
        </div>
        <h1 style={{ fontSize: 28, marginBottom: 12 }}>Verify your account</h1>
        <p style={{ color: "var(--ink-soft)", marginBottom: 28, lineHeight: 1.6 }}>
          Check your email for a verification link from Clerk. Once verified, continue
          to role selection to set up your X!Y profile.
        </p>
        <div className="role-actions" style={{ justifyContent: "center" }}>
          <Button href="/onboarding/roles" variant="primary">
            Continue to role selection
          </Button>
          <Link href="/" className="btn btn-text">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
