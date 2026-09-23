import type { Metadata } from "next";
import { CloseEngagementView } from "@/components/engagements/CloseEngagementView";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { Button } from "@/components/ui/Button";
import {
  getEngagementWorkspaceById,
  SAMPLE_ENGAGEMENT_ID,
} from "@/lib/engagements/workspaceData";
import "../../../projects/projects.css";
import "../../needs/needs-editor.css";
import "../../needs/publish-review.css";
import "../../engagement.css";
import "../../close.css";

type ClosePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ denied?: string; expired?: string }>;
};

export async function generateMetadata({
  params,
}: ClosePageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Close Engagement ${id} | X!Y`,
    description:
      "Capture a structured non-commercial outcome when closing an engagement.",
  };
}

export default async function CloseEngagementPage({
  params,
  searchParams,
}: ClosePageProps) {
  const { id } = await params;
  const query = await searchParams;
  const workspace = getEngagementWorkspaceById(id || SAMPLE_ENGAGEMENT_ID, {
    denied: query.denied === "1",
  });

  if (!workspace) {
    return (
      <>
        <PilotStrip />
        <Header />
        <main>
          <div className="req-editor project-profile eng-close">
            <div className="wrap">
              <div className="pp-banner pp-banner-warn" role="alert">
                <strong>Engagement not found.</strong> Unable to close an unknown
                engagement.
              </div>
              <Button href="/app" variant="primary">
                Return to Dashboard
              </Button>
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <PilotStrip />
      <Header />
      <main>
        <CloseEngagementView
          workspace={workspace}
          initiallyExpired={query.expired === "1"}
          canReopen
        />
      </main>
      <Footer />
    </>
  );
}
