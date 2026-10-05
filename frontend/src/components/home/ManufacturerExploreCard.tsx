"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import {
  MANUFACTURER_ACCOUNT_PATH,
  MANUFACTURER_OVERVIEW_PATH,
} from "@/lib/auth/manufacturerAccess";

type ManufacturerExploreCardProps = {
  title: string;
  job: string;
  iconId: string;
};

export function ManufacturerExploreCard({
  title,
  job,
  iconId,
}: ManufacturerExploreCardProps) {
  const { isSignedIn } = useAuth();

  const manufacturerPath = isSignedIn
    ? MANUFACTURER_ACCOUNT_PATH
    : MANUFACTURER_OVERVIEW_PATH;

  return (
    <Link
      href={manufacturerPath}
      className="p-card"
      aria-label={`${title} — ${job}`}
    >
      <div className="p-illustration-wrap">
        <svg className="p-illustration" aria-hidden="true">
          <use href={`#${iconId}`} />
        </svg>
      </div>

      <div className="p-title">{title}</div>
      <div className="p-job">{job}</div>
      <div className="p-link">Explore role →</div>
    </Link>
  );
}