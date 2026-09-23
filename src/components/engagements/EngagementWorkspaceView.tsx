"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { engagementClosePath } from "@/lib/engagements/closeTypes";
import type {
  AttachmentAccessState,
  EngagementStatus,
  EngagementWorkspace,
  StructuredResponseKind,
} from "@/lib/engagements/workspaceTypes";
import { needRequirementEditorPath } from "@/lib/needs/paths";
import { projectProfilePath } from "@/lib/projects/paths";

type EngagementWorkspaceViewProps = {
  initialWorkspace: EngagementWorkspace;
  initiallyClosed?: boolean;
  closedOutcomeLabel?: string;
  feedbackRecorded?: boolean;
  expired?: boolean;
  reopened?: boolean;
};

const STATUS_OPTIONS: EngagementStatus[] = [
  "sent",
  "delivered",
  "acknowledged",
  "clarification",
  "interested",
  "declined",
  "cancelled",
];

function statusLabel(status: EngagementStatus): string {
  switch (status) {
    case "sent":
      return "Sent";
    case "delivered":
      return "Delivered";
    case "acknowledged":
      return "Acknowledged";
    case "clarification":
      return "Clarification";
    case "interested":
      return "Interested";
    case "declined":
      return "Declined";
    case "cancelled":
      return "Cancelled";
  }
}

function accessLabel(state: AttachmentAccessState): string {
  switch (state) {
    case "available":
      return "Available";
    case "approved":
      return "Approved";
    case "restricted":
      return "Restricted";
    case "pending_access":
      return "Pending access";
    case "not_available":
      return "Not available";
    case "revoked":
      return "Revoked";
    case "expired":
      return "Expired";
  }
}

