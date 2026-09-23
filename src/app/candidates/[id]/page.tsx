import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { Button } from "@/components/ui/Button";
import { needComparePath } from "@/lib/needs/paths";
import { COMPARE_CANDIDATE_POOL } from "@/lib/needs/compareData";
import "../../projects/projects.css";
import "../../needs/needs-editor.css";

type CandidatePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ needId?: string; from?: string }>;
};

/** Thin profile handoff for Open Candidate — replace with full matching profile later. */
export default async function CandidateProfilePage({
  params,
  searchParams,
}: CandidatePageProps) {
  const { id } = await params;
  const query = await searchParams;
  const candidate = COMPARE_CANDIDATE_POOL.find((entry) => entry.id === id);
  const needId = query.needId ?? "need-aurora-enclosure";

  return (
    <>
      <PilotStrip />
      <Header />
      <main>
        <div className="req-editor project-profile">
          <div className="wrap" style={{ maxWidth: 720 }}>
            <div className="pc-back">
              <Button href={needComparePath(needId)} variant="text">
                ← Back to comparison
              </Button>
            </div>
            <header className="pp-header" style={{ borderBottom: "none" }}>
              <div className="pp-header-main">
                <p className="pp-eyebrow">Candidate profile</p>
                <h1>{candidate?.name ?? "Candidate"}</h1>
                <p className="pp-summary">
                  {candidate
                    ? `${candidate.personaLabel} · ${candidate.organizationName} · ${candidate.location}`
                    : "Candidate details will connect to the matching profile API."}
                </p>
                <div className="pp-badges">
                  <span className="pp-badge">
                    {candidate?.verificationStatus === "verified"
                      ? "Verified"
                      : "Profile draft"}
                  </span>
                  <span className="pp-badge pp-badge-soft">
                    Evidence: {candidate?.evidence ?? "unknown"}
                  </span>
                </div>
              </div>
            </header>
            <div className="re-save-card">
              <p className="pp-muted" style={{ margin: 0 }}>
                This is a lightweight handoff so comparison can open candidate
                context without inventing a second profile system. Full evidence
                and capability detail will use the existing matching profile when
                available.
              </p>
              <div className="re-final-actions">
                <Button href={needComparePath(needId)} variant="primary">
                  Return to comparison
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
