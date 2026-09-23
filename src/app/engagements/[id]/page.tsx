import type { Metadata } from "next";
import { EngagementWorkspaceView } from "@/components/engagements/EngagementWorkspaceView";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { Button } from "@/components/ui/Button";
import { outcomeLabel, type CloseOutcomeReason } from "@/lib/engagements/closeTypes";
import {
  getEngagementWorkspaceById,
  SAMPLE_ENGAGEMENT_ID,
} from "@/lib/engagements/workspaceData";
import "../../projects/projects.css";
import "../../needs/needs-editor.css";
import "../../needs/publish-review.css";
import "../engagement.css";
import "../workspace.css";

type EngagementPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    denied?: string;
    closed?: string;
    outcome?: string;
    feedback?: string;
    expired?: string;
    reopened?: string;
  }>;
};

export async function generateMetadata({
  params,
}: EngagementPageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Engagement ${id} | X!Y`,
    description:
      "Engagement workspace with conversation timeline, disclosures, and requirement context.",
  };
}

function parseOutcome(value?: string): string | undefined {
  if (!value) return undefined;
  const known: CloseOutcomeReason[] = [
    "proceeded_outside",
    "no_fit",
    "timing",
    "price",
    "capacity",
    "compliance",
    "no_response",
    "other",
  ];
  if (known.includes(value as CloseOutcomeReason)) {
    return outcomeLabel(value as CloseOutcomeReason);
  }
  return undefined;
}

export default async function EngagementWorkspacePage({
  params,
  searchParams,
}: EngagementPageProps) {
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
          <div className="req-editor project-profile eng-workspace">
            <div className="wrap">
              <div className="pp-banner pp-banner-warn" role="alert">
                <strong>Engagement not found.</strong> The requested engagement
                could not be loaded.
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
        <EngagementWorkspaceView
          initialWorkspace={workspace}
          initiallyClosed={query.closed === "1"}
          closedOutcomeLabel={parseOutcome(query.outcome)}
          feedbackRecorded={query.feedback === "1"}
          expired={query.expired === "1"}
          reopened={query.reopened === "1"}
        />
      </main>
      <Footer />
    </>
  );
}
