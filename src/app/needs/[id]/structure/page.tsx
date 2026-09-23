import type { Metadata } from "next";
import { AiStructureView } from "@/components/needs/AiStructureView";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { getNeedDraftById } from "@/lib/needs/sampleData";
import type { NeedType } from "@/lib/needs/types";
import "../../../projects/projects.css";
import "../../../projects/collaboration.css";
import "../../needs-editor.css";

type StructurePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string; projectId?: string }>;
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
}: StructurePageProps): Promise<Metadata> {
  const { id } = await params;
  const draft = getNeedDraftById(id);
  return {
    title: `AI Requirement Structuring — ${draft.title} | X!Y`,
    description: "Review AI-suggested requirements before editing and classifying.",
  };
}

export default async function AiRequirementStructurePage({
  params,
  searchParams,
}: StructurePageProps) {
  const { id } = await params;
  const query = await searchParams;
  const draft = getNeedDraftById(id, {
    projectId: query.projectId,
    needType: parseNeedType(query.type),
  });

  return (
    <>
      <PilotStrip />
      <Header />
      <main>
        <AiStructureView draft={draft} />
      </main>
      <Footer />
    </>
  );
}
