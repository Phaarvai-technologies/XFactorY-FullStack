"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { AuthBrandPanel } from "@/components/auth/AuthBrandPanel";

type AuthMode = "sign-in" | "sign-up";

type AuthShellProps = {
  mode: AuthMode;
  children: ReactNode;
};

function withRedirectParam(path: string, redirectUrl: string | null): string {
  if (!redirectUrl || !redirectUrl.startsWith("/") || redirectUrl.startsWith("//")) {
    return path;
  }
  return `${path}?redirect_url=${encodeURIComponent(redirectUrl)}`;
}

export function AuthShell({ mode, children }: AuthShellProps) {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect_url");
  const signInHref = withRedirectParam("/sign-in", redirectUrl);
  const signUpHref = withRedirectParam("/sign-up", redirectUrl);

  return (
    <div className="auth-page-split">
      <AuthBrandPanel />

      <div className="auth-wrap">
        <div className="auth-card">
          <Link href="/" className="auth-backlink">
            ← Back
          </Link>

          <div className="auth-tabs" role="tablist" aria-label="Authentication">
            <Link
              href={signInHref}
              className={`auth-tab${mode === "sign-in" ? " active" : ""}`}
              role="tab"
              aria-selected={mode === "sign-in"}
            >
              Sign In
            </Link>
            <Link
              href={signUpHref}
              className={`auth-tab${mode === "sign-up" ? " active" : ""}`}
              role="tab"
              aria-selected={mode === "sign-up"}
            >
              Create Account
            </Link>
          </div>

          <div className="auth-panel">{children}</div>
        </div>
      </div>
    </div>
  );
}
