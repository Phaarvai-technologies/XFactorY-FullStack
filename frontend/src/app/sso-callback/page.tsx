"use client";

import { useClerk } from "@clerk/nextjs";
import { useEffect } from "react";

export default function SsoCallbackPage() {
  const clerk = useClerk();

  useEffect(() => {
    void clerk.handleRedirectCallback({});
  }, [clerk]);

  return (
    <div className="auth-page">
      <div className="wrap" style={{ maxWidth: 520, textAlign: "center" }}>
        <h1 style={{ fontSize: 28, marginBottom: 12 }}>Signing you in…</h1>
        <p style={{ color: "var(--ink-soft)", marginBottom: 0, lineHeight: 1.6 }}>
          Completing your authentication with X!Y.
        </p>
      </div>
    </div>
  );
}
