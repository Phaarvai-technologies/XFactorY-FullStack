import type { Metadata } from "next";
import { RequirementEditorView } from "@/components/needs/RequirementEditorView";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { getNeedDraftById } from "@/lib/needs/sampleData";
import type { NeedType } from "@/lib/needs/types";
import "../../../projects/projects.css";
import "../../../projects/collaboration.css";
import "../../needs-editor.css";

type EditorPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string; projectId?: string; revoked?: string }>;
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
}: EditorPageProps): Promise<Metadata> {
  const { id } = await params;
  const draft = getNeedDraftById(id);
  return {
    title: `Requirement Editor — ${draft.title} | X!Y`,
    description: "Review and classify requirements before publishing.",
  };
}

export default async function RequirementEditorPage({
  params,
  searchParams,
}: EditorPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const draft = getNeedDraftById(id, {
    projectId: query.projectId,
    needType: parseNeedType(query.type),
    permissionRevoked: query.revoked === "1",
  });

  return (
    <>
      <PilotStrip />
      <Header />
      <main>
        <RequirementEditorView initialDraft={draft} />
      </main>
      <Footer />
    </>
  );
}
