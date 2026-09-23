"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { needRequirementEditorPath } from "@/lib/needs/paths";
import type { NeedRequirementDraft } from "@/lib/needs/types";
import { needTypeLabel } from "@/lib/needs/templates";
import { projectCollaborationPath } from "@/lib/projects/paths";

type AiStructureViewProps = {
  draft: NeedRequirementDraft;
};

export function AiStructureView({ draft }: AiStructureViewProps) {
  const aiItems = draft.items.filter(
    (item) => item.source.kind === "ai" || item.status === "suggested",
  );
  const [accepted, setAccepted] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(aiItems.map((item) => [item.id, false])),
  );

  return (
    <div className="req-editor project-profile">
      <div className="wrap">
        <div className="pc-back">
          <Button href={projectCollaborationPath(draft.projectId)} variant="text">
            ← Back to collaboration
          </Button>
        </div>

        <div className="pp-banner pp-banner-info" role="status">
          <strong>AI-assisted suggestions.</strong> These are not confirmed
          requirements. Review them here, then classify and validate in the
          Requirement Editor.
        </div>

        <header className="pp-header">
          <div className="pp-header-main">
            <p className="pp-eyebrow">AI requirement structuring</p>
            <h1>{draft.title}</h1>
            <p className="pp-summary">
              X!Y suggests structured fields for{" "}
              {needTypeLabel(draft.needType).toLowerCase()} based on your project
              and discussion context. You stay in control of what becomes a
              confirmed requirement.
            </p>
            <div className="pp-badges">
              <span className="pp-badge">{needTypeLabel(draft.needType)}</span>
              <span className="pp-badge pp-badge-soft">{draft.projectTitle}</span>
              <span className="pp-badge pp-badge-soft">Suggestions only</span>
            </div>
          </div>
          <div className="pp-header-actions">
            <Button href={needRequirementEditorPath(draft.id)} variant="primary">
              Continue to Requirement Editor
            </Button>
          </div>
        </header>

        <section className="pp-section" aria-labelledby="ai-suggestions-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="ai-suggestions-heading">Suggested requirements</h2>
              <p>
                Mark suggestions you want to review further. Nothing is published
                from this step.
              </p>
            </div>
          </div>

          {aiItems.length === 0 ? (
            <div className="pp-empty">
              No AI suggestions for this need yet. Continue to the editor to add
              requirements manually.
            </div>
          ) : (
            <ul className="re-item-list">
              {aiItems.map((item) => (
                <li key={item.id} className="re-item-card">
                  <div className="re-item-top">
                    <div>
                      <h4>{item.name}</h4>
                      <p className="pc-related">{item.categoryLabel}</p>
                    </div>
                    <span className="pp-badge pp-badge-soft">AI suggestion</span>
                  </div>
                  <div className="re-item-value">
                    <span>Suggested value</span>
                    <p>{item.value.trim() || "(needs clarification)"}</p>
                  </div>
                  <p className="pp-muted">Source: {item.source.label}</p>
                  <label className="pc-check">
                    <input
                      type="checkbox"
                      checked={Boolean(accepted[item.id])}
                      onChange={(e) =>
                        setAccepted((current) => ({
                          ...current,
                          [item.id]: e.target.checked,
                        }))
                      }
                    />
                    Review in Requirement Editor
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pp-section">
          <div className="re-final-actions">
            <Button href={needRequirementEditorPath(draft.id)} variant="primary">
              Continue to Requirement Editor
            </Button>
          </div>
          <p className="pp-muted" style={{ marginTop: 12 }}>
            Next: classify each item as Required, Preferred, Unknown, or N/A —
            then save a version and publish.
          </p>
        </section>
      </div>
    </div>
  );
}
