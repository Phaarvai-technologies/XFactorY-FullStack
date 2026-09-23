import Link from "next/link";
import { FactoryMark } from "@/components/layout/Logo";

export function AuthBrandPanel() {
  return (
    <div className="auth-brand">
      <div className="auth-brand-top">
        <Link href="/" className="auth-brand-logo" aria-label="X!Y home">
          <FactoryMark className="auth-brand-mark" />
          <span>X!Y</span>
        </Link>
      </div>

      <div className="auth-brand-mid">
        <h2>
          <span className="line">One account.</span>
          <span className="line">Multiple opportunities.</span>
          <span className="line">One marketplace identity.</span>
        </h2>
      </div>

      <div className="auth-brand-foot">Terms v1.2 · Privacy Policy v1.4</div>

      <svg
        className="auth-brand-diagram"
        width="260"
        height="260"
        viewBox="0 0 260 260"
        aria-hidden="true"
      >
        <circle cx="200" cy="200" r="1" stroke="#1E355A" fill="none" />
        <circle cx="200" cy="200" r="40" stroke="#1E355A" strokeWidth="1.4" fill="none" />
        <circle cx="200" cy="200" r="80" stroke="#1E355A" strokeWidth="1.4" fill="none" />
        <circle cx="200" cy="200" r="120" stroke="#1E355A" strokeWidth="1.4" fill="none" />
      </svg>
    </div>
  );
}
