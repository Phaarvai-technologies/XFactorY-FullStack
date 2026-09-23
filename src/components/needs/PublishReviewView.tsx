"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type {
  PublishFileAttachment,
  PublishReviewModel,
  PublishVisibility,
} from "@/lib/needs/publishTypes";
import { needRequirementsPath, needComparePath } from "@/lib/needs/paths";
import { needTypeLabel } from "@/lib/needs/templates";
import {
  projectCollaborationPath,
  projectProfilePath,
} from "@/lib/projects/paths";

type PublishReviewViewProps = {
  initialReview: PublishReviewModel;
};

const CONFIRMATIONS = [
  {
    id: "version",
    label: "I reviewed the requirement version.",
  },
  {
    id: "fields",
    label: "I reviewed field visibility.",
  },
  {
    id: "files",
    label: "I reviewed file visibility.",
  },
  {
    id: "external",
    label: "I understand what other Organizations can see.",
  },
  {
    id: "warnings",
    label: "I reviewed unresolved unknowns and warnings.",
  },
] as const;

function visibilityLabel(value: PublishVisibility): string {
  switch (value) {
    case "shared":
      return "Shared";
    case "restricted":
      return "Restricted";
    case "private":
      return "Private";
  }
}

function visibilityHint(value: PublishVisibility): string {
  switch (value) {
    case "shared":
      return "Visible to eligible Organizations";
    case "restricted":
      return "Visible only under permitted conditions";
    case "private":
      return "Not shared during matching/publication";
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function cycleVisibility(current: PublishVisibility): PublishVisibility {
  if (current === "shared") return "restricted";
  if (current === "restricted") return "private";
  return "shared";
}

export function PublishReviewView({ initialReview }: PublishReviewViewProps) {
  const [review, setReview] = useState(initialReview);
  const [checks, setChecks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CONFIRMATIONS.map((item) => [item.id, false])),
  );
  const [pageState, setPageState] = useState<
    "review" | "published" | "failed"
  >("review");
  const [draftSaved, setDraftSaved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [visibilityPanelOpen, setVisibilityPanelOpen] = useState(false);

  const latestVersion = review.draft.versions[0];
  const unresolved = review.fields.filter(
    (field) =>
      field.classification === "unknown" ||
      field.status === "missing" ||
      field.status === "suggested" ||
      !field.value.trim(),
  );
  const disclosureItems = [
    ...review.fields.filter((field) => field.visibility !== "shared"),
    ...review.files.filter((file) => file.visibility !== "shared" || file.sensitive),
  ];
  const blockingFails = review.validationChecks.filter(
    (check) => check.state === "fail",
  );
  const allConfirmed = CONFIRMATIONS.every((item) => checks[item.id]);

  const publishDisabled =
    !review.canPublish ||
    review.versionStale ||
    (review.verificationRequired &&
      review.validationChecks.some(
        (check) => check.id === "org" && check.state === "fail",
      )) ||
    blockingFails.length > 0 ||
    !allConfirmed ||
    !review.publicationEligible;

  const pageMode = useMemo(() => {
    if (pageState === "published") return "published";
    if (pageState === "failed") return "failed";
    if (review.versionStale) return "version_changed";
    if (!review.canPublish) return "permission";
    if (
      review.verificationRequired &&
      review.validationChecks.some((c) => c.id === "org" && c.state === "fail")
    ) {
      return "verification";
    }
    if (blockingFails.length > 0 || !review.publicationEligible) {
      return "blocked";
    }
    if (disclosureItems.length > 0) return "disclosure";
    return "ready";
  }, [
    pageState,
    review,
    blockingFails.length,
    disclosureItems.length,
  ]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  }

  function updateFieldVisibility(itemId: string) {
    setReview((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.itemId === itemId
          ? { ...field, visibility: cycleVisibility(field.visibility) }
          : field,
      ),
      validationChecks: current.validationChecks.map((check) =>
        check.id === "visibility"
          ? {
              ...check,
              state: "pass",
              detail: "Field visibility updated on this review",
            }
          : check,
      ),
    }));
    setChecks((current) => ({ ...current, fields: false, external: false }));
    showToast("Field visibility updated — preview refreshed.");
  }

  function updateFileVisibility(fileId: string) {
    setReview((current) => ({
      ...current,
      files: current.files.map((file) => {
        if (file.id !== fileId) return file;
        const visibility = cycleVisibility(file.visibility);
        return {
          ...file,
          visibility,
          includedInPublishedView: visibility !== "private",
        };
      }),
      validationChecks: current.validationChecks.map((check) =>
        check.id === "sensitive" || check.id === "visibility"
          ? {
              ...check,
              state: "pass",
              detail: "File visibility updated on this review",
            }
          : check,
      ),
    }));
    setChecks((current) => ({ ...current, files: false, external: false }));
    showToast("File visibility updated — preview refreshed.");
  }

  function handleSaveDraft() {
    setDraftSaved(true);
    showToast("Private draft saved — not published.");
  }

  function handlePublish() {
    if (publishDisabled) return;
    if (review.versionStale) {
      setPageState("failed");
      return;
    }
    // Frontend publication handoff — connect to publish API later.
    const ok = true;
    if (ok) {
      setPageState("published");
      showToast("Requirement published.");
    } else {
      setPageState("failed");
      showToast("Publication failed — draft remains saved.");
    }
  }

  const sharedFields = review.fields.filter(
    (field) =>
      field.visibility === "shared" &&
      field.classification !== "not_applicable" &&
      field.value.trim(),
  );
  const privateFields = review.fields.filter(
    (field) => field.visibility === "private" || field.visibility === "restricted",
  );

  if (pageState === "published") {
    return (
      <div className="req-editor project-profile publish-review">
        <div className="wrap">
          <div className="pp-banner pp-banner-info" role="status">
            <strong>Published.</strong> Version {review.reviewedVersion} is live
            for eligible Organizations in {review.marketplaceView}.
          </div>
          <header className="pp-header" style={{ borderBottom: "none" }}>
            <div className="pp-header-main">
              <p className="pp-eyebrow">Publication success</p>
              <h1>{review.draft.title}</h1>
              <p className="pp-summary">
                Published version {review.reviewedVersion} ·{" "}
                {formatTimestamp(new Date().toISOString())} ·{" "}
                {review.organizationName}
              </p>
              <div className="pp-badges">
                <span className="pp-badge">Published</span>
                <span className="pp-badge pp-badge-soft">
                  Shared fields:{" "}
                  {
                    review.fields.filter((f) => f.visibility === "shared").length
                  }
                </span>
                <span className="pp-badge pp-badge-soft">
                  Matching:{" "}
                  {review.matchingEligible ? "Eligible" : "Limited"}
                </span>
              </div>
            </div>
          </header>
          <div className="re-final-actions">
            <Button href={needComparePath(review.draft.id)} variant="primary">
              Compare Candidates
            </Button>
            <Button href={projectProfilePath(review.draft.projectId)} variant="ghost">
              Return to Project
            </Button>
            <Button href="/app" variant="ghost">
              Return to Dashboard
            </Button>
            <Button
              href={projectCollaborationPath(review.draft.projectId)}
              variant="text"
            >
              Back to collaboration
            </Button>
          </div>
        </div>
        {toast ? (
          <div className="pub-toast" role="status">
            {toast}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="req-editor project-profile publish-review">
      <div className="wrap">
        <div className="pc-back">
          <Button href={needRequirementsPath(review.draft.id)} variant="text">
            ← Back to Edit
          </Button>
        </div>

        {pageMode === "version_changed" ? (
          <div className="pp-banner pp-banner-warn" role="alert">
            <strong>Version changed.</strong> This requirement was updated after
            you opened the publish review. Review the latest version before
            publishing.
            <Button
              href={needRequirementsPath(review.draft.id)}
              variant="ghost"
            >
              Review latest version
            </Button>
          </div>
        ) : null}

        {pageMode === "permission" ? (
          <div className="pp-banner pp-banner-warn" role="alert">
            <strong>Permission required.</strong> You can review this page, but
            you do not have authorization to publish.
          </div>
        ) : null}

        {pageMode === "verification" ? (
          <div className="pp-banner pp-banner-warn" role="alert">
            <strong>Verification required.</strong> Publication cannot continue
            until the required verification step is completed.
            <Button href="/organization/verification" variant="ghost">
              Go to verification
            </Button>
          </div>
        ) : null}

        {pageMode === "blocked" ? (
          <div className="pp-banner pp-banner-warn" role="status">
            <strong>Blocked by validation.</strong> Resolve blocking issues in
            the Requirement Editor before publishing.
            <Button
              href={needRequirementsPath(review.draft.id)}
              variant="ghost"
            >
              Back to Edit
            </Button>
          </div>
        ) : null}

        {pageMode === "disclosure" || disclosureItems.length > 0 ? (
          <div className="pp-banner pp-banner-info" role="status">
            <strong>Disclosure warning.</strong> Some fields or files are marked
            restricted or sensitive. Review visibility before publishing.
            <button
              type="button"
              className="pp-banner-action"
              onClick={() => setVisibilityPanelOpen(true)}
            >
              Review Visibility
            </button>
          </div>
        ) : null}

        {pageMode === "ready" ? (
          <div className="pp-banner pp-banner-info" role="status">
            <strong>Ready.</strong> Required checks are complete. Confirm the
            items below, then publish this exact version.
          </div>
        ) : null}

        {pageState === "failed" ? (
          <div className="pp-banner pp-banner-warn" role="alert">
            <strong>Publish failed.</strong> Your requirement draft remains
            saved. The reviewed version is still current
            {draftSaved ? " (private draft saved)" : ""}.
            <Button type="button" variant="ghost" onClick={() => setPageState("review")}>
              Retry
            </Button>
          </div>
        ) : null}

        {/* 1. Header */}
        <header className="pp-header">
          <div className="pp-header-main">
            <p className="pp-eyebrow">Publish confirmation</p>
            <h1>Publish Requirement</h1>
            <p className="pp-summary">
              Review exactly what will be shared with other Organizations before
              publishing. Entering this page does not publish anything.
            </p>
            <div className="pp-badges">
              <span className="pp-badge">{review.draft.title}</span>
              <span className="pp-badge pp-badge-soft">ID: {review.draft.id}</span>
              <span className="pp-badge">Version {review.reviewedVersion}</span>
              <span className="pp-badge pp-badge-soft">
                {review.draft.draftStatus.replaceAll("_", " ")}
              </span>
            </div>
          </div>
        </header>

        <div className="re-summary-grid pub-meta-grid">
          <div>
            <h3>Need title</h3>
            <p className="pp-ready-value">{review.draft.title}</p>
          </div>
          <div>
            <h3>Need type</h3>
            <p className="pp-ready-value">
              {needTypeLabel(review.draft.needType)}
            </p>
          </div>
          <div>
            <h3>Publisher</h3>
            <p className="pp-ready-value">{review.draft.requesterName}</p>
          </div>
          <div>
            <h3>Organization</h3>
            <p className="pp-ready-value">{review.organizationName}</p>
          </div>
          <div>
            <h3>Version status</h3>
            <p className="pp-ready-value">
              {review.versionStale ? "Stale — refresh required" : "Current"}
            </p>
          </div>
          <div>
            <h3>Last updated</h3>
            <p className="pp-ready-value">
              {formatTimestamp(review.draft.lastUpdated)}
            </p>
          </div>
          <div>
            <h3>Publish status</h3>
            <p className="pp-ready-value">
              {review.publicationEligible ? "Eligible" : "Not eligible yet"}
            </p>
          </div>
          <div>
            <h3>Confidentiality</h3>
            <p className="pp-ready-value">{review.draft.confidentiality}</p>
          </div>
        </div>

        {/* 2. Version summary */}
        <section className="pp-section" aria-labelledby="pub-version-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pub-version-heading">Requirement version &amp; change summary</h2>
              <p>Confirm the exact version you are about to publish.</p>
            </div>
          </div>
          <div className="re-version-card">
            <div className="re-version-top">
              <div>
                <h3>Version {review.reviewedVersion}</h3>
                <p className="pp-muted">
                  Updated{" "}
                  {latestVersion
                    ? formatTimestamp(latestVersion.savedAt)
                    : formatTimestamp(review.draft.lastUpdated)}
                  {" · "}
                  Updated by{" "}
                  {latestVersion?.author ?? review.draft.requesterName}
                </p>
              </div>
            </div>
            <p className="re-change-copy">
              <strong>Change reason:</strong>{" "}
              {latestVersion?.changeReason ||
                review.draft.pendingChangeSummary ||
                "No change reason recorded for this version."}
            </p>
            <p className="re-change-copy">
              <strong>Summary:</strong>{" "}
              {latestVersion?.changeSummary ?? "No prior change summary."}
            </p>
            <ul className="pub-change-list">
              <li>+ {review.changeCounts.added} requirements added</li>
              <li>~ {review.changeCounts.modified} requirements modified</li>
              <li>↔ {review.changeCounts.reclassified} requirements reclassified</li>
              <li>- {review.changeCounts.removed} requirements removed</li>
            </ul>
          </div>
        </section>

        {/* 3. Visibility by field */}
        <section className="pp-section" aria-labelledby="pub-fields-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pub-fields-heading">Visibility by field</h2>
              <p>
                Shared · Restricted · Private — change visibility without leaving
                this workflow.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={!review.canPublish}
              onClick={() => setVisibilityPanelOpen(true)}
            >
              Change Visibility
            </Button>
          </div>
          <ul className="re-item-list">
            {review.fields.map((field) => (
              <li key={field.itemId} className="re-item-card">
                <div className="re-item-top">
                  <div>
                    <h4>{field.name}</h4>
                    <p className="pc-related">{field.categoryLabel}</p>
                  </div>
                  <span
                    className={`pp-chip pub-vis-${field.visibility}`}
                  >
                    {visibilityLabel(field.visibility)}
                  </span>
                </div>
                <p className="pp-muted">{visibilityHint(field.visibility)}</p>
                <div className="pc-thread-actions">
                  <Button
                    type="button"
                    variant="text"
                    disabled={!review.canPublish}
                    onClick={() => updateFieldVisibility(field.itemId)}
                  >
                    Change visibility
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* 4. Files */}
        <section className="pp-section" aria-labelledby="pub-files-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pub-files-heading">Files &amp; attachments visibility</h2>
              <p>Sensitive files stay visually clear without a new design language.</p>
            </div>
          </div>
          <ul className="re-item-list">
            {review.files.map((file) => (
              <li
                key={file.id}
                className={`re-item-card${file.sensitive ? " pub-file-sensitive" : ""}`}
              >
                <div className="re-item-top">
                  <div>
                    <h4>{file.fileName}</h4>
                    <p className="pp-muted">{file.fileType}</p>
                  </div>
                  <div className="pp-badges">
                    <span className={`pp-chip pub-vis-${file.visibility}`}>
                      {visibilityLabel(file.visibility)}
                    </span>
                    {file.sensitive ? (
                      <span className="pp-badge pp-badge-soft">Sensitive</span>
                    ) : null}
                  </div>
                </div>
                <p className="pp-muted">
                  {file.includedInPublishedView
                    ? file.visibility === "restricted"
                      ? "Requires permitted access"
                      : "Included in published view"
                    : "Not included"}
                </p>
                <div className="pc-thread-actions">
                  <Button
                    type="button"
                    variant="text"
                    disabled={!review.canPublish}
                    onClick={() => updateFileVisibility(file.id)}
                  >
                    Change visibility
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* 5. External preview */}
        <section className="pp-section" aria-labelledby="pub-preview-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pub-preview-heading">What other Organizations will see</h2>
              <p>
                Preview — This is what eligible Organizations will see after
                publication.
              </p>
            </div>
          </div>
          <div className="pub-preview-grid">
            <article className="pub-preview-card">
              <h3>Visible to other Organizations</h3>
              <dl className="pub-preview-dl">
                <div>
                  <dt>Need</dt>
                  <dd>{review.draft.title}</dd>
                </div>
                {sharedFields.map((field) => (
                  <div key={field.itemId}>
                    <dt>{field.name}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
                {review.files
                  .filter((file) => file.visibility === "shared" && file.includedInPublishedView)
                  .map((file) => (
                    <div key={file.id}>
                      <dt>File</dt>
                      <dd>{file.fileName}</dd>
                    </div>
                  ))}
              </dl>
            </article>
            <article className="pub-preview-card pub-preview-private">
              <h3>Private / internal information</h3>
              <ul className="pub-hidden-list">
                {privateFields.map((field) => (
                  <li key={field.itemId}>
                    <strong>{field.name}</strong>
                    <span>
                      {field.visibility === "restricted"
                        ? "Restricted — hidden in open preview"
                        : "Private — hidden"}
                    </span>
                  </li>
                ))}
                {review.files
                  .filter((file) => file.visibility !== "shared")
                  .map((file: PublishFileAttachment) => (
                    <li key={file.id}>
                      <strong>{file.fileName}</strong>
                      <span>
                        {file.visibility === "private"
                          ? "Private file — not included"
                          : "Restricted file — permitted access only"}
                      </span>
                    </li>
                  ))}
                <li>
                  <strong>Confidential information</strong>
                  <span>Hidden</span>
                </li>
              </ul>
            </article>
          </div>
        </section>

        {/* 6. Unresolved unknowns */}
        <section className="pp-section" aria-labelledby="pub-unknowns-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pub-unknowns-heading">Unresolved unknowns</h2>
              <p>
                Unknown values stay marked as unknown — you are not forced to
                invent information.
              </p>
            </div>
          </div>
          {unresolved.length === 0 ? (
            <div className="pp-empty">No unresolved unknowns in this version.</div>
          ) : (
            <ul className="re-item-list">
              {unresolved.map((field) => (
                <li key={field.itemId} className="re-item-card re-item-missing">
                  <div className="re-item-top">
                    <h4>{field.name}</h4>
                    <span className="pp-chip pp-chip-open">
                      {field.classification === "unknown"
                        ? "Unknown"
                        : field.status === "missing"
                          ? "Missing"
                          : "Unconfirmed"}
                    </span>
                  </div>
                  <p className="pp-muted">
                    Current value: {field.value.trim() || "—"}
                  </p>
                  <p className="pp-muted">
                    This information may affect manufacturer matching precision.
                  </p>
                  <div className="pc-thread-actions">
                    <Button
                      href={needRequirementsPath(review.draft.id)}
                      variant="ghost"
                    >
                      Back to Edit
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 7. Validation */}
        <section className="pp-section" aria-labelledby="pub-validation-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pub-validation-heading">Validation &amp; publication checks</h2>
              <p>Informative checks before confirmation.</p>
            </div>
          </div>
          <ul className="pub-check-list">
            {review.validationChecks.map((check) => (
              <li key={check.id} className={`pub-check pub-check-${check.state}`}>
                <span className="pub-check-mark" aria-hidden>
                  {check.state === "pass" ? "✓" : check.state === "warn" ? "⚠" : "✕"}
                </span>
                <div>
                  <strong>{check.label}</strong>
                  {check.detail ? <p>{check.detail}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* 8. Eligibility */}
        <section className="pp-section" aria-labelledby="pub-elig-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pub-elig-heading">Eligibility &amp; matching impact</h2>
              <p>
                Factually reflects the current requirement state — nothing is
                auto-changed.
              </p>
            </div>
          </div>
          <div className="re-summary-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <h3>Publication</h3>
              <p className="pp-ready-value">
                {review.publicationEligible ? "Eligible" : "Not eligible"}
              </p>
            </div>
            <div>
              <h3>Matching</h3>
              <p className="pp-ready-value">
                {review.matchingEligible
                  ? review.matchingLimitations.length > 0
                    ? "Eligible with limitations"
                    : "Eligible"
                  : "Not eligible"}
              </p>
            </div>
          </div>
          {review.matchingLimitations.length > 0 ? (
            <ul className="pub-change-list" style={{ marginTop: 14 }}>
              {review.matchingLimitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="pp-muted" style={{ marginTop: 14 }}>
              No matching limitations detected for this version.
            </p>
          )}
        </section>

        {/* 10. Org context */}
        <section className="pp-section" aria-labelledby="pub-org-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pub-org-heading">Organization / work-view context</h2>
              <p>Publication context before confirmation.</p>
            </div>
          </div>
          <div className="re-save-card">
            <div className="re-summary-grid" style={{ background: "transparent", border: "none", padding: 0 }}>
              <div>
                <h3>Publishing as</h3>
                <p className="pp-ready-value">{review.organizationName}</p>
              </div>
              <div>
                <h3>Requirement owner</h3>
                <p className="pp-ready-value">{review.draft.requesterName}</p>
              </div>
              <div>
                <h3>Marketplace / work view</h3>
                <p className="pp-ready-value">{review.marketplaceView}</p>
              </div>
              <div>
                <h3>Visible to</h3>
                <p className="pp-ready-value">{review.visibleTo}</p>
              </div>
            </div>
            <p className="pp-muted" style={{ marginTop: 14 }}>
              Access follows existing Organization rules. Private and restricted
              items stay controlled after publication.
            </p>
          </div>
        </section>

        {/* 11. Confirmation */}
        <section className="pp-section" aria-labelledby="pub-confirm-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pub-confirm-heading">Confirm publication</h2>
              <p>
                Publish stays disabled until required confirmations are completed
                and blocking checks are clear.
              </p>
            </div>
          </div>
          <div className="re-save-card">
            <p className="pp-muted" style={{ marginTop: 0 }}>
              I confirm that I am publishing <strong>version {review.reviewedVersion}</strong>{" "}
              of <strong>{review.draft.title}</strong>.
            </p>
            <ul className="pub-confirm-list">
              {CONFIRMATIONS.map((item) => (
                <li key={item.id}>
                  <label className="pc-check">
                    <input
                      type="checkbox"
                      checked={Boolean(checks[item.id])}
                      disabled={!review.canPublish || review.versionStale}
                      onChange={(e) =>
                        setChecks((current) => ({
                          ...current,
                          [item.id]: e.target.checked,
                        }))
                      }
                    />
                    {item.label}
                  </label>
                </li>
              ))}
            </ul>
            <div className="re-final-actions">
              <Button
                href={needRequirementsPath(review.draft.id)}
                variant="ghost"
              >
                Back to Edit
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={!review.canPublish}
                onClick={handleSaveDraft}
              >
                Save Private Draft
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={publishDisabled}
                onClick={handlePublish}
              >
                Publish
              </Button>
            </div>
            {publishDisabled ? (
              <p className="pp-muted">
                Complete all confirmations and resolve blocking validation issues
                before publishing.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      {visibilityPanelOpen ? (
        <div
          className="pc-modal-backdrop"
          role="presentation"
          onClick={() => setVisibilityPanelOpen(false)}
        >
          <div
            className="pc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pub-vis-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="pub-vis-title">Review visibility</h3>
            <p className="pp-muted">
              Cycle Shared → Restricted → Private. The external preview updates
              immediately.
            </p>
            <div className="pub-vis-modal-list">
              {review.fields.slice(0, 8).map((field) => (
                <div key={field.itemId} className="pub-vis-row">
                  <span>{field.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => updateFieldVisibility(field.itemId)}
                  >
                    {visibilityLabel(field.visibility)}
                  </Button>
                </div>
              ))}
              {review.files.map((file) => (
                <div key={file.id} className="pub-vis-row">
                  <span>{file.fileName}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => updateFileVisibility(file.id)}
                  >
                    {visibilityLabel(file.visibility)}
                  </Button>
                </div>
              ))}
            </div>
            <div className="pc-modal-actions">
              <Button
                type="button"
                variant="primary"
                onClick={() => setVisibilityPanelOpen(false)}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="pub-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
