"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  CLOSE_OUTCOME_OPTIONS,
  DATA_FEEDBACK_OPTIONS,
  feedbackLabel,
  outcomeLabel,
  type CloseOutcomeReason,
  type DataFeedbackOption,
} from "@/lib/engagements/closeTypes";
import { engagementWorkspacePath } from "@/lib/engagements/workspaceData";
import type { EngagementWorkspace } from "@/lib/engagements/workspaceTypes";

type CloseEngagementViewProps = {
  workspace: EngagementWorkspace;
  canReopen?: boolean;
  initiallyExpired?: boolean;
};

type Step = "form" | "confirm" | "closed" | "expired";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function CloseEngagementView({
  workspace,
  canReopen = true,
  initiallyExpired = false,
}: CloseEngagementViewProps) {
  const [step, setStep] = useState<Step>(
    initiallyExpired ? "expired" : "form",
  );
  const [reason, setReason] = useState<CloseOutcomeReason | "">("");
  const [otherReason, setOtherReason] = useState("");
  const [privateNotes, setPrivateNotes] = useState("");
  const [feedback, setFeedback] = useState<DataFeedbackOption | "">("");
  const [feedbackOther, setFeedbackOther] = useState("");
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackRecorded, setFeedbackRecorded] = useState(false);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [permissionDenied] = useState(!workspace.canAccess);

  const validationError = useMemo(() => {
    if (!reason) return "Select an outcome reason before closing.";
    if (reason === "other" && !otherReason.trim()) {
      return "Provide a short explanation for Other.";
    }
    return null;
  }, [reason, otherReason]);

  const feedbackError = useMemo(() => {
    if (!feedback) return null;
    if (feedback === "other" && !feedbackOther.trim()) {
      return "Provide a short explanation for Other feedback.";
    }
    return null;
  }, [feedback, feedbackOther]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  }

  function handleReview() {
    if (validationError) {
      showToast(validationError);
      return;
    }
    setStep("confirm");
  }

  function handleClose() {
    if (validationError) {
      showToast(validationError);
      return;
    }
    setClosedAt(new Date().toISOString());
    setStep("closed");
    showToast("Engagement closed. Outcome recorded.");
  }

  function handleSubmitFeedback() {
    if (!feedback) {
      showToast("Select a feedback option before submitting.");
      return;
    }
    if (feedbackError) {
      showToast(feedbackError);
      return;
    }
    setFeedbackRecorded(true);
    showToast("Feedback recorded. This is not a public review.");
  }

  function workspaceReturnHref() {
    const params = new URLSearchParams();
    if (step === "closed" || step === "expired") {
      params.set("closed", "1");
      if (reason) params.set("outcome", reason);
      if (reason === "proceeded_outside") params.set("signal", "success");
      if (reason === "no_fit") params.set("signal", "no_fit");
      if (step === "expired") params.set("expired", "1");
      if (feedbackRecorded) params.set("feedback", "1");
    }
    const query = params.toString();
    return `${engagementWorkspacePath(workspace.id)}${query ? `?${query}` : ""}`;
  }

  if (permissionDenied) {
    return (
      <div className="req-editor project-profile eng-close">
        <div className="wrap" style={{ maxWidth: 720 }}>
          <div className="pp-banner pp-banner-warn" role="alert">
            <strong>Permission required.</strong> Only authorized engagement
            participants can close this engagement.
          </div>
          <Button href={engagementWorkspacePath(workspace.id)} variant="primary">
            Return to engagement
          </Button>
        </div>
      </div>
    );
  }

  if (step === "closed" || step === "expired") {
    const successSignal = reason === "proceeded_outside";
    const noFit = reason === "no_fit";

    return (
      <div className="req-editor project-profile eng-close">
        <div className="wrap" style={{ maxWidth: 720 }}>
          <div
            className={`pp-banner ${
              step === "expired"
                ? "pp-banner-muted"
                : successSignal
                  ? "pp-banner-info"
                  : "pp-banner-muted"
            }`}
            role="status"
          >
            {step === "expired" ? (
              <>
                <strong>Expired.</strong> This engagement reached an expiration
                condition. History remains available.
              </>
            ) : successSignal ? (
              <>
                <strong>Closed — outcome recorded.</strong> Participants indicated
                they proceeded outside the platform. This is not a completed X!Y
                transaction.
              </>
            ) : noFit ? (
              <>
                <strong>Closed — no fit.</strong> The opportunity was recorded as
                not suitable. This is a structured outcome signal, not a public
                review.
              </>
            ) : (
              <>
                <strong>Closed.</strong> Outcome recorded:{" "}
                {reason ? outcomeLabel(reason) : "—"}.
              </>
            )}
          </div>

          <header className="pp-header" style={{ borderBottom: "none" }}>
            <div className="pp-header-main">
              <p className="pp-eyebrow">Close engagement</p>
              <h1>
                {step === "expired" ? "Engagement expired" : "Engagement closed"}
              </h1>
              <p className="pp-summary">
                Engagement ID: {workspace.id}
                <br />
                Outcome:{" "}
                {step === "expired"
                  ? "Expired"
                  : reason
                    ? outcomeLabel(reason)
                    : "—"}
                <br />
                Closed: {closedAt ? formatTimestamp(closedAt) : "—"}
                <br />
                Feedback: {feedbackRecorded ? "Recorded" : "Not submitted"}
              </p>
              <div className="pp-badges">
                <span className="pp-badge">Nonbinding</span>
                <span className="pp-badge">
                  {step === "expired" ? "Expired" : "Closed"}
                </span>
                {feedbackRecorded ? (
                  <span className="pp-badge pp-badge-soft">
                    Feedback recorded
                  </span>
                ) : null}
              </div>
            </div>
          </header>

          {!feedbackRecorded ? (
            <section className="pp-section">
              <div className="re-save-card">
                <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>
                  Optional data / relevance feedback
                </h2>
                <p className="pp-muted" style={{ marginTop: 0 }}>
                  Structured product feedback only — not a public rating or review.
                </p>
                <div className="eng-close-options">
                  {DATA_FEEDBACK_OPTIONS.map((option) => (
                    <label key={option.id} className="pc-check">
                      <input
                        type="radio"
                        name="post-feedback"
                        checked={feedback === option.id}
                        onChange={() => setFeedback(option.id)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                {feedback === "other" ? (
                  <label className="pc-field">
                    Other feedback
                    <input
                      value={feedbackOther}
                      onChange={(e) => setFeedbackOther(e.target.value)}
                    />
                  </label>
                ) : null}
                <label className="pc-field">
                  Optional supporting comments
                  <textarea
                    rows={3}
                    value={feedbackComment}
                    onChange={(e) => setFeedbackComment(e.target.value)}
                  />
                </label>
                <div className="re-final-actions">
                  <Button type="button" variant="ghost" onClick={handleSubmitFeedback}>
                    Submit Feedback
                  </Button>
                </div>
              </div>
            </section>
          ) : (
            <div className="pp-banner pp-banner-info" role="status">
              <strong>Feedback recorded.</strong>{" "}
              {feedback ? feedbackLabel(feedback) : ""} Original outcome is
              unchanged.
            </div>
          )}

          <div className="re-final-actions">
            <Button href={workspaceReturnHref()} variant="primary">
              Return to engagement workspace
            </Button>
            {canReopen ? (
              <Button
                href={`${engagementWorkspacePath(workspace.id)}?reopened=1`}
                variant="ghost"
              >
                Reopen Engagement
              </Button>
            ) : null}
          </div>
          {canReopen ? (
            <p className="pp-muted">
              Reopening restores the engagement workflow and preserves the
              previous closure event and outcome history.
            </p>
          ) : null}
        </div>
        {toast ? <div className="pub-toast" role="status">{toast}</div> : null}
      </div>
    );
  }

  return (
    <div className="req-editor project-profile eng-close">
      <div className="wrap" style={{ maxWidth: 800 }}>
        <div className="pc-back">
          <Button href={engagementWorkspacePath(workspace.id)} variant="text">
            ← Cancel Close / return to workspace
          </Button>
        </div>

        <div className="pp-banner pp-banner-info" role="status">
          <strong>Nonbinding.</strong> Closing records a structured outcome on
          X!Y. It does not mean X!Y executed a transaction.
        </div>

        <header className="pp-header">
          <div className="pp-header-main">
            <p className="pp-eyebrow">Close engagement</p>
            <h1>Close Engagement / Outcome Capture</h1>
            <p className="pp-summary">
              Capture a structured, non-commercial outcome without a public review
              and without implying a completed transaction on X!Y.
            </p>
            <div className="pp-badges">
              <span className="pp-badge">Nonbinding</span>
              <span className="pp-badge pp-badge-soft">
                {statusLabel(workspace.status)}
              </span>
              <span className="pp-badge pp-badge-soft">{workspace.id}</span>
            </div>
          </div>
        </header>

        {/* Context */}
        <section className="pp-section">
          <div className="pp-section-head">
            <div>
              <h2>Engagement context</h2>
              <p>Summary of the engagement being closed.</p>
            </div>
          </div>
          <div className="re-summary-grid eng-close-context">
            <div>
              <h3>Engagement ID</h3>
              <p className="pp-ready-value">{workspace.id}</p>
            </div>
            <div>
              <h3>Request type</h3>
              <p className="pp-ready-value">{workspace.requestTypeLabel}</p>
            </div>
            <div>
              <h3>Requester</h3>
              <p className="pp-ready-value">
                {workspace.requesterOrganization}
              </p>
            </div>
            <div>
              <h3>Recipient</h3>
              <p className="pp-ready-value">
                {workspace.recipientOrganization}
              </p>
            </div>
            <div>
              <h3>Current status</h3>
              <p className="pp-ready-value">
                {statusLabel(workspace.status)}
              </p>
            </div>
            <div>
              <h3>Related Need</h3>
              <p className="pp-ready-value">{workspace.needTitle}</p>
            </div>
            <div>
              <h3>Requirement version</h3>
              <p className="pp-ready-value">v{workspace.requirementVersion}</p>
            </div>
            <div>
              <h3>Created</h3>
              <p className="pp-ready-value">
                {formatTimestamp(workspace.createdAt)}
              </p>
            </div>
          </div>
        </section>

        {step === "form" ? (
          <>
            {/* Outcome */}
            <section className="pp-section">
              <div className="pp-section-head">
                <div>
                  <h2>Outcome reason</h2>
                  <p>
                    Required. Do not share confidential commercial details.
                  </p>
                </div>
              </div>
              <div className="re-save-card">
                <div className="eng-close-options">
                  {CLOSE_OUTCOME_OPTIONS.map((option) => (
                    <label key={option.id} className="pc-check">
                      <input
                        type="radio"
                        name="outcome"
                        checked={reason === option.id}
                        onChange={() => setReason(option.id)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                {reason === "other" ? (
                  <label className="pc-field">
                    Other reason
                    <input
                      value={otherReason}
                      onChange={(e) => setOtherReason(e.target.value)}
                      placeholder="Short explanation"
                    />
                  </label>
                ) : null}
                {validationError && reason ? (
                  <p className="eng-field-error">{validationError}</p>
                ) : null}
              </div>
            </section>

            {/* Private notes */}
            <section className="pp-section">
              <div className="pp-section-head">
                <div>
                  <h2>Private Notes</h2>
                  <p>
                    For you / your authorized Organization only — not a public
                    review and not shown to the other participant.
                  </p>
                </div>
              </div>
              <div className="re-save-card">
                <label className="pc-field">
                  Private notes (optional)
                  <textarea
                    rows={4}
                    value={privateNotes}
                    onChange={(e) => setPrivateNotes(e.target.value)}
                    placeholder="Optional private context for your Organization"
                  />
                </label>
              </div>
            </section>

            {/* Feedback */}
            <section className="pp-section">
              <div className="pp-section-head">
                <div>
                  <h2>Data correction / relevance feedback</h2>
                  <p>
                    Structured product/data feedback — not a public rating,
                    star score, or reputation signal.
                  </p>
                </div>
              </div>
              <div className="re-save-card">
                <div className="eng-close-options">
                  {DATA_FEEDBACK_OPTIONS.map((option) => (
                    <label key={option.id} className="pc-check">
                      <input
                        type="radio"
                        name="feedback"
                        checked={feedback === option.id}
                        onChange={() => setFeedback(option.id)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                {feedback === "other" ? (
                  <label className="pc-field">
                    Other feedback
                    <input
                      value={feedbackOther}
                      onChange={(e) => setFeedbackOther(e.target.value)}
                    />
                  </label>
                ) : null}
                <label className="pc-field">
                  Optional supporting comments
                  <textarea
                    rows={3}
                    value={feedbackComment}
                    onChange={(e) => setFeedbackComment(e.target.value)}
                  />
                </label>
                <div className="re-final-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={feedbackRecorded}
                    onClick={handleSubmitFeedback}
                  >
                    {feedbackRecorded ? "Feedback recorded" : "Submit Feedback"}
                  </Button>
                </div>
                {feedbackRecorded ? (
                  <p className="pp-muted">
                    Feedback recorded. Engagement outcome is unchanged until you
                    close.
                  </p>
                ) : null}
              </div>
            </section>

            {/* Non-transaction */}
            <section className="pp-section">
              <div className="eng-nonbinding-notice" role="note">
                <strong>X!Y non-transaction reminder:</strong> Closing this
                engagement does not mean X!Y executed a contract, processed a
                payment, created employment, or executed an investment. Closing
                only records your stated outcome on the platform.
              </div>
            </section>

            <div className="re-final-actions">
              <Button
                href={engagementWorkspacePath(workspace.id)}
                variant="ghost"
              >
                Cancel Close
              </Button>
              <Button type="button" variant="primary" onClick={handleReview}>
                Review &amp; continue
              </Button>
            </div>
          </>
        ) : null}

        {step === "confirm" ? (
          <section className="pp-section">
            <div className="pp-section-head">
              <div>
                <h2>Confirm closure</h2>
                <p>Review before closing. You can go back and edit.</p>
              </div>
            </div>
            <div className="re-save-card">
              <dl className="pub-preview-dl">
                <div>
                  <dt>Outcome reason</dt>
                  <dd>
                    {reason ? outcomeLabel(reason) : "—"}
                    {reason === "other" && otherReason
                      ? ` — ${otherReason}`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>Private notes</dt>
                  <dd>
                    {privateNotes.trim()
                      ? "Included (Organization-private only)"
                      : "None"}
                  </dd>
                </div>
                <div>
                  <dt>Data / match feedback</dt>
                  <dd>
                    {feedbackRecorded && feedback
                      ? feedbackLabel(feedback)
                      : feedback
                        ? `${feedbackLabel(feedback)} (not submitted yet)`
                        : "None"}
                  </dd>
                </div>
                <div>
                  <dt>Action</dt>
                  <dd>
                    This closes the engagement on X!Y and preserves full history.
                  </dd>
                </div>
              </dl>
              <div className="eng-nonbinding-notice" style={{ marginTop: 16 }}>
                <strong>Nonbinding / non-transaction:</strong> This is not a
                completed X!Y transaction. No contract, payment, employment, or
                investment is executed by closing.
              </div>
              <div className="re-final-actions">
                <Button type="button" variant="ghost" onClick={() => setStep("form")}>
                  Back to edit
                </Button>
                <Button
                  href={engagementWorkspacePath(workspace.id)}
                  variant="text"
                  className="pp-archive-btn"
                >
                  Cancel Close
                </Button>
                <Button type="button" variant="primary" onClick={handleClose}>
                  Close
                </Button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
      {toast ? <div className="pub-toast" role="status">{toast}</div> : null}
    </div>
  );
}
