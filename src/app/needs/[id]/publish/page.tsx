import type { Metadata } from "next";
import { PublishReviewView } from "@/components/needs/PublishReviewView";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { getPublishReviewByNeedId } from "@/lib/needs/publishData";
import type { NeedType } from "@/lib/needs/types";
import "../../../projects/projects.css";
import "../../needs-editor.css";
import "../../publish-review.css";

type PublishPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    type?: string;
    projectId?: string;
    revoked?: string;
    stale?: string;
    verify?: string;
  }>;
};

function parseNeedType(value?: string): NeedType {
  switch (value) {
    case "vendor":
    case "labour":
    case "logistics":
    case "investor":
    case "legal":
    case "market_lead":
    case "supporting":
      return value;
    default:
      return "manufacturing";
  }
}

export async function generateMetadata({
  params,
}: PublishPageProps): Promise<Metadata> {
  const { id } = await params;
  const review = getPublishReviewByNeedId(id);
  return {
    title: `Publish Confirmation — ${review.draft.title} | X!Y`,
    description:
      "Review requirement version, visibility, and cross-Organization disclosure before publishing.",
  };
}

export default async function NeedPublishPage({
  params,
  searchParams,
}: PublishPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const review = getPublishReviewByNeedId(id, {
    projectId: query.projectId,
    needType: parseNeedType(query.type),
    permissionRevoked: query.revoked === "1",
    versionStale: query.stale === "1",
    forceVerificationRequired: query.verify === "1",
  });

  return (
    <>
      <PilotStrip />
      <Header />
      <main>
        <PublishReviewView initialReview={review} />
      </main>
      <Footer />
    </>
  );
}
