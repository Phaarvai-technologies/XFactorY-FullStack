"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PilotStrip } from "@/components/layout/PilotStrip";
import { Button } from "@/components/ui/Button";
import { createNeedContinuePath } from "@/lib/needs/paths";
import { projectCollaborationPath, projectProfilePath } from "@/lib/projects/paths";
import { getProjectById } from "@/lib/projects/sampleData";
import "../../projects/projects.css";

function FormalNeedForm() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") ?? "aurora-compact";
  const questionId = searchParams.get("questionId");
  const initialType =
    searchParams.get("type") === "supporting" ? "supporting" : "manufacturing";
  const project = getProjectById(projectId);

  const [title, setTitle] = useState(
    questionId ? "Need from private collaboration" : "",
  );
  const [summary, setSummary] = useState("");
  const [needType, setNeedType] = useState<"manufacturing" | "supporting">(
    initialType,
  );
  const [submitted, setSubmitted] = useState(false);

  const continueHref = createNeedContinuePath({
    projectId,
    type: needType === "supporting" ? "logistics" : "manufacturing",
  });

  return (
    <div className="project-profile">
      <div className="wrap" style={{ maxWidth: 720 }}>
        <div style={{ marginBottom: 12 }}>
          <Button href={projectCollaborationPath(projectId)} variant="text">
            ← Back to collaboration
          </Button>
        </div>

        <header className="pp-header" style={{ borderBottom: "none", marginBottom: 24 }}>
          <div className="pp-header-main">
            <p className="pp-eyebrow">Formal need</p>
            <h1>Create formal need</h1>
            <p className="pp-summary">
              Convert a private discussion into a formal business need for{" "}
              <strong>{project.title}</strong>. This does not publish the full
              project profile.
            </p>
            <div className="pp-badges">
              <span className="pp-badge">From collaboration</span>
              <span className="pp-badge pp-badge-soft">Project stays private</span>
            </div>
          </div>
        </header>

        {submitted ? (
          <div className="pp-banner pp-banner-info" role="status">
            <strong>Need draft captured.</strong> Continue to AI requirement
            structuring, then classify requirements in the editor before
            publishing. Your project collaboration remains invite-only.
            <div style={{ display: "flex", gap: 10, marginTop: 12, width: "100%", flexWrap: "wrap" }}>
              <Button href={continueHref} variant="primary">
                Continue to AI Structuring
              </Button>
              <Button href={projectCollaborationPath(projectId)} variant="ghost">
                Return to collaboration
              </Button>
              <Button href={projectProfilePath(projectId)} variant="text">
                View project profile
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="pp-ownership-card"
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitted(true);
            }}
          >
            <label className="pc-field" style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              Need type
              <select
                value={needType}
                onChange={(e) =>
                  setNeedType(e.target.value as "manufacturing" | "supporting")
                }
                style={{
                  padding: "11px 12px",
                  borderRadius: 8,
                  border: "1px solid #dce6f5",
                  font: "inherit",
                }}
              >
                <option value="manufacturing">Manufacturing need</option>
                <option value="supporting">Supporting need</option>
              </select>
            </label>

            <label className="pc-field" style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              Title
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What do you need?"
                style={{
                  padding: "11px 12px",
                  borderRadius: 8,
                  border: "1px solid #dce6f5",
                  font: "inherit",
                }}
              />
            </label>

            <label className="pc-field" style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
              Summary
              <textarea
                required
                rows={5}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Describe the requirement without exposing confidential IP"
                style={{
                  padding: "11px 12px",
                  borderRadius: 8,
                  border: "1px solid #dce6f5",
                  font: "inherit",
                }}
              />
            </label>

            {questionId ? (
              <p className="pp-muted" style={{ marginBottom: 16 }}>
                Linked from collaboration question: {questionId}
              </p>
            ) : null}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button type="submit" variant="primary">
                Save formal need draft
              </Button>
              <Button
                href={projectCollaborationPath(projectId)}
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function NewFormalNeedPage() {
  return (
    <>
      <PilotStrip />
      <Header />
      <main>
        <Suspense
          fallback={
            <div className="project-profile">
              <div className="wrap">
                <p className="pp-muted">Loading need form…</p>
              </div>
            </div>
          }
        >
          <FormalNeedForm />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
