import type { Metadata } from "next";
import { CreateEngagementView } from "@/components/engagements/CreateEngagementView";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { Button } from "@/components/ui/Button";
import { getEngagementContext } from "@/lib/engagements/sampleData";
import { needComparePath } from "@/lib/needs/paths";
import "../../projects/projects.css";
import "../../needs/needs-editor.css";
import "../../needs/publish-review.css";
import "../engagement.css";

type NewEngagementPageProps = {
  searchParams: Promise<{
    needId?: string;
    candidateId?: string;
    stepup?: string;
  }>;
};

export const metadata: Metadata = {
  title: "Create Engagement Request | X!Y",
  description:
    "Create a nonbinding request and review disclosure before sending.",
};

export default async function NewEngagementPage({
  searchParams,
}: NewEngagementPageProps) {
  const query = await searchParams;
  const context = getEngagementContext({
    needId: query.needId,
    candidateId: query.candidateId,
  });

  if (!context) {
    const backHref = needComparePath(query.needId ?? "need-aurora-enclosure");
    return (
      <>
        <PilotStrip />
        <Header />
        <main>
          <div className="req-editor project-profile eng-page">
            <div className="wrap" style={{ maxWidth: 720 }}>
              <div className="pp-banner pp-banner-warn" role="alert">
                <strong>Recipient is missing.</strong> Select a candidate from
                comparison before creating an engagement request.
              </div>
              <header className="pp-header" style={{ borderBottom: "none" }}>
                <div className="pp-header-main">
                  <p className="pp-eyebrow">Controlled engagement</p>
                  <h1>Create Engagement Request</h1>
                  <p className="pp-summary">
                    A recipient is required. Sending is disabled until a matched
                    candidate is selected.
                  </p>
                </div>
              </header>
              <Button href={backHref} variant="primary">
                Back to comparison
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
        <CreateEngagementView
          context={context}
          stepUpRequired={query.stepup === "1"}
        />
      </main>
      <Footer />
    </>
  );
}
