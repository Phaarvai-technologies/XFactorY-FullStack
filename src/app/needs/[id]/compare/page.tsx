import type { Metadata } from "next";
import { CompareCandidatesView } from "@/components/needs/CompareCandidatesView";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { getCompareBootstrap } from "@/lib/needs/compareData";
import "../../../projects/projects.css";
import "../../needs-editor.css";
import "../../publish-review.css";
import "../../compare.css";

type ComparePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ projectId?: string }>;
};

export async function generateMetadata({
  params,
}: ComparePageProps): Promise<Metadata> {
  const { id } = await params;
  const boot = getCompareBootstrap(id);
  return {
    title: `Compare Candidates — ${boot.needTitle} | X!Y`,
    description:
      "Compare selected candidates side-by-side across role-relevant dimensions without opaque ranking.",
  };
}

export default async function CompareCandidatesPage({
  params,
  searchParams,
}: ComparePageProps) {
  const { id } = await params;
  const query = await searchParams;
  const boot = getCompareBootstrap(id, query.projectId);

  return (
    <>
      <PilotStrip />
      <Header />
      <main>
        <CompareCandidatesView
          needId={boot.needId}
          needTitle={boot.needTitle}
          organizationName={boot.organizationName}
          pool={boot.pool}
          initialSelectedIds={boot.initialSelectedIds}
        />
      </main>
      <Footer />
    </>
  );
}
