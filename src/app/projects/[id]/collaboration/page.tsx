import type { Metadata } from "next";
import { CollaborationView } from "@/components/projects/CollaborationView";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { getCollaborationByProjectId } from "@/lib/projects/collaborationData";
import { getProjectById } from "@/lib/projects/sampleData";
import "../../projects.css";
import "../../collaboration.css";

type CollaborationPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: CollaborationPageProps): Promise<Metadata> {
  const { id } = await params;
  const project = getProjectById(id);
  return {
    title: `${project.title} — Private Collaboration | X!Y`,
    description: `Invite-only collaboration and Q&A for ${project.title}.`,
  };
}

export default async function ProjectCollaborationPage({
  params,
}: CollaborationPageProps) {
  const { id } = await params;
  const project = getProjectById(id);
  const collaboration = getCollaborationByProjectId(id);

  return (
    <>
      <PilotStrip />
      <Header />
      <main>
        <CollaborationView
          project={project}
          initialCollaboration={collaboration}
        />
      </main>
      <Footer />
    </>
  );
}
