"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import {
  formalNeedNewPath,
  projectCollaborationPath,
} from "@/lib/projects/paths";
import type {
  ConfidentialityLevel,
  EcosystemItem,
  ProjectLifecycleStatus,
  ProjectProfile,
  ProjectVisibility,
  PrototypeStatus,
} from "@/lib/projects/types";

type ProjectProfileViewProps = {
  project: ProjectProfile;
};

function statusLabel(status: ProjectLifecycleStatus): string {
  switch (status) {
    case "private_draft":
      return "Private draft";
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "archived":
      return "Archived";
  }
}

function visibilityLabel(visibility: ProjectVisibility): string {
  return visibility === "redacted_published"
    ? "Redacted / published"
    : "Private";
}

function confidentialityLabel(level: ConfidentialityLevel): string {
  switch (level) {
    case "public_safe":
      return "Public-safe";
    case "redacted":
      return "Redacted";
    case "confidential":
      return "Confidential";
    case "restricted":
      return "Restricted";
  }
}

function prototypeLabel(status: PrototypeStatus): string {
  switch (status) {
    case "concept":
      return "Concept";
    case "in_development":
      return "In development";
    case "prototype":
      return "Prototype";
    case "ready_for_manufacturing":
      return "Ready for manufacturing";
  }
}

function itemStatusLabel(status: EcosystemItem["status"]): string {
  switch (status) {
    case "open":
      return "Open";
    case "in_progress":
      return "In progress";
    case "closed":
      return "Closed";
  }
}

