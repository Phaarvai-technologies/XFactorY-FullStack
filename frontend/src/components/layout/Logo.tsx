import Link from "next/link";

type LogoProps = {
  href?: string;
  className?: string;
  markClassName?: string;
};

/** Factory mark matching the official X!Y logo (icon only, for dark or light surfaces). */
export function FactoryMark({ className = "factory-mark" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 24V13l6 4v-4l6 4v-4l6 4v-4l8 5v6z" fill="#EAF1FB" />
      <path d="M2 24V13l6 4v-4l6 4v-4l6 4v-4l8 5v6z" />
      <rect x="2" y="24" width="28" height="1.4" fill="currentColor" stroke="none" />
      <path d="M24 9V5" />
      <path d="M23 5h2l1 3" />
    </svg>
  );
}

/** Factory mark plus the product name. */
export function Logo({ href = "/", className = "logo", markClassName }: LogoProps) {
  const content = (
    <>
      <FactoryMark className={markClassName ?? "factory-mark"} />
      <span className="logo-word">XfactorY</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className} aria-label="XfactorY home">
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}
