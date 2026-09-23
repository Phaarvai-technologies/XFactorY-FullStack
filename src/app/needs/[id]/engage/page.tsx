import { redirect } from "next/navigation";
import { createEngagementPath } from "@/lib/engagements/sampleData";

type EngageRedirectProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ candidateId?: string }>;
};

/** Preserves Prompt 7 Start Engagement links by forwarding to /engagements/new. */
export default async function EngageRedirectPage({
  params,
  searchParams,
}: EngageRedirectProps) {
  const { id } = await params;
  const query = await searchParams;
  redirect(
    createEngagementPath({
      needId: id,
      candidateId: query.candidateId ?? "",
    }),
  );
}
