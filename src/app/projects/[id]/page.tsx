import type { Metadata } from "next";
import { ProjectProfileView } from "@/components/projects/ProjectProfileView";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { getProjectById } from "@/lib/projects/sampleData";
import "../projects.css";

type ProjectPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: ProjectPageProps): Promise<Metadata> {
  const { id } = await params;
  const project = getProjectById(id);
  return {
    title: `${project.title} — X!Y Project`,
    description: project.summary,
  };
}

export default async function ProjectProfilePage({ params }: ProjectPageProps) {
  const { id } = await params;
  const project = getProjectById(id);

  return (
    <>
      <PilotStrip />
      <Header />
      <main>
        <ProjectProfileView project={project} />
      </main>
      <Footer />
    </>
  );
}