function disclosureLabel(
  state: "shared" | "restricted" | "not_shared" | "revoked" | "expired",
): string {
  switch (state) {
    case "shared":
      return "Shared";
    case "restricted":
      return "Restricted";
    case "not_shared":
      return "Not shared";
    case "revoked":
      return "Revoked";
    case "expired":
      return "Expired";
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

function structuredLabel(kind: StructuredResponseKind): string {
  switch (kind) {
    case "acknowledge":
      return "Acknowledge";
    case "clarify":
      return "Clarify";
    case "interested":
      return "Interested";
    case "decline":
      return "Decline";
    case "availability":
      return "Availability Response";
    case "quote":
      return "Quote Response";
    case "service":
      return "Service Response";
  }
}

function structuredFieldsFor(
  kind: StructuredResponseKind,
): { id: string; label: string }[] {
  switch (kind) {
    case "acknowledge":
      return [
        { id: "ack", label: "Acknowledgement note" },
        { id: "notes", label: "Notes" },
      ];
    case "clarify":
      return [
        { id: "question", label: "Clarification needed" },
        { id: "notes", label: "Notes" },
      ];
    case "interested":
      return [
        { id: "interest", label: "Interest summary" },
        { id: "notes", label: "Notes" },
      ];
    case "decline":
      return [
        { id: "reason", label: "Decline reason" },
        { id: "notes", label: "Notes" },
      ];
    case "availability":
      return [
        { id: "availability", label: "Availability" },
        { id: "capacity", label: "Capacity" },
        { id: "available_date", label: "Available date" },
        { id: "lead_time", label: "Lead time" },
        { id: "notes", label: "Notes" },
      ];
    case "quote":
      return [
        { id: "price", label: "Indicative price / quote" },
        { id: "quantity", label: "Quantity" },
        { id: "lead_time", label: "Lead time" },
        { id: "delivery", label: "Delivery / location" },
        { id: "notes", label: "Notes" },
      ];
    case "service":
      return [
        { id: "service", label: "Service availability" },
        { id: "scope", label: "Scope" },
        { id: "timeline", label: "Timeline" },
        { id: "relevant", label: "Relevant information" },
        { id: "notes", label: "Notes" },
      ];
  }
}

export function EngagementWorkspaceView({
  initialWorkspace,
  initiallyClosed = false,
  closedOutcomeLabel,
  feedbackRecorded = false,
  expired = false,
  reopened = false,
}: EngagementWorkspaceViewProps) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [reply, setReply] = useState("");
  const [structuredKind, setStructuredKind] = useState<StructuredResponseKind | "">(
    "",
  );
  const [structuredValues, setStructuredValues] = useState<Record<string, string>>(
    {},
  );
  const [selectedFileId, setSelectedFileId] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const closed = initiallyClosed || expired;

  const approvedFiles = useMemo(
    () => workspace.attachableFiles.filter((file) => file.approved),
    [workspace.attachableFiles],
  );

  const readOnly =
    closed ||
    workspace.status === "cancelled" ||
    workspace.status === "declined";

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  }

  function pushTimeline(
    eventType: string,
    kind: EngagementWorkspace["timeline"][number]["kind"],
    context: string,
  ) {
    setWorkspace((current) => ({
      ...current,
      timeline: [
        {
          id: `tl-${Date.now()}`,
          kind,
          eventType,
          actor: current.requesterName,
          organization: current.requesterOrganization,
          timestamp: new Date().toISOString(),
          context,
        },
        ...current.timeline,
      ],
    }));
  }

  function handleReply() {
    if (readOnly || !reply.trim()) return;
    const attachment = approvedFiles.find((file) => file.id === selectedFileId);
    const structured =
      structuredKind === ""
        ? undefined
        : {
            kind: structuredKind,
            label: structuredLabel(structuredKind),
            fields: structuredFieldsFor(structuredKind).map((field) => ({
              label: field.label,
              value: structuredValues[field.id]?.trim() || "—",
            })),
          };

    setWorkspace((current) => ({
      ...current,
      messages: [
        ...current.messages,
        {
          id: `msg-${Date.now()}`,
          senderName: current.requesterName,
          senderOrganization: current.requesterOrganization,
          senderRole: "Visionary / Requester",
          timestamp: new Date().toISOString(),
          content: reply.trim(),
          attachments: attachment
            ? [
                {
                  id: `att-${Date.now()}`,
                  fileName: attachment.fileName,
                  accessState: "approved",
                },
              ]
            : [],
          structuredResponse: structured,
        },
      ],
    }));
    pushTimeline("Message sent", "communication", reply.trim().slice(0, 80));
    if (structuredKind === "clarify") {
      setWorkspace((current) => ({ ...current, status: "clarification" }));
      pushTimeline(
        "Status → Clarification",
        "status",
        "Clarification requested without changing Requirement version",
      );
    }
    setReply("");
    setStructuredKind("");
    setStructuredValues({});
    setSelectedFileId("");
    showToast("Reply sent. Nonbinding — no contract created.");
  }

  function changeStatus(next: EngagementStatus) {
    setWorkspace((current) => ({ ...current, status: next }));
    pushTimeline(
      `Status → ${statusLabel(next)}`,
      "status",
      `Status changed to ${statusLabel(next)}`,
    );
    setStatusOpen(false);
    showToast(`Status updated to ${statusLabel(next)}.`);
  }

  function requestClarification() {
    setStructuredKind("clarify");
    setReply(
      (current) =>
        current ||
        "Could you clarify the outstanding information for this nonbinding request?",
    );
    showToast("Clarification response selected — send when ready.");
  }

  if (!workspace.canAccess) {
    return (
      <div className="req-editor project-profile eng-workspace">
        <div className="wrap" style={{ maxWidth: 720 }}>
          <div className="pp-banner pp-banner-warn" role="alert">
            <strong>Permission required.</strong> Only authorized engagement
            participants can access this workspace.
          </div>
          <Button href="/app" variant="primary">
            Return to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="req-editor project-profile eng-workspace">
      <div className="wrap">
        <div className="pc-back">
          <Button href={projectProfilePath(workspace.projectId)} variant="text">
            ← Back to project
          </Button>
        </div>

        <div className="pp-banner pp-banner-info" role="status">
          <strong>Nonbinding.</strong> Messages, acknowledgements, interest,
          availability, and indicative quotes do not create a contract, purchase
          order, investment commitment, employment, or professional engagement by
          themselves.
        </div>

        {workspace.newerRequirementVersion ? (
          <div className="pp-banner pp-banner-warn" role="status">
            <strong>Newer Requirement version exists.</strong> This engagement
            stays on original v{workspace.requirementVersion}. Newer version v
            {workspace.newerRequirementVersion} is not applied automatically.
            <Button
              href={needRequirementEditorPath(workspace.needId)}
              variant="ghost"
            >
              View latest Requirement
            </Button>
          </div>
        ) : null}

        {expired ? (
          <div className="pp-banner pp-banner-muted" role="status">
            <strong>Expired.</strong> This engagement reached an expiration
            condition. History remains available.
          </div>
        ) : null}

        {closed && !expired ? (
          <div className="pp-banner pp-banner-muted" role="status">
            <strong>Closed.</strong>
            {closedOutcomeLabel
              ? ` Outcome: ${closedOutcomeLabel}.`
              : " Conversation history and timeline remain available."}
            {feedbackRecorded
              ? " Data/relevance feedback was recorded."
              : ""}{" "}
            This is not a completed X!Y transaction.
          </div>
        ) : null}

        {reopened ? (
          <div className="pp-banner pp-banner-info" role="status">
            <strong>Reopened.</strong> Engagement workflow restored. Previous
            closure history remains on the timeline.
          </div>
        ) : null}

        {/* Header */}
        <header className="pp-header ew-header">
          <div className="pp-header-main">
            <p className="pp-eyebrow">Engagement workspace</p>
            <h1>
              {workspace.requesterOrganization} ↔{" "}
              {workspace.recipientOrganization}
            </h1>
            <p className="pp-summary">
              {workspace.requestTypeLabel} · Engagement ID: {workspace.id}
              <br />
              Created {formatTimestamp(workspace.createdAt)} · Related Need:{" "}
              {workspace.needTitle} (v{workspace.requirementVersion})
            </p>
            <div className="pp-badges">
              <span className="pp-badge">Nonbinding</span>
              <span className="pp-badge">
                {closed
                  ? expired
                    ? "Expired"
                    : "Closed"
                  : statusLabel(workspace.status)}
              </span>
              <span className="pp-badge pp-badge-soft">
                {workspace.requestTypeLabel}
              </span>
              <span className="pp-badge pp-badge-soft">
                {workspace.confidentiality}
              </span>
            </div>
          </div>
          <div className="pp-header-actions ew-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={readOnly}
              onClick={() => setStatusOpen(true)}
            >
              Change Status
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={readOnly}
              onClick={requestClarification}
            >
              Request Clarification
            </Button>
            <Button
              href={engagementClosePath(workspace.id)}
              variant="text"
              className="pp-archive-btn"
            >
              Close
            </Button>
            <Button
              type="button"
              variant="text"
              onClick={() =>
                showToast(
                  "Report submitted to the existing safety channel (demo).",
                )
              }
            >
              Report
            </Button>
          </div>
        </header>

        <div className="ew-layout">
          <div className="ew-main">
            {/* Messages */}
            <section className="pp-section" aria-labelledby="ew-thread-heading">
              <div className="pp-section-head">
                <div>
                  <h2 id="ew-thread-heading">Message thread</h2>
                  <p>
                    Attributable messages and structured responses. No private
                    notes or unauthorized files are shown.
                  </p>
                </div>
              </div>
              {workspace.messages.length === 0 ? (
                <div className="pp-empty">No messages yet.</div>
              ) : (
                <ul className="ew-thread">
                  {workspace.messages.map((message) => (
                    <li key={message.id} className="ew-message">
                      <div className="ew-message-meta">
                        <strong>{message.senderName}</strong>
                        <span>
                          {message.senderOrganization} · {message.senderRole}
                        </span>
                        <span>{formatTimestamp(message.timestamp)}</span>
                      </div>
                      <p>{message.content}</p>
                      {message.structuredResponse ? (
                        <div className="ew-structured">
                          <div className="pp-badges">
                            <span className="pp-badge">
                              {message.structuredResponse.label}
                            </span>
                            <span className="pp-badge pp-badge-soft">
                              Nonbinding
                            </span>
                          </div>
                          <dl>
                            {message.structuredResponse.fields.map((field) => (
                              <div key={field.label}>
                                <dt>{field.label}</dt>
                                <dd>{field.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ) : null}
                      {message.attachments.length > 0 ? (
                        <ul className="ew-attachments">
                          {message.attachments.map((file) => (
                            <li key={file.id}>
                              <span>{file.fileName}</span>
                              <span
                                className={`pp-chip pub-vis-${
                                  file.accessState === "available" ||
                                  file.accessState === "approved"
                                    ? "shared"
                                    : file.accessState === "restricted" ||
                                        file.accessState === "pending_access"
                                      ? "restricted"
                                      : "private"
                                }`}
                              >
                                {accessLabel(file.accessState)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Reply composer */}
            <section className="pp-section" aria-labelledby="ew-reply-heading">
              <div className="pp-section-head">
                <div>
                  <h2 id="ew-reply-heading">Reply</h2>
                  <p>
                    Attach only approved files. Restricted/private files cannot be
                    selected.
                  </p>
                </div>
              </div>
              <div className="re-save-card">
                <label className="pc-field">
                  Message
                  <textarea
                    rows={4}
                    value={reply}
                    disabled={readOnly}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Write a contextual message…"
                  />
                </label>

                <label className="pc-field">
                  Attach approved file
                  <select
                    value={selectedFileId}
                    disabled={readOnly}
                    onChange={(e) => setSelectedFileId(e.target.value)}
                  >
                    <option value="">No attachment</option>
                    {approvedFiles.map((file) => (
                      <option key={file.id} value={file.id}>
                        {file.fileName}
                      </option>
                    ))}
                  </select>
                </label>
                {workspace.attachableFiles.some((file) => !file.approved) ? (
                  <p className="pp-muted">
                    Unauthorized files are hidden from this list and cannot be
                    attached accidentally.
                  </p>
                ) : null}

                <label className="pc-field">
                  Optional structured response
                  <select
                    value={structuredKind}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStructuredKind(
                        e.target.value as StructuredResponseKind | "",
                      )
                    }
                  >
                    <option value="">None</option>
                    <option value="acknowledge">Acknowledge</option>
                    <option value="clarify">Clarify</option>
                    <option value="interested">Interested</option>
                    <option value="decline">Decline</option>
                    <option value="availability">Availability Response</option>
                    <option value="quote">Quote Response</option>
                    <option value="service">Service Response</option>
                  </select>
                </label>

                {structuredKind ? (
                  <div className="ew-structured-form">
                    <p className="pp-muted">
                      {structuredLabel(structuredKind)} — nonbinding information
                      only.
                    </p>
                    {structuredFieldsFor(structuredKind).map((field) => (
                      <label key={field.id} className="pc-field">
                        {field.label}
                        <input
                          value={structuredValues[field.id] ?? ""}
                          disabled={readOnly}
                          onChange={(e) =>
                            setStructuredValues((current) => ({
                              ...current,
                              [field.id]: e.target.value,
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                ) : null}

                <div className="re-final-actions">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={readOnly || !reply.trim()}
                    onClick={handleReply}
                  >
                    Reply
                  </Button>
                </div>
              </div>
            </section>
          </div>

          <aside className="ew-side">
            {/* Requirement context */}
            <section className="pp-section" aria-labelledby="ew-need-heading">
              <div className="pp-section-head">
                <div>
                  <h2 id="ew-need-heading">Requirement / Need context</h2>
                  <p>Original version used when this engagement was created.</p>
                </div>
              </div>
              <div className="re-item-card">
                <p className="pp-ready-value">{workspace.needTitle}</p>
                <p className="pp-muted">Need ID: {workspace.needId}</p>
                <p className="pp-muted">
                  Requirement version: v{workspace.requirementVersion}
                </p>
                <p className="pp-muted">
                  Version date:{" "}
                  {formatTimestamp(workspace.requirementVersionDate)}
                </p>
                <p className="pp-muted">Need status: {workspace.needStatus}</p>
                <p className="pp-muted">
                  Request type: {workspace.requestTypeLabel}
                </p>
                <p className="pp-muted">
                  Match / candidate: {workspace.candidateName}
                </p>
                <div className="pc-thread-actions">
                  <Button
                    href={needRequirementEditorPath(workspace.needId)}
                    variant="ghost"
                  >
                    View Requirement
                  </Button>
                </div>
              </div>
            </section>

            {/* Disclosure */}
            <section className="pp-section" aria-labelledby="ew-disclosure-heading">
              <div className="pp-section-head">
                <div>
                  <h2 id="ew-disclosure-heading">Disclosure summary</h2>
                  <p>
                    What was disclosed to {workspace.recipientOrganization} at
                    creation.
                  </p>
                </div>
              </div>
              <div className="re-item-card">
                <h3>Shared fields</h3>
                <ul className="ew-disclosure-list">
                  {workspace.disclosureFields.map((item) => (
                    <li key={item.label}>
                      <span>{item.label}</span>
                      <span className={`pp-chip pub-vis-${item.state === "shared" ? "shared" : item.state === "restricted" ? "restricted" : "private"}`}>
                        {disclosureLabel(item.state)}
                      </span>
                    </li>
                  ))}
                </ul>
                <h3>Shared files</h3>
                <ul className="ew-disclosure-list">
                  {workspace.disclosureFiles.map((item) => (
                    <li key={item.label}>
                      <span>{item.label}</span>
                      <span className={`pp-chip pub-vis-${item.state === "shared" ? "shared" : item.state === "restricted" ? "restricted" : "private"}`}>
                        {disclosureLabel(item.state)}
                      </span>
                    </li>
                  ))}
                </ul>
                <h3>Confidentiality</h3>
                <p className="pp-muted">{workspace.confidentiality}</p>
                <h3>Limitations</h3>
                <ul className="ew-limit-list">
                  {workspace.disclosureLimitations.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </section>
          </aside>
        </div>

        {/* Timeline */}
        <section className="pp-section" aria-labelledby="ew-timeline-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="ew-timeline-heading">Engagement timeline</h2>
              <p>
                Chronological, attributable events — communication vs
                status/system clearly marked.
              </p>
            </div>
          </div>
          <ol className="ew-timeline">
            {workspace.timeline.map((event) => (
              <li key={event.id} className={`ew-timeline-item ew-kind-${event.kind}`}>
                <div className="ew-timeline-top">
                  <strong>{event.eventType}</strong>
                  <span className="pp-badge pp-badge-soft">{event.kind}</span>
                </div>
                <p className="pp-muted">
                  {event.actor} · {event.organization} ·{" "}
                  {formatTimestamp(event.timestamp)}
                </p>
                <p>{event.context}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {statusOpen ? (
        <div
          className="pc-modal-backdrop"
          role="presentation"
          onClick={() => setStatusOpen(false)}
        >
          <div
            className="pc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ew-status-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="ew-status-title">Change status</h3>
            <p className="pp-muted">
              Current: {statusLabel(workspace.status)}. Status changes are
              recorded on the timeline and remain nonbinding.
            </p>
            <div className="ew-status-grid">
              {STATUS_OPTIONS.map((status) => (
                <Button
                  key={status}
                  type="button"
                  variant={workspace.status === status ? "primary" : "ghost"}
                  disabled={readOnly}
                  onClick={() => changeStatus(status)}
                >
                  {statusLabel(status)}
                </Button>
              ))}
            </div>
            <div className="pc-modal-actions">
              <Button type="button" variant="ghost" onClick={() => setStatusOpen(false)}>
                Cancel
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