function EcosystemCard({
  title,
  description,
  items,
  emptyMessage,
  action,
}: {
  title: string;
  description: string;
  items: EcosystemItem[];
  emptyMessage: string;
  action?: ReactNode;
}) {
  return (
    <article className="pp-eco-card">
      <div className="pp-eco-card-head">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {action}
      </div>
      {items.length === 0 ? (
        <div className="pp-empty">{emptyMessage}</div>
      ) : (
        <ul className="pp-eco-list">
          {items.map((item) => (
            <li key={item.id}>
              <div className="pp-eco-item-top">
                <span className="pp-eco-item-title">{item.title}</span>
                <span className={`pp-chip pp-chip-${item.status}`}>
                  {itemStatusLabel(item.status)}
                </span>
              </div>
              <p>{item.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function ProjectProfileView({ project: initialProject }: ProjectProfileViewProps) {
  const [project, setProject] = useState(initialProject);
  const [externalPreview, setExternalPreview] = useState(false);
  const [archivedOverride, setArchivedOverride] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState({
    title: initialProject.title,
    summary: initialProject.summary,
    stage: initialProject.stage,
    industry: initialProject.industry,
    targetGeography: initialProject.targetGeography,
    status: initialProject.status,
    visibility: initialProject.visibility,
    confidentiality: initialProject.confidentiality,
    publicDescription: initialProject.publicDescription,
    redactedOverview: initialProject.redactedOverview,
    prototypeStatus: initialProject.manufacturing.prototypeStatus,
    expectedVolume: initialProject.manufacturing.expectedVolume,
    timeline: initialProject.manufacturing.timeline,
    constraintsText: initialProject.manufacturing.constraints.join("\n"),
    ownerName: initialProject.ownership.ownerName,
    organizationName: initialProject.ownership.organizationName,
  });

  const isArchived = project.status === "archived" || archivedOverride;
  const isPaused = project.status === "paused" && !isArchived;
  const isDraft = project.status === "private_draft" && !isArchived;
  const readOnly = isArchived;
  const showOwnershipWarning =
    !project.ownership.organizationVerified ||
    project.ownership.ownershipStatus !== "verified";

  const statusForDisplay: ProjectLifecycleStatus = isArchived
    ? "archived"
    : project.status;

  function openEditForm() {
    setDraft({
      title: project.title,
      summary: project.summary,
      stage: project.stage,
      industry: project.industry,
      targetGeography: project.targetGeography,
      status: project.status,
      visibility: project.visibility,
      confidentiality: project.confidentiality,
      publicDescription: project.publicDescription,
      redactedOverview: project.redactedOverview,
      prototypeStatus: project.manufacturing.prototypeStatus,
      expectedVolume: project.manufacturing.expectedVolume,
      timeline: project.manufacturing.timeline,
      constraintsText: project.manufacturing.constraints.join("\n"),
      ownerName: project.ownership.ownerName,
      organizationName: project.ownership.organizationName,
    });
    setEditOpen(true);
  }

  function saveEditForm() {
    const constraints = draft.constraintsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    setProject((current) => ({
      ...current,
      title: draft.title.trim() || current.title,
      summary: draft.summary.trim() || current.summary,
      stage: draft.stage.trim() || current.stage,
      industry: draft.industry.trim() || current.industry,
      targetGeography: draft.targetGeography.trim() || current.targetGeography,
      status: draft.status,
      visibility: draft.visibility,
      confidentiality: draft.confidentiality,
      publicDescription:
        draft.publicDescription.trim() || current.publicDescription,
      redactedOverview: draft.redactedOverview.trim() || current.redactedOverview,
      manufacturing: {
        ...current.manufacturing,
        prototypeStatus: draft.prototypeStatus,
        expectedVolume:
          draft.expectedVolume.trim() || current.manufacturing.expectedVolume,
        timeline: draft.timeline.trim() || current.manufacturing.timeline,
        constraints:
          constraints.length > 0 ? constraints : current.manufacturing.constraints,
      },
      ownership: {
        ...current.ownership,
        ownerName: draft.ownerName.trim() || current.ownership.ownerName,
        organizationName:
          draft.organizationName.trim() || current.ownership.organizationName,
      },
    }));
    setEditOpen(false);
  }

  return (
    <div className="project-profile">
      <div className="wrap">
        {showOwnershipWarning && !externalPreview ? (
          <div className="pp-banner pp-banner-warn" role="status">
            <strong>Verification / ownership warning.</strong> Project ownership
            or organization association is incomplete. You can still manage this
            profile, but some external visibility and engagement features may stay
            limited until verification is finished.
          </div>
        ) : null}

        {isDraft ? (
          <div className="pp-banner pp-banner-info" role="status">
            <strong>Private draft.</strong> This project is being prepared and is
            not externally visible.
          </div>
        ) : null}

        {isPaused ? (
          <div className="pp-banner pp-banner-info" role="status">
            <strong>Paused.</strong> This project is temporarily paused. Information
            remains available; active matching may be limited.
          </div>
        ) : null}

        {isArchived ? (
          <div className="pp-banner pp-banner-muted" role="status">
            <strong>Archived.</strong> This project is read-only. Restore it later
            to resume editing and new needs.
          </div>
        ) : null}

        {externalPreview ? (
          <div className="pp-banner pp-banner-info" role="status">
            <strong>External preview.</strong> Showing visibility-safe information
            only. Confidential IP stays hidden.
            <button
              type="button"
              className="pp-banner-action"
              onClick={() => setExternalPreview(false)}
            >
              Exit preview
            </button>
          </div>
        ) : null}

        {/* A. Project Header / Identity */}
        <header className="pp-header">
          <div className="pp-header-main">
            <p className="pp-eyebrow">Visionary project profile</p>
            <h1>{project.title}</h1>
            <p className="pp-summary">{project.summary}</p>

            <div className="pp-meta-row" aria-label="Project attributes">
              <span>
                <em>Stage</em> {project.stage}
              </span>
              <span className="pp-meta-sep" aria-hidden>
                |
              </span>
              <span>
                <em>Industry</em> {project.industry}
              </span>
              <span className="pp-meta-sep" aria-hidden>
                |
              </span>
              <span>
                <em>Target geography</em> {project.targetGeography}
              </span>
            </div>

            <div className="pp-badges">
              <span className={`pp-badge pp-badge-status-${statusForDisplay}`}>
                {statusLabel(statusForDisplay)}
              </span>
              <span className="pp-badge">
                {visibilityLabel(project.visibility)}
              </span>
              <span className="pp-badge pp-badge-soft">
                {confidentialityLabel(project.confidentiality)}
              </span>
            </div>
          </div>

          {!externalPreview ? (
            <div className="pp-header-actions">
              <Button
                type="button"
                variant="primary"
                disabled={readOnly}
                onClick={openEditForm}
              >
                Edit Project
              </Button>
              <Button
                href={projectCollaborationPath(project.id)}
                variant="ghost"
              >
                Open Collaboration
              </Button>
            </div>
          ) : null}
        </header>

        {!externalPreview ? (
          <section
            className="pp-section"
            aria-labelledby="pp-collab-entry-heading"
          >
            <div className="pp-section-head">
              <div>
                <h2 id="pp-collab-entry-heading">Private collaboration</h2>
                <p>
                  Invite selected collaborators to ask questions, capture
                  decisions, and refine this project without exposing confidential
                  IP publicly.
                </p>
              </div>
              <Button
                href={projectCollaborationPath(project.id)}
                variant="primary"
              >
                Project Collaboration
              </Button>
            </div>
          </section>
        ) : null}

        {/* B. Visibility-Safe Project Overview */}
        <section className="pp-section" aria-labelledby="pp-overview-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pp-overview-heading">Visibility-safe overview</h2>
              <p>
                Information that can be shared externally without exposing
                confidential intellectual property.
              </p>
            </div>
            {!readOnly ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setExternalPreview((value) => !value)}
              >
                {externalPreview ? "Exit External View" : "Preview External View"}
              </Button>
            ) : null}
          </div>

          <div className="pp-overview-grid">
            <div className="pp-media" aria-label={project.mediaLabel}>
              <div className="pp-media-frame">
                <span className="pp-media-mark">X!Y</span>
                <p>{project.mediaLabel}</p>
              </div>
              <p className="pp-media-caption">{project.mediaCaption}</p>
            </div>

            <div className="pp-overview-copy">
              <div className="pp-safe-block">
                <div className="pp-safe-label">
                  <span className="pp-dot pp-dot-safe" />
                  Public-safe description
                </div>
                <p>{project.publicDescription}</p>
              </div>

              <div className="pp-safe-block">
                <div className="pp-safe-label">
                  <span className="pp-dot pp-dot-redacted" />
                  Redacted project overview
                </div>
                <p>{project.redactedOverview}</p>
              </div>

              <p className="pp-confidentiality-note">
                Confidentiality:{" "}
                <strong>{confidentialityLabel(project.confidentiality)}</strong>
                . Detailed drawings, BOM, and proprietary process data are not
                shown on this surface.
              </p>
            </div>
          </div>
        </section>

        {/* Private / owner-only sections hidden in external preview */}
        {!externalPreview ? (
          <>
            {/* C. Manufacturing Readiness */}
            <section
              className="pp-section"
              aria-labelledby="pp-readiness-heading"
            >
              <div className="pp-section-head">
                <div>
                  <h2 id="pp-readiness-heading">Manufacturing readiness</h2>
                  <p>
                    Production signals kept separate from a single manufacturing
                    request.
                  </p>
                </div>
              </div>

              <div className="pp-ready-grid">
                <article className="pp-ready-card">
                  <h3>Prototype status</h3>
                  <p className="pp-ready-value">
                    {prototypeLabel(project.manufacturing.prototypeStatus)}
                  </p>
                </article>
                <article className="pp-ready-card">
                  <h3>Expected volume</h3>
                  <p className="pp-ready-value">
                    {project.manufacturing.expectedVolume}
                  </p>
                </article>
                <article className="pp-ready-card">
                  <h3>Timeline</h3>
                  <p className="pp-ready-value">
                    {project.manufacturing.timeline}
                  </p>
                </article>
                <article className="pp-ready-card pp-ready-card-wide">
                  <h3>Known constraints</h3>
                  <ul className="pp-constraint-list">
                    {project.manufacturing.constraints.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              </div>
            </section>

            {/* D. Ecosystem Connections */}
            <section
              className="pp-section"
              aria-labelledby="pp-ecosystem-heading"
            >
              <div className="pp-section-head">
                <div>
                  <h2 id="pp-ecosystem-heading">Ecosystem connections</h2>
                  <p>
                    Linked activity for manufacturing needs, shortlists,
                    engagements, and supporting roles.
                  </p>
                </div>
                <div className="pp-section-actions">
                  {readOnly ? (
                    <>
                      <Button type="button" variant="primary" disabled>
                        Create Manufacturing Need
                      </Button>
                      <Button type="button" variant="ghost" disabled>
                        Create Supporting Need
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        href={formalNeedNewPath({ projectId: project.id })}
                        variant="primary"
                      >
                        Create Manufacturing Need
                      </Button>
                      <Button
                        href={`/needs/new?projectId=${encodeURIComponent(project.id)}&from=collaboration&type=supporting`}
                        variant="ghost"
                      >
                        Create Supporting Need
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="pp-eco-grid">
                <EcosystemCard
                  title="Linked Needs"
                  description="Manufacturing requirements connected to this project."
                  items={project.linkedNeeds}
                  emptyMessage="No manufacturing needs linked yet."
                />
                <EcosystemCard
                  title="Shortlist"
                  description="Potential manufacturers or ecosystem partners shortlisted for the project."
                  items={project.shortlist}
                  emptyMessage="No partners shortlisted yet."
                />
                <EcosystemCard
                  title="Engagements"
                  description="Existing project-related interactions."
                  items={project.engagements}
                  emptyMessage="No engagements recorded yet."
                />
                <EcosystemCard
                  title="Supporting Requests"
                  description="Vendors, logistics, labour, legal/audit, investors, market leads, and more."
                  items={project.supportingRequests}
                  emptyMessage="No supporting-role requests yet."
                />
              </div>
            </section>

            {/* E. Team / Organization Ownership */}
            <section
              className="pp-section"
              aria-labelledby="pp-ownership-heading"
            >
              <div className="pp-section-head">
                <div>
                  <h2 id="pp-ownership-heading">Team / organization ownership</h2>
                  <p>
                    Who owns this project identity and how verification is
                    progressing.
                  </p>
                </div>
              </div>

              <div className="pp-ownership-card">
                <div className="pp-ownership-grid">
                  <div>
                    <h3>Project owner</h3>
                    <p className="pp-ready-value">{project.ownership.ownerName}</p>
                    <p className="pp-muted">{project.ownership.ownerRole}</p>
                  </div>
                  <div>
                    <h3>Team / organization</h3>
                    <p className="pp-ready-value">
                      {project.ownership.organizationName}
                    </p>
                    <p className="pp-muted">
                      {project.ownership.organizationVerified
                        ? "Organization verified"
                        : "Organization verification pending"}
                    </p>
                  </div>
                  <div>
                    <h3>Ownership status</h3>
                    <p className="pp-ready-value">
                      {project.ownership.ownershipStatus === "verified"
                        ? "Verified"
                        : project.ownership.ownershipStatus === "pending"
                          ? "Pending verification"
                          : "Unverified"}
                    </p>
                  </div>
                  <div>
                    <h3>Confidentiality</h3>
                    <p className="pp-ready-value">
                      {confidentialityLabel(project.confidentiality)}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Archive — secondary / non-dominant */}
            <section className="pp-archive" aria-label="Archive project">
              <div>
                <h2>Archive</h2>
                <p>
                  Archiving makes this project primarily informational. You can
                  keep historical context without continuing active matching.
                </p>
              </div>
              <Button
                type="button"
                variant="text"
                className="pp-archive-btn"
                disabled={isArchived}
                onClick={() => setArchivedOverride(true)}
              >
                {isArchived ? "Archived" : "Archive project"}
              </Button>
            </section>
          </>
        ) : null}
      </div>

      {editOpen ? (
        <div
          className="pp-modal-backdrop"
          role="presentation"
          onClick={() => setEditOpen(false)}
        >
          <div
            className="pp-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pp-edit-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="pp-edit-title">Edit Visionary project</h3>
            <p className="pp-muted">
              Update the project identity and manufacturing readiness. Confidential
              IP stays private by default.
            </p>

            <div className="pp-edit-form">
              <label className="pp-field">
                Project title
                <input
                  value={draft.title}
                  onChange={(e) =>
                    setDraft((current) => ({ ...current, title: e.target.value }))
                  }
                />
              </label>
              <label className="pp-field">
                Plain-language summary
                <textarea
                  rows={3}
                  value={draft.summary}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      summary: e.target.value,
                    }))
                  }
                />
              </label>
              <div className="pp-edit-grid">
                <label className="pp-field">
                  Stage
                  <input
                    value={draft.stage}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        stage: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="pp-field">
                  Industry
                  <input
                    value={draft.industry}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        industry: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <label className="pp-field">
                Target geography
                <input
                  value={draft.targetGeography}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      targetGeography: e.target.value,
                    }))
                  }
                />
              </label>
              <div className="pp-edit-grid">
                <label className="pp-field">
                  Project status
                  <select
                    value={draft.status}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        status: e.target.value as ProjectLifecycleStatus,
                      }))
                    }
                  >
                    <option value="private_draft">Private draft</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                <label className="pp-field">
                  Visibility
                  <select
                    value={draft.visibility}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        visibility: e.target.value as ProjectVisibility,
                      }))
                    }
                  >
                    <option value="private">Private</option>
                    <option value="redacted_published">Redacted / published</option>
                  </select>
                </label>
              </div>
              <label className="pp-field">
                Confidentiality
                <select
                  value={draft.confidentiality}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      confidentiality: e.target.value as ConfidentialityLevel,
                    }))
                  }
                >
                  <option value="public_safe">Public-safe</option>
                  <option value="redacted">Redacted</option>
                  <option value="confidential">Confidential</option>
                  <option value="restricted">Restricted</option>
                </select>
              </label>
              <label className="pp-field">
                Public-safe description
                <textarea
                  rows={3}
                  value={draft.publicDescription}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      publicDescription: e.target.value,
                    }))
                  }
                />
              </label>
              <label className="pp-field">
                Redacted overview
                <textarea
                  rows={3}
                  value={draft.redactedOverview}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      redactedOverview: e.target.value,
                    }))
                  }
                />
              </label>
              <div className="pp-edit-grid">
                <label className="pp-field">
                  Prototype status
                  <select
                    value={draft.prototypeStatus}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        prototypeStatus: e.target.value as PrototypeStatus,
                      }))
                    }
                  >
                    <option value="concept">Concept</option>
                    <option value="in_development">In development</option>
                    <option value="prototype">Prototype</option>
                    <option value="ready_for_manufacturing">
                      Ready for manufacturing
                    </option>
                  </select>
                </label>
                <label className="pp-field">
                  Expected volume
                  <input
                    value={draft.expectedVolume}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        expectedVolume: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <label className="pp-field">
                Manufacturing timeline
                <input
                  value={draft.timeline}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      timeline: e.target.value,
                    }))
                  }
                />
              </label>
              <label className="pp-field">
                Known constraints (one per line)
                <textarea
                  rows={4}
                  value={draft.constraintsText}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      constraintsText: e.target.value,
                    }))
                  }
                />
              </label>
              <div className="pp-edit-grid">
                <label className="pp-field">
                  Project owner
                  <input
                    value={draft.ownerName}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        ownerName: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="pp-field">
                  Organization
                  <input
                    value={draft.organizationName}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        organizationName: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            </div>

            <div className="pp-modal-actions">
              <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={saveEditForm}>
                Save changes
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
