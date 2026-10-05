import Image from "next/image";
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

/** Full X!Y wordmark from the official logo asset (icon + text). */
export function Logo({ href = "/", className = "logo", markClassName }: LogoProps) {
  const content = (
    <Image
      src="/images/xy-logo.png"
      alt="X!Y"
      width={156}
      height={46}
      className={markClassName ?? "logo-img"}
      priority
    />
  );

  if (href) {
    return (
      <Link href={href} className={className} aria-label="X!Y home">
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}
