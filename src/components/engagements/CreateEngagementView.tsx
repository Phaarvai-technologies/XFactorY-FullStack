"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  fieldsForRequestType,
  REQUEST_TYPE_OPTIONS,
  RESPONSE_QUESTIONS,
} from "@/lib/engagements/requestTypes";
import {
  defaultRequestTypeForPersona,
  getEngagementFiles,
  initialFieldValues,
} from "@/lib/engagements/sampleData";
import type {
  EngagementContext,
  EngagementFileOption,
  EngagementRequestType,
} from "@/lib/engagements/types";
import { needComparePath } from "@/lib/needs/paths";
import { projectProfilePath } from "@/lib/projects/paths";
import {
  engagementWorkspacePath,
  SAMPLE_ENGAGEMENT_ID,
} from "@/lib/engagements/workspaceData";

type CreateEngagementViewProps = {
  context: EngagementContext;
  stepUpRequired?: boolean;
};

type PageMode = "draft" | "sending" | "sent" | "failed";

function visibilityLabel(value: EngagementFileOption["visibility"]): string {
  switch (value) {
    case "shared":
      return "Shared";
    case "restricted":
      return "Restricted";
    case "private":
      return "Private";
  }
}

export function CreateEngagementView({
  context,
  stepUpRequired = false,
}: CreateEngagementViewProps) {
  const [requestType, setRequestType] = useState<EngagementRequestType>(() =>
    defaultRequestTypeForPersona(context.recipientPersona),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialFieldValues(context),
  );
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>(() =>
    RESPONSE_QUESTIONS[defaultRequestTypeForPersona(context.recipientPersona)],
  );
  const [files, setFiles] = useState(() =>
    getEngagementFiles().map((file) => ({
      ...file,
      included: file.allowed && file.visibility === "shared",
    })),
  );
  const [fieldIncluded, setFieldIncluded] = useState<Record<string, boolean>>(
    {},
  );
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [mode, setMode] = useState<PageMode>("draft");
  const [toast, setToast] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const fieldDefs = useMemo(
    () => fieldsForRequestType(requestType),
    [requestType],
  );

  const typeMeta = REQUEST_TYPE_OPTIONS.find((option) => option.id === requestType);

  const sharedFields = fieldDefs
    .map((field) => {
      const value = (values[field.id] ?? "").trim();
      const included =
        fieldIncluded[field.id] ??
        (Boolean(value) && field.id !== "notes");
      return {
        id: field.id,
        label: field.label,
        value,
        included: included && Boolean(value),
        allowed: true,
      };
    })
    .filter((field) => field.value);

  const includedFiles = files.filter((file) => file.included && file.allowed);
  const blockedFiles = files.filter((file) => !file.allowed);

  const validationErrors = useMemo(() => {
    const errors: { id: string; message: string }[] = [];
    if (!context.recipientName) {
      errors.push({
        id: "recipient",
        message: "Recipient is missing. Select a candidate before sending.",
      });
    }
    for (const field of fieldDefs) {
      if (field.required && !(values[field.id] ?? "").trim()) {
        errors.push({
          id: field.id,
          message: `${field.label} is missing. Please provide a value before sending.`,
        });
      }
    }
    if (stepUpRequired) {
      errors.push({
        id: "stepup",
        message: "Additional verification is required before sending.",
      });
    }
    return errors;
  }, [context.recipientName, fieldDefs, values, stepUpRequired]);

  const canSend =
    validationErrors.length === 0 &&
    Boolean(context.recipientName) &&
    !stepUpRequired &&
    mode !== "sending";

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  }

  function updateValue(id: string, next: string) {
    setValues((current) => ({ ...current, [id]: next }));
    setDirty(true);
  }

  function changeRequestType(next: EngagementRequestType) {
    setRequestType(next);
    setSelectedQuestions(RESPONSE_QUESTIONS[next]);
    setDirty(true);
  }

  function toggleFile(id: string) {
    setFiles((current) =>
      current.map((file) => {
        if (file.id !== id || !file.allowed) return file;
        return { ...file, included: !file.included };
      }),
    );
    setDirty(true);
    showToast("Disclosure updated — previews refreshed.");
  }

  function toggleFieldShare(id: string) {
    setFieldIncluded((current) => ({
      ...current,
      [id]: !(current[id] ?? true),
    }));
    setDirty(true);
    showToast("Disclosure updated — previews refreshed.");
  }

  function handleSend() {
    if (!canSend) return;
    setMode("sending");
    window.setTimeout(() => {
      // Frontend send handoff — connect to engagement API later.
      const ok = true;
      if (ok) {
        setMode("sent");
        setDirty(false);
        showToast("Request sent.");
      } else {
        setMode("failed");
        showToast("Request could not be sent.");
      }
    }, 700);
  }

  function handleCancel() {
    if (dirty) {
      setShowCancelConfirm(true);
      return;
    }
    window.location.href = needComparePath(context.needId);
  }

  if (mode === "sent") {
    return (
      <div className="req-editor project-profile eng-page">
        <div className="wrap" style={{ maxWidth: 720 }}>
          <div className="pp-banner pp-banner-info" role="status">
            <strong>Request sent.</strong> Your nonbinding request was delivered
            to {context.recipientOrganization}.
          </div>
          <header className="pp-header" style={{ borderBottom: "none" }}>
            <div className="pp-header-main">
              <p className="pp-eyebrow">Engagement request</p>
              <h1>Request Sent</h1>
              <p className="pp-summary">
                Recipient: <strong>{context.recipientOrganization}</strong>
                <br />
                Request type: <strong>{typeMeta?.label}</strong>
                <br />
                Need: <strong>{context.needTitle}</strong> ({context.needId})
                <br />
                Sent: {new Date().toLocaleString()} · Status: Sent
              </p>
            </div>
          </header>
          <div className="re-final-actions">
            <Button
              href={engagementWorkspacePath(SAMPLE_ENGAGEMENT_ID)}
              variant="primary"
            >
              View Engagement
            </Button>
            <Button href={needComparePath(context.needId)} variant="ghost">
              Return to comparison
            </Button>
            <Button href={projectProfilePath(context.projectId)} variant="ghost">
              Return to Need / Project
            </Button>
            <Button href="/app" variant="text">
              Return to Dashboard
            </Button>
          </div>
        </div>
        {toast ? <div className="pub-toast" role="status">{toast}</div> : null}
      </div>
    );
  }

  return (
    <div className="req-editor project-profile eng-page">
      <div className="wrap">
        <div className="pc-back">
          <Button href={needComparePath(context.needId)} variant="text">
            ← Back to comparison
          </Button>
        </div>

        {stepUpRequired ? (
          <div className="pp-banner pp-banner-warn" role="alert">
            <strong>Additional verification required.</strong> Please complete
            the required verification before sending this request.
            <Button href="/organization/verification" variant="ghost">
              Go to verification
            </Button>
          </div>
        ) : null}

        {mode === "failed" ? (
          <div className="pp-banner pp-banner-warn" role="alert">
            <strong>Request could not be sent.</strong> Your request has not been
            lost.
            <Button type="button" variant="ghost" onClick={() => setMode("draft")}>
              Retry
            </Button>
          </div>
        ) : null}

        {mode === "sending" ? (
          <div className="pp-banner pp-banner-info" role="status">
            <strong>Sending request…</strong> Please wait. Duplicate submission
            is disabled.
          </div>
        ) : null}

        {validationErrors.length > 0 && mode === "draft" ? (
          <div className="pp-banner pp-banner-warn" role="status">
            <strong>Validation issue.</strong>{" "}
            {validationErrors[0]?.message}
          </div>
        ) : null}

        <header className="pp-header">
          <div className="pp-header-main">
            <p className="pp-eyebrow">Controlled engagement</p>
            <h1>Create Engagement Request</h1>
            <p className="pp-summary">
              Create a nonbinding request and review what will be shared before
              sending.
            </p>
            <div className="pp-badges">
              <span className="pp-badge">{context.requesterName}</span>
              <span className="pp-badge pp-badge-soft">
                {context.requesterOrganization}
              </span>
              <span className="pp-badge pp-badge-soft">
                To: {context.recipientOrganization}
              </span>
              <span className="pp-badge">Draft</span>
            </div>
          </div>
        </header>

        {/* Context */}
        <section className="pp-section" aria-labelledby="eng-context-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="eng-context-heading">Request context</h2>
              <p>Identify who will receive this request and why.</p>
            </div>
          </div>
          <div className="eng-context-grid">
            <article className="re-item-card">
              <h3>Recipient</h3>
              <p className="pp-ready-value">{context.recipientName}</p>
              <p className="pp-muted">{context.recipientOrganization}</p>
              <p className="pp-muted">
                {context.recipientPersona} · {context.recipientLocation}
              </p>
              <div className="pp-badges" style={{ marginTop: 10 }}>
                <span className="pp-badge pp-badge-soft">
                  {context.recipientVerification}
                </span>
              </div>
            </article>
            <article className="re-item-card">
              <h3>Originating need / match</h3>
              <p className="pp-ready-value">{context.needTitle}</p>
              <p className="pp-muted">Need ID: {context.needId}</p>
              <p className="pp-muted">
                {context.needType} · Version {context.requirementVersion}
              </p>
              <p className="pp-muted">
                Matched candidate: {context.candidateName}
              </p>
            </article>
          </div>
        </section>

        {/* Request type */}
        <section className="pp-section" aria-labelledby="eng-type-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="eng-type-heading">Request type</h2>
              <p>Choose a role-appropriate, nonbinding request type.</p>
            </div>
          </div>
          <div className="eng-type-grid">
            {REQUEST_TYPE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`eng-type-card${requestType === option.id ? " active" : ""}`}
                onClick={() => changeRequestType(option.id)}
                disabled={mode === "sending"}
              >
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            ))}
          </div>
          {requestType === "quote" || requestType === "investment_interest" ? (
            <p className="pp-muted" style={{ marginTop: 12 }}>
              {requestType === "quote"
                ? "This is an indicative / nonbinding quote request."
                : "This expresses nonbinding interest only — not an investment offer or commitment."}
            </p>
          ) : null}
          {requestType === "legal_audit" ? (
            <p className="pp-muted" style={{ marginTop: 12 }}>
              Sending this request does not establish a professional-client
              relationship by itself.
            </p>
          ) : null}
        </section>

        {/* Fields */}
        <section className="pp-section" aria-labelledby="eng-fields-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="eng-fields-heading">Structured request fields</h2>
              <p>
                Only include information permitted by your disclosure settings.
                Private project notes are never attached automatically.
              </p>
            </div>
          </div>
          <div className="re-save-card">
            {fieldDefs.map((field) => (
              <label key={field.id} className="pc-field">
                {field.label}
                {field.required ? " *" : ""}
                {field.kind === "textarea" ? (
                  <textarea
                    rows={3}
                    value={values[field.id] ?? ""}
                    placeholder={field.placeholder}
                    disabled={mode === "sending"}
                    onChange={(e) => updateValue(field.id, e.target.value)}
                  />
                ) : (
                  <input
                    value={values[field.id] ?? ""}
                    placeholder={field.placeholder}
                    disabled={mode === "sending"}
                    onChange={(e) => updateValue(field.id, e.target.value)}
                  />
                )}
                {validationErrors.some((error) => error.id === field.id) ? (
                  <span className="eng-field-error">
                    {validationErrors.find((error) => error.id === field.id)?.message}
                  </span>
                ) : null}
              </label>
            ))}
          </div>
        </section>

        {/* Response questions */}
        <section className="pp-section" aria-labelledby="eng-questions-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="eng-questions-heading">Response questions</h2>
              <p>
                Optional questions for the recipient — not commitments.
              </p>
            </div>
          </div>
          <ul className="eng-question-list">
            {RESPONSE_QUESTIONS[requestType].map((question) => {
              const checked = selectedQuestions.includes(question);
              return (
                <li key={question}>
                  <label className="pc-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={mode === "sending"}
                      onChange={() => {
                        setSelectedQuestions((current) =>
                          checked
                            ? current.filter((item) => item !== question)
                            : [...current, question],
                        );
                        setDirty(true);
                      }}
                    />
                    {question}
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Files */}
        <section className="pp-section" aria-labelledby="eng-files-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="eng-files-heading">Attachments / files</h2>
              <p>
                Select files from the originating need. Private files cannot be
                included.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={mode === "sending"}
              onClick={() => setDisclosureOpen(true)}
            >
              Change Disclosure
            </Button>
          </div>
          <ul className="re-item-list">
            {files.map((file) => (
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
                    {!file.allowed ? (
                      <span className="pp-badge pp-badge-soft">Not permitted</span>
                    ) : null}
                  </div>
                </div>
                <p className="pp-muted">
                  {file.included && file.allowed
                    ? "Included in this request"
                    : "Not included"}
                </p>
                <div className="pc-thread-actions">
                  <Button
                    type="button"
                    variant="text"
                    disabled={!file.allowed || mode === "sending"}
                    onClick={() => toggleFile(file.id)}
                  >
                    {file.included ? "Exclude from request" : "Include in request"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {blockedFiles.length > 0 ? (
            <p className="pp-muted" style={{ marginTop: 12 }}>
              Private/restricted files that are not permitted stay excluded and
              are never silently attached.
            </p>
          ) : null}
        </section>

        {/* Disclosure preview */}
        <section className="pp-section" aria-labelledby="eng-disclosure-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="eng-disclosure-heading">Disclosure preview</h2>
              <p>Exactly what will be shared with the recipient.</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={mode === "sending"}
              onClick={() => setDisclosureOpen(true)}
            >
              Change Disclosure
            </Button>
          </div>
          <div className="eng-preview-card">
            <h3>Recipient</h3>
            <p>{context.recipientOrganization}</p>

            <h3>Fields shared</h3>
            <ul className="eng-share-list">
              {sharedFields.filter((field) => field.included).map((field) => (
                <li key={field.id}>✓ {field.label}</li>
              ))}
              {sharedFields.filter((field) => !field.included).map((field) => (
                <li key={`x-${field.id}`} className="eng-excluded">
                  ✕ {field.label}
                </li>
              ))}
            </ul>

            <h3>Files shared</h3>
            <ul className="eng-share-list">
              {includedFiles.map((file) => (
                <li key={file.id}>✓ {file.fileName}</li>
              ))}
              {files
                .filter((file) => !file.included || !file.allowed)
                .map((file) => (
                  <li key={`x-${file.id}`} className="eng-excluded">
                    ✕ {file.fileName}
                  </li>
                ))}
            </ul>

            <h3>Confidentiality</h3>
            <p>Organization-confidential</p>

            <h3>Limitation</h3>
            <p className="pp-muted">
              This request does not grant rights to use, distribute, reproduce,
              or disclose confidential information beyond the stated request
              context.
            </p>
          </div>
        </section>

        {/* Recipient preview */}
        <section className="pp-section" aria-labelledby="eng-recipient-preview">
          <div className="pp-section-head">
            <div>
              <h2 id="eng-recipient-preview">Recipient preview</h2>
              <p>
                What the recipient will actually receive — based only on selected
                disclosure.
              </p>
            </div>
          </div>
          <div className="eng-preview-card eng-recipient-view">
            <dl className="pub-preview-dl">
              <div>
                <dt>From</dt>
                <dd>{context.requesterOrganization}</dd>
              </div>
              <div>
                <dt>Request type</dt>
                <dd>{typeMeta?.label}</dd>
              </div>
              <div>
                <dt>Subject</dt>
                <dd>{values.subject || values.service || context.needTitle}</dd>
              </div>
              <div>
                <dt>Message</dt>
                <dd>
                  {values.message ||
                    values.availability_question ||
                    values.purpose ||
                    "—"}
                </dd>
              </div>
              <div>
                <dt>Requirements</dt>
                <dd>
                  <ul className="eng-share-list">
                    {sharedFields
                      .filter((field) => field.included)
                      .map((field) => (
                        <li key={field.id}>
                          {field.label}: {field.value}
                        </li>
                      ))}
                  </ul>
                </dd>
              </div>
              {selectedQuestions.length > 0 ? (
                <div>
                  <dt>Response questions</dt>
                  <dd>
                    <ul className="eng-share-list">
                      {selectedQuestions.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>Attachments</dt>
                <dd>
                  {includedFiles.length > 0
                    ? includedFiles.map((file) => file.fileName).join(", ")
                    : "None"}
                </dd>
              </div>
              <div>
                <dt>Confidentiality</dt>
                <dd>Organization-confidential</dd>
              </div>
            </dl>
            <p className="eng-nonbinding-inline">Nonbinding request</p>
          </div>
        </section>

        {/* Actions */}
        <section className="pp-section" aria-labelledby="eng-actions-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="eng-actions-heading">Send request</h2>
              <p>Review disclosure carefully. Sending does not publish your full project.</p>
            </div>
          </div>
          <div className="re-save-card">
            <div className="eng-nonbinding-notice" role="note">
              <strong>Nonbinding request:</strong> Sending this request starts a
              business conversation. It does not by itself create a contract,
              purchase order, investment commitment, employment commitment,
              professional engagement, or other binding obligation.
            </div>
            <div className="re-final-actions">
              <Button
                type="button"
                variant="ghost"
                disabled={mode === "sending"}
                onClick={() => {
                  document
                    .getElementById("eng-fields-heading")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Edit Request
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={mode === "sending"}
                onClick={() => setDisclosureOpen(true)}
              >
                Change Disclosure
              </Button>
              <Button
                type="button"
                variant="text"
                className="pp-archive-btn"
                disabled={mode === "sending"}
                onClick={handleCancel}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!canSend}
                onClick={handleSend}
              >
                {mode === "sending" ? "Sending…" : "Send"}
              </Button>
            </div>
            {!canSend && mode !== "sending" ? (
              <p className="pp-muted">
                Resolve validation issues and complete required disclosure checks
                before sending.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      {disclosureOpen ? (
        <div
          className="pc-modal-backdrop"
          role="presentation"
          onClick={() => setDisclosureOpen(false)}
        >
          <div
            className="pc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="eng-disclosure-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="eng-disclosure-title">Change disclosure</h3>
            <p className="pp-muted">
              Toggle permitted fields and files. Private items cannot be enabled.
            </p>
            <div className="pub-vis-modal-list">
              {sharedFields.map((field) => (
                <div key={field.id} className="pub-vis-row">
                  <span>{field.label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => toggleFieldShare(field.id)}
                  >
                    {field.included ? "Included" : "Excluded"}
                  </Button>
                </div>
              ))}
              {files.map((file) => (
                <div key={file.id} className="pub-vis-row">
                  <span>
                    {file.fileName}
                    {!file.allowed ? " (not permitted)" : ""}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!file.allowed}
                    onClick={() => toggleFile(file.id)}
                  >
                    {file.included && file.allowed ? "Included" : "Excluded"}
                  </Button>
                </div>
              ))}
            </div>
            <div className="pc-modal-actions">
              <Button
                type="button"
                variant="primary"
                onClick={() => setDisclosureOpen(false)}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {showCancelConfirm ? (
        <div
          className="pc-modal-backdrop"
          role="presentation"
          onClick={() => setShowCancelConfirm(false)}
        >
          <div
            className="pc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="eng-cancel-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="eng-cancel-title">Discard draft?</h3>
            <p className="pp-muted">
              You have unsaved changes. Canceling will discard this request draft.
            </p>
            <div className="pc-modal-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowCancelConfirm(false)}
              >
                Keep editing
              </Button>
              <Button href={needComparePath(context.needId)} variant="primary">
                Discard &amp; leave
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
