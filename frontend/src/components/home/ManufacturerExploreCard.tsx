"use client";

import Link from "next/link";
import { MANUFACTURER_OVERVIEW_PATH } from "@/lib/auth/manufacturerAccess";

type ManufacturerExploreCardProps = {
  title: string;
  job: string;
  iconId: string;
};

/** Same persona-card markup; Explore always opens the Manufacturer overview. */
export function ManufacturerExploreCard({
  title,
  job,
  iconId,
}: ManufacturerExploreCardProps) {
  return (
    <Link
      href={MANUFACTURER_OVERVIEW_PATH}
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
