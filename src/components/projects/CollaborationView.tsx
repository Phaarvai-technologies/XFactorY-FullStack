"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  formalNeedNewPath,
  projectProfilePath,
} from "@/lib/projects/paths";
import type {
  Collaborator,
  CollaborationQuestion,
  DecisionNote,
  FormalNeedFromDiscussion,
  ProjectCollaboration,
  QuestionStatus,
  RelatedProjectArea,
} from "@/lib/projects/collaborationTypes";
import type { ProjectProfile } from "@/lib/projects/types";

type CollaborationViewProps = {
  project: ProjectProfile;
  initialCollaboration: ProjectCollaboration;
};

type ModalKind = "invite" | "ask" | "reply" | null;

function membershipLabel(status: Collaborator["membershipStatus"]): string {
  switch (status) {
    case "invited":
      return "Invited";
    case "active":
      return "Active member";
    case "awaiting_response":
      return "Awaiting response";
    case "removed":
      return "Member removed";
  }
}

function questionStatusLabel(status: QuestionStatus): string {
  switch (status) {
    case "open":
      return "Open";
    case "awaiting_response":
      return "Awaiting response";
    case "resolved":
      return "Resolved";
  }
}

function relatedAreaOptions(): { value: RelatedProjectArea; label: string }[] {
  return [
    {
      value: "manufacturing_readiness",
      label: "Manufacturing Readiness → Prototype Status",
    },
    {
      value: "manufacturing_need",
      label: "Manufacturing Need",
    },
    {
      value: "supporting_need",
      label: "Supporting Need",
    },
    {
      value: "project_field",
      label: "Project field",
    },
    {
      value: "other",
      label: "Other project information",
    },
  ];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CollaborationView({
  project,
  initialCollaboration,
}: CollaborationViewProps) {
  const [spaceStatus, setSpaceStatus] = useState(
    initialCollaboration.spaceStatus,
  );
  const [collaborators, setCollaborators] = useState(
    initialCollaboration.collaborators,
  );
  const [questions, setQuestions] = useState(initialCollaboration.questions);
  const [decisions, setDecisions] = useState(initialCollaboration.decisions);
  const [formalNeeds, setFormalNeeds] = useState(
    initialCollaboration.formalNeeds,
  );
  const [modal, setModal] = useState<ModalKind>(null);
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);

  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [inviteOrg, setInviteOrg] = useState("");
  const [inviteExternal, setInviteExternal] = useState(false);

  const [askTitle, setAskTitle] = useState("");
  const [askContent, setAskContent] = useState("");
  const [askRelated, setAskRelated] = useState<RelatedProjectArea>(
    "manufacturing_readiness",
  );
  const [askRelatedLabel, setAskRelatedLabel] = useState(
    relatedAreaOptions()[0].label,
  );

  const [replyContent, setReplyContent] = useState("");

  const readOnly = spaceStatus === "archived";

  const discussionScope = useMemo(() => {
    const hasExternalActive = collaborators.some(
      (c) =>
        c.isExternalOrg &&
        (c.membershipStatus === "active" ||
          c.membershipStatus === "awaiting_response"),
    );
    return hasExternalActive ? "cross_organization" : "internal";
  }, [collaborators]);

  const unresolved = questions.filter((q) => q.status !== "resolved");
  const activeCollaborators = collaborators.filter(
    (c) => c.membershipStatus !== "removed",
  );

  function closeModal() {
    setModal(null);
    setReplyTargetId(null);
    setInviteName("");
    setInviteRole("");
    setInviteOrg("");
    setInviteExternal(false);
    setAskTitle("");
    setAskContent("");
    setReplyContent("");
  }

  function handleInvite() {
    if (!inviteName.trim() || readOnly) return;
    const initials = inviteName
      .split(/\s+/)
      .map((part) => part[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();

    const next: Collaborator = {
      id: `col-${Date.now()}`,
      name: inviteName.trim(),
      role: inviteRole.trim() || "Collaborator",
      organization: inviteOrg.trim() || project.ownership.organizationName,
      membershipStatus: "invited",
      initials: initials || "XY",
      isExternalOrg: inviteExternal,
    };
    setCollaborators((current) => [...current, next]);
    closeModal();
  }

  function handleAsk() {
    if (!askTitle.trim() || !askContent.trim() || readOnly) return;
    const next: CollaborationQuestion = {
      id: `q-${Date.now()}`,
      title: askTitle.trim(),
      content: askContent.trim(),
      askedBy: project.ownership.ownerName,
      askedByRole: project.ownership.ownerRole,
      createdAt: todayIso(),
      status: "open",
      relatedArea: askRelated,
      relatedLabel: askRelatedLabel,
      replies: [],
    };
    setQuestions((current) => [next, ...current]);
    closeModal();
  }

  function handleReply() {
    if (!replyTargetId || !replyContent.trim() || readOnly) return;
    setQuestions((current) =>
      current.map((question) => {
        if (question.id !== replyTargetId) return question;
        return {
          ...question,
          status:
            question.status === "resolved"
              ? question.status
              : "awaiting_response",
          replies: [
            ...question.replies,
            {
              id: `r-${Date.now()}`,
              authorName: project.ownership.ownerName,
              authorRole: project.ownership.ownerRole,
              content: replyContent.trim(),
              createdAt: todayIso(),
            },
          ],
        };
      }),
    );
    closeModal();
  }

  function resolveQuestion(id: string) {
    if (readOnly) return;
    setQuestions((current) =>
      current.map((question) =>
        question.id === id ? { ...question, status: "resolved" } : question,
      ),
    );
  }

  function addDecisionFromQuestion(question: CollaborationQuestion) {
    if (readOnly) return;
    const note: DecisionNote = {
      id: `d-${Date.now()}`,
      title: `Decision: ${question.title}`,
      summary: `Recorded from collaboration thread. ${question.content.slice(0, 140)}`,
      createdAt: todayIso(),
      createdBy: project.ownership.ownerName,
      relatedLabel: question.relatedLabel,
    };
    setDecisions((current) => [note, ...current]);
  }

  function trackFormalNeed(question: CollaborationQuestion) {
    const entry: FormalNeedFromDiscussion = {
      id: `fn-${Date.now()}`,
      title: question.title,
      summary: question.content.slice(0, 160),
      sourceQuestionId: question.id,
      createdAt: todayIso(),
    };
    setFormalNeeds((current) => [entry, ...current]);
  }

  return (
    <div className="project-collab">
      <div className="wrap">
        <div className="pc-back">
          <Button href={projectProfilePath(project.id)} variant="text">
            ← Back to project profile
          </Button>
        </div>

        {spaceStatus === "archived" ? (
          <div className="pp-banner pp-banner-muted" role="status">
            <strong>Archived.</strong> This private collaboration space is
            read-only. History remains available.
          </div>
        ) : null}

        <div
          className={`pp-banner ${
            discussionScope === "cross_organization"
              ? "pp-banner-warn"
              : "pp-banner-info"
          }`}
          role="status"
        >
          {discussionScope === "cross_organization" ? (
            <>
              <strong>Cross-organization engagement.</strong> This discussion
              includes participants outside {project.ownership.organizationName}.
              Share only what invited partners need.
            </>
          ) : (
            <>
              <strong>Internal discussion.</strong> Conversation stays within
              your invited private collaboration group.
            </>
          )}
        </div>

        <header className="pp-header pc-header">
          <div className="pp-header-main">
            <p className="pp-eyebrow">Project collaboration</p>
            <h1>{project.title}</h1>
            <p className="pp-summary">{project.summary}</p>
            <div className="pp-badges">
              <span className="pp-badge">Private Collaboration</span>
              <span className="pp-badge pp-badge-soft">Invite-only</span>
              <span className="pp-badge pp-badge-soft">
                {spaceStatus === "archived" ? "Archived" : "Private"}
              </span>
            </div>
          </div>
          <div className="pp-header-actions pc-header-actions">
            <Button
              type="button"
              variant="primary"
              disabled={readOnly}
              onClick={() => setModal("ask")}
            >
              Ask Question
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={readOnly}
              onClick={() => setModal("invite")}
            >
              Invite Collaborator
            </Button>
          </div>
        </header>

        {/* Collaborators */}
        <section className="pp-section" aria-labelledby="pc-collab-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pc-collab-heading">Invite-only collaborators</h2>
              <p>
                Only invited people can view and participate in this private
                discussion space.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={readOnly}
              onClick={() => setModal("invite")}
            >
              Invite Collaborator
            </Button>
          </div>

          {activeCollaborators.length === 0 ? (
            <div className="pp-empty pc-empty">
              <strong>No collaborators yet</strong>
              <p>Invite trusted partners to discuss this project privately.</p>
              <Button
                type="button"
                variant="primary"
                disabled={readOnly}
                onClick={() => setModal("invite")}
              >
                Invite Collaborator
              </Button>
            </div>
          ) : (
            <ul className="pc-collab-grid">
              {activeCollaborators.map((person) => (
                <li key={person.id} className="pc-collab-card">
                  <div className="pc-avatar" aria-hidden>
                    {person.initials}
                  </div>
                  <div className="pc-collab-body">
                    <div className="pc-collab-top">
                      <span className="pc-collab-name">{person.name}</span>
                      <span
                        className={`pp-chip pp-chip-${person.membershipStatus === "active" ? "in_progress" : person.membershipStatus === "removed" ? "closed" : "open"}`}
                      >
                        {membershipLabel(person.membershipStatus)}
                      </span>
                    </div>
                    <p className="pp-muted">
                      {person.role} · {person.organization}
                    </p>
                    {person.isExternalOrg ? (
                      <span className="pc-ext-tag">External organization</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Unresolved Questions */}
        <section className="pp-section" aria-labelledby="pc-unresolved-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pc-unresolved-heading">Unresolved questions</h2>
              <p>
                Questions still needing a response, clarification, decision, or
                more information.
              </p>
            </div>
          </div>
          {unresolved.length === 0 ? (
            <div className="pp-empty">
              No unresolved questions. New discussion items will appear here
              until they are marked resolved.
            </div>
          ) : (
            <ul className="pc-unresolved-list">
              {unresolved.map((question) => (
                <li key={question.id}>
                  <div className="pc-unresolved-top">
                    <span>{question.title}</span>
                    <span className="pp-chip pp-chip-open">
                      {questionStatusLabel(question.status)}
                    </span>
                  </div>
                  <p className="pp-muted">{question.relatedLabel}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Questions & Discussion */}
        <section className="pp-section" aria-labelledby="pc-qa-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pc-qa-heading">Questions &amp; discussion</h2>
              <p>
                Contextual private threads linked to project fields and needs —
                not a public forum.
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              disabled={readOnly}
              onClick={() => setModal("ask")}
            >
              Ask Question
            </Button>
          </div>

          {questions.length === 0 ? (
            <div className="pp-empty pc-empty">
              <strong>No questions yet</strong>
              <p>
                Start a private discussion with your invited collaborators.
              </p>
              <Button
                type="button"
                variant="primary"
                disabled={readOnly}
                onClick={() => setModal("ask")}
              >
                Ask Question
              </Button>
            </div>
          ) : (
            <ul className="pc-thread-list">
              {questions.map((question) => (
                <li key={question.id} className="pc-thread">
                  <div className="pc-thread-head">
                    <div>
                      <h3>{question.title}</h3>
                      <p className="pc-thread-meta">
                        Asked by {question.askedBy} · {question.createdAt}
                      </p>
                      <p className="pc-related">
                        Related to: {question.relatedLabel}
                      </p>
                    </div>
                    <span
                      className={`pp-chip ${
                        question.status === "resolved"
                          ? "pp-chip-in_progress"
                          : "pp-chip-open"
                      }`}
                    >
                      {questionStatusLabel(question.status)}
                    </span>
                  </div>

                  <p className="pc-thread-body">{question.content}</p>

                  {question.replies.length > 0 ? (
                    <ul className="pc-replies">
                      {question.replies.map((reply) => (
                        <li key={reply.id}>
                          <div className="pc-reply-meta">
                            <strong>{reply.authorName}</strong>
                            <span>
                              {reply.authorRole} · {reply.createdAt}
                            </span>
                          </div>
                          <p>{reply.content}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="pp-muted pc-no-replies">No replies yet.</p>
                  )}

                  <div className="pc-thread-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={readOnly}
                      onClick={() => {
                        setReplyTargetId(question.id);
                        setModal("reply");
                      }}
                    >
                      Reply
                    </Button>
                    {question.status !== "resolved" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={readOnly}
                        onClick={() => {
                          resolveQuestion(question.id);
                          addDecisionFromQuestion(question);
                        }}
                      >
                        Resolve Question
                      </Button>
                    ) : null}
                    {readOnly ? (
                      <Button type="button" variant="text" disabled>
                        Create Formal Need
                      </Button>
                    ) : (
                      <Button
                        href={formalNeedNewPath({
                          projectId: project.id,
                          questionId: question.id,
                        })}
                        variant="text"
                        onClick={() => trackFormalNeed(question)}
                      >
                        Create Formal Need
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Decision Notes */}
        <section className="pp-section" aria-labelledby="pc-decisions-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pc-decisions-heading">Decision notes</h2>
              <p>
                Lightweight record of important project decisions from private
                discussion.
              </p>
            </div>
          </div>
          {decisions.length === 0 ? (
            <div className="pp-empty">
              No decision notes yet. Resolving a question can capture a decision
              here.
            </div>
          ) : (
            <ul className="pc-decision-list">
              {decisions.map((note) => (
                <li key={note.id} className="pc-decision-card">
                  <h3>{note.title}</h3>
                  <p>{note.summary}</p>
                  <p className="pp-muted">
                    {note.createdBy} · {note.createdAt} · {note.relatedLabel}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Formal needs from discussions */}
        <section className="pp-section" aria-labelledby="pc-formal-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="pc-formal-heading">Formal needs from discussions</h2>
              <p>
                Discussions converted into formal business needs. Creating a need
                does not make the full project public.
              </p>
            </div>
            {readOnly ? (
              <Button type="button" variant="ghost" disabled>
                Create Formal Need
              </Button>
            ) : (
              <Button
                href={formalNeedNewPath({ projectId: project.id })}
                variant="ghost"
              >
                Create Formal Need
              </Button>
            )}
          </div>
          {formalNeeds.length === 0 ? (
            <div className="pp-empty">
              No formal needs created from discussions yet.
            </div>
          ) : (
            <ul className="pc-decision-list">
              {formalNeeds.map((need) => (
                <li key={need.id} className="pc-decision-card">
                  <h3>{need.title}</h3>
                  <p>{need.summary}</p>
                  <p className="pp-muted">Started {need.createdAt}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pp-archive" aria-label="Archive collaboration">
          <div>
            <h2>Archive collaboration</h2>
            <p>
              Archiving makes this space primarily informational while keeping
              discussion history.
            </p>
          </div>
          <Button
            type="button"
            variant="text"
            className="pp-archive-btn"
            disabled={readOnly}
            onClick={() => setSpaceStatus("archived")}
          >
            {readOnly ? "Archived" : "Archive collaboration"}
          </Button>
        </section>
      </div>

      {modal ? (
        <div
          className="pc-modal-backdrop"
          role="presentation"
          onClick={closeModal}
        >
          <div
            className="pc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pc-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            {modal === "invite" ? (
              <>
                <h3 id="pc-modal-title">Invite collaborator</h3>
                <p className="pp-muted">
                  Invitations are private. Invitees must join before they can
                  participate.
                </p>
                <label className="pc-field">
                  Name
                  <input
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Collaborator name"
                  />
                </label>
                <label className="pc-field">
                  Role
                  <input
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    placeholder="e.g. Manufacturing Advisor"
                  />
                </label>
                <label className="pc-field">
                  Organization
                  <input
                    value={inviteOrg}
                    onChange={(e) => setInviteOrg(e.target.value)}
                    placeholder="Organization name"
                  />
                </label>
                <label className="pc-check">
                  <input
                    type="checkbox"
                    checked={inviteExternal}
                    onChange={(e) => setInviteExternal(e.target.checked)}
                  />
                  External / cross-organization collaborator
                </label>
                <div className="pc-modal-actions">
                  <Button type="button" variant="ghost" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" onClick={handleInvite}>
                    Send invite
                  </Button>
                </div>
              </>
            ) : null}

            {modal === "ask" ? (
              <>
                <h3 id="pc-modal-title">Ask a question</h3>
                <p className="pp-muted">
                  Link the question to a project area so discussion stays
                  contextual.
                </p>
                <label className="pc-field">
                  Question title
                  <input
                    value={askTitle}
                    onChange={(e) => setAskTitle(e.target.value)}
                    placeholder="What do you need clarified?"
                  />
                </label>
                <label className="pc-field">
                  Details
                  <textarea
                    value={askContent}
                    onChange={(e) => setAskContent(e.target.value)}
                    rows={4}
                    placeholder="Add context for invited collaborators"
                  />
                </label>
                <label className="pc-field">
                  Related to
                  <select
                    value={askRelated}
                    onChange={(e) => {
                      const value = e.target.value as RelatedProjectArea;
                      setAskRelated(value);
                      const match = relatedAreaOptions().find(
                        (option) => option.value === value,
                      );
                      if (match) setAskRelatedLabel(match.label);
                    }}
                  >
                    {relatedAreaOptions().map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="pc-modal-actions">
                  <Button type="button" variant="ghost" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" onClick={handleAsk}>
                    Post question
                  </Button>
                </div>
              </>
            ) : null}

            {modal === "reply" ? (
              <>
                <h3 id="pc-modal-title">Reply</h3>
                <p className="pp-muted">
                  Your reply stays inside this invite-only collaboration space.
                </p>
                <label className="pc-field">
                  Reply
                  <textarea
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    rows={4}
                    placeholder="Share feedback or clarification"
                  />
                </label>
                <div className="pc-modal-actions">
                  <Button type="button" variant="ghost" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" onClick={handleReply}>
                    Post reply
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
