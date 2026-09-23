"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  needAiStructurePath,
  needPublishPath,
} from "@/lib/needs/paths";
import { categoriesForNeedType, needTypeLabel } from "@/lib/needs/templates";
import type {
  NeedRequirementDraft,
  RequirementClassification,
  RequirementItem,
  RequirementItemStatus,
} from "@/lib/needs/types";
import { projectProfilePath } from "@/lib/projects/paths";

type RequirementEditorViewProps = {
  initialDraft: NeedRequirementDraft;
};

type ModalKind = "add" | "edit" | "reclassify" | "remove" | "save" | null;

function classificationLabel(value: RequirementClassification): string {
  switch (value) {
    case "required":
      return "Required";
    case "preferred":
      return "Preferred";
    case "unknown":
      return "Unknown";
    case "not_applicable":
      return "Not Applicable";
  }
}

function statusLabel(status: RequirementItemStatus): string {
  switch (status) {
    case "suggested":
      return "AI suggestion";
    case "confirmed":
      return "Confirmed";
    case "edited":
      return "Edited";
    case "missing":
      return "Missing data";
    case "conflict":
      return "Conflict";
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

function countByClassification(items: RequirementItem[]) {
  return {
    required: items.filter((i) => i.classification === "required").length,
    preferred: items.filter((i) => i.classification === "preferred").length,
    unknown: items.filter((i) => i.classification === "unknown").length,
    na: items.filter((i) => i.classification === "not_applicable").length,
  };
}

function evaluateDraft(items: RequirementItem[], dirty: boolean, canEdit: boolean) {
  if (!canEdit) return "permission_revoked" as const;

  const missingRequired = items.filter(
    (item) =>
      item.classification === "required" &&
      (!item.value.trim() || item.status === "missing"),
  );
  const conflicts = items.filter((item) => item.status === "conflict");

  if (conflicts.length > 0) return "conflicting" as const;
  if (missingRequired.length > 0) return "missing_required" as const;
  if (dirty) return "version_changed" as const;
  if (items.length === 0) return "incomplete" as const;
  return "valid_draft" as const;
}

export function RequirementEditorView({
  initialDraft,
}: RequirementEditorViewProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [items, setItems] = useState(initialDraft.items);
  const [dirty, setDirty] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [modal, setModal] = useState<ModalKind>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [formCategoryId, setFormCategoryId] = useState("");
  const [formName, setFormName] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formClassification, setFormClassification] =
    useState<RequirementClassification>("required");
  const [formNotes, setFormNotes] = useState("");

  const categories = categoriesForNeedType(draft.needType);
  const counts = useMemo(() => countByClassification(items), [items]);
  const editorState = evaluateDraft(items, dirty, draft.canEdit);
  const readOnly = !draft.canEdit;

  const missingItems = items.filter(
    (item) =>
      item.classification === "required" &&
      (!item.value.trim() || item.status === "missing"),
  );
  const conflictItems = items.filter((item) => item.status === "conflict");

  const canPublish =
    !readOnly &&
    !dirty &&
    editorState === "valid_draft" &&
    missingItems.length === 0 &&
    conflictItems.length === 0;

  const activeItem = items.find((item) => item.id === activeId) ?? null;

  function markDirty(summary: string) {
    setDirty(true);
    setDraft((current) => ({
      ...current,
      pendingChangeSummary: summary,
      lastUpdated: new Date().toISOString(),
    }));
  }

  function closeModal() {
    setModal(null);
    setActiveId(null);
    setFormCategoryId("");
    setFormName("");
    setFormValue("");
    setFormClassification("required");
    setFormNotes("");
  }

  function openAdd() {
    setFormCategoryId(categories[0]?.id ?? "");
    setFormName("");
    setFormValue("");
    setFormClassification("required");
    setFormNotes("");
    setModal("add");
  }

  function openEdit(item: RequirementItem) {
    setActiveId(item.id);
    setFormCategoryId(item.categoryId);
    setFormName(item.name);
    setFormValue(item.value);
    setFormClassification(item.classification);
    setFormNotes(item.notes);
    setModal("edit");
  }

  function openReclassify(item: RequirementItem) {
    setActiveId(item.id);
    setFormClassification(item.classification);
    setModal("reclassify");
  }

  function openRemove(item: RequirementItem) {
    setActiveId(item.id);
    setModal("remove");
  }

  function handleAdd() {
    if (readOnly || !formName.trim()) return;
    const category =
      categories.find((entry) => entry.id === formCategoryId) ?? categories[0];
    const next: RequirementItem = {
      id: `ri-${Date.now()}`,
      categoryId: category?.id ?? "other",
      categoryLabel: category?.label ?? "Other",
      name: formName.trim(),
      value: formValue.trim(),
      classification: formClassification,
      status:
        formClassification === "required" && !formValue.trim()
          ? "missing"
          : "confirmed",
      source: { kind: "manual", label: "Manually added" },
      notes: formNotes.trim(),
    };
    setItems((current) => [...current, next]);
    markDirty(`Added requirement: ${next.name}`);
    closeModal();
  }

  function handleEdit() {
    if (readOnly || !activeId || !formName.trim()) return;
    const category =
      categories.find((entry) => entry.id === formCategoryId) ?? categories[0];
    setItems((current) =>
      current.map((item) => {
        if (item.id !== activeId) return item;
        const wasAi =
          item.source.kind === "ai" ||
          item.status === "suggested" ||
          item.status === "edited";
        const nextStatus: RequirementItemStatus =
          formClassification === "required" && !formValue.trim()
            ? "missing"
            : wasAi
              ? "edited"
              : "confirmed";
        return {
          ...item,
          categoryId: category?.id ?? item.categoryId,
          categoryLabel: category?.label ?? item.categoryLabel,
          name: formName.trim(),
          value: formValue.trim(),
          classification: formClassification,
          notes: formNotes.trim(),
          status: nextStatus,
          conflictWithId: undefined,
        };
      }),
    );
    markDirty(`Edited requirement: ${formName.trim()}`);
    closeModal();
  }

  function handleReclassify() {
    if (readOnly || !activeId) return;
    setItems((current) =>
      current.map((item) => {
        if (item.id !== activeId) return item;
        return {
          ...item,
          classification: formClassification,
          status:
            formClassification === "required" && !item.value.trim()
              ? "missing"
              : item.status === "suggested"
                ? "edited"
                : item.status === "conflict"
                  ? "confirmed"
                  : item.status,
          conflictWithId:
            item.status === "conflict" ? undefined : item.conflictWithId,
        };
      }),
    );
    markDirty(`Reclassified requirement to ${classificationLabel(formClassification)}`);
    closeModal();
  }

  function handleRemove() {
    if (readOnly || !activeId) return;
    const removed = items.find((item) => item.id === activeId);
    setItems((current) =>
      current
        .filter((item) => item.id !== activeId)
        .map((item) =>
          item.conflictWithId === activeId
            ? { ...item, status: "confirmed", conflictWithId: undefined }
            : item,
        ),
    );
    markDirty(`Removed requirement: ${removed?.name ?? "item"}`);
    closeModal();
  }

  function resolveConflict(item: RequirementItem) {
    if (readOnly) return;
    setItems((current) =>
      current.map((entry) => {
        if (entry.id === item.id) {
          return { ...entry, status: "confirmed", conflictWithId: undefined };
        }
        if (entry.id === item.conflictWithId || entry.conflictWithId === item.id) {
          return {
            ...entry,
            classification: "not_applicable",
            status: "edited",
            conflictWithId: undefined,
            notes: `${entry.notes ? `${entry.notes} · ` : ""}Superseded by "${item.name}"`.trim(),
          };
        }
        return entry;
      }),
    );
    markDirty(`Resolved conflict in favor of ${item.name}`);
  }

  function handleSaveVersion() {
    if (readOnly) return;
    const reason =
      changeReason.trim() ||
      draft.pendingChangeSummary ||
      "Updated requirement classifications and values.";
    const nextVersion = draft.version + 1;
    const snapshotCounts = countByClassification(items);
    setDraft((current) => ({
      ...current,
      version: nextVersion,
      previousVersion: current.version,
      draftStatus: "valid_draft",
      lastUpdated: new Date().toISOString(),
      pendingChangeSummary: "",
      versions: [
        {
          version: nextVersion,
          savedAt: new Date().toISOString(),
          changeReason: reason,
          author: current.requesterName,
          itemCount: items.length,
          requiredCount: snapshotCounts.required,
          preferredCount: snapshotCounts.preferred,
          unknownCount: snapshotCounts.unknown,
          naCount: snapshotCounts.na,
          changeSummary: reason,
        },
        ...current.versions,
      ],
    }));
    setDirty(false);
    setChangeReason("");
    closeModal();
  }

  const grouped = categories
    .map((category) => ({
      category,
      items: items.filter((item) => item.categoryId === category.id),
    }))
    .filter((group) => group.items.length > 0);

  const uncategorized = items.filter(
    (item) => !categories.some((category) => category.id === item.categoryId),
  );

  return (
    <div className="req-editor project-profile">
      <div className="wrap">
        <div className="pc-back">
          <Button href={needAiStructurePath(draft.id)} variant="text">
            ← Back to AI requirement structuring
          </Button>
        </div>

        {editorState === "permission_revoked" ? (
          <div className="pp-banner pp-banner-warn" role="alert">
            <strong>Permission revoked.</strong> You no longer have permission to
            edit this requirement. The page is read-only.
          </div>
        ) : null}

        {editorState === "missing_required" ? (
          <div className="pp-banner pp-banner-warn" role="status">
            <strong>Missing required data.</strong> Complete or reclassify these
            items before publishing:{" "}
            {missingItems.map((item) => item.name).join(", ")}.
          </div>
        ) : null}

        {editorState === "conflicting" ? (
          <div className="pp-banner pp-banner-warn" role="status">
            <strong>Conflicting values.</strong> Resolve conflicts before
            continuing to publish. X!Y will not choose a value for you.
          </div>
        ) : null}

        {editorState === "version_changed" ? (
          <div className="pp-banner pp-banner-info" role="status">
            <strong>Unsaved changes.</strong> Save a new version before
            continuing to publish.
            <button
              type="button"
              className="pp-banner-action"
              onClick={() => setModal("save")}
            >
              Save Version
            </button>
          </div>
        ) : null}

        {editorState === "valid_draft" ? (
          <div className="pp-banner pp-banner-info" role="status">
            <strong>Valid draft.</strong> Required information looks complete.
            You can continue to publish when ready.
          </div>
        ) : null}

        {editorState === "incomplete" ? (
          <div className="pp-banner pp-banner-muted" role="status">
            <strong>Incomplete.</strong> Add and classify requirements to prepare
            this need for publication.
          </div>
        ) : null}

        <header className="pp-header">
          <div className="pp-header-main">
            <p className="pp-eyebrow">Final structured preparation</p>
            <h1>Requirement Editor</h1>
            <p className="pp-summary">
              Review and classify your requirements before publishing. AI
              suggestions are not confirmed until you accept, edit, or reject
              them.
            </p>
          </div>
          <div className="pp-header-actions re-header-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={readOnly}
              onClick={openAdd}
            >
              Add Item
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={readOnly || !dirty}
              onClick={() => setModal("save")}
            >
              Save Version
            </Button>
          </div>
        </header>

        {/* Summary */}
        <section className="pp-section" aria-labelledby="re-summary-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="re-summary-heading">Requirement summary</h2>
              <p>Compact context for this need before matching/publication.</p>
            </div>
            <Button href={projectProfilePath(draft.projectId)} variant="text">
              View project
            </Button>
          </div>
          <div className="re-summary-grid">
            <div>
              <h3>Need title</h3>
              <p className="pp-ready-value">{draft.title}</p>
            </div>
            <div>
              <h3>Need type</h3>
              <p className="pp-ready-value">{needTypeLabel(draft.needType)}</p>
            </div>
            <div>
              <h3>Requester</h3>
              <p className="pp-ready-value">{draft.requesterName}</p>
            </div>
            <div>
              <h3>Project</h3>
              <p className="pp-ready-value">{draft.projectTitle}</p>
            </div>
            <div>
              <h3>Current version</h3>
              <p className="pp-ready-value">v{draft.version}</p>
            </div>
            <div>
              <h3>Draft status</h3>
              <p className="pp-ready-value">
                {dirty ? "Unsaved changes" : draft.draftStatus.replaceAll("_", " ")}
              </p>
            </div>
            <div>
              <h3>Last updated</h3>
              <p className="pp-ready-value">{formatTimestamp(draft.lastUpdated)}</p>
            </div>
            <div>
              <h3>Confidentiality</h3>
              <p className="pp-ready-value">{draft.confidentiality}</p>
            </div>
          </div>
        </section>

        {/* Version summary */}
        <section className="pp-section" aria-labelledby="re-version-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="re-version-heading">Version summary</h2>
              <p>Track counts and what changed from the previous version.</p>
            </div>
          </div>
          <div className="re-version-card">
            <div className="re-version-top">
              <div>
                <h3>Version {draft.version}</h3>
                <p className="pp-muted">
                  {draft.previousVersion
                    ? `Previous version: v${draft.previousVersion}`
                    : "No previous version"}
                  {" · "}
                  Last saved:{" "}
                  {draft.versions[0]
                    ? formatTimestamp(draft.versions[0].savedAt)
                    : formatTimestamp(draft.lastUpdated)}
                </p>
              </div>
              <div className="pp-badges">
                <span className="pp-badge">{items.length} requirements</span>
                <span className="pp-badge">{counts.required} Required</span>
                <span className="pp-badge pp-badge-soft">
                  {counts.preferred} Preferred
                </span>
                <span className="pp-badge pp-badge-soft">
                  {counts.unknown} Unknown
                </span>
                <span className="pp-badge pp-badge-soft">{counts.na} N/A</span>
              </div>
            </div>
            <p className="re-change-copy">
              {dirty
                ? draft.pendingChangeSummary || "Changes pending — save a new version."
                : draft.versions[0]?.changeSummary ||
                  "No additional changes since last save."}
            </p>
          </div>
        </section>

        {/* Requirements by category */}
        <section className="pp-section" aria-labelledby="re-items-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="re-items-heading">Requirement items</h2>
              <p>
                Classify each item as Required, Preferred, Unknown, or Not
                Applicable. Template adapts to {needTypeLabel(draft.needType)}.
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              disabled={readOnly}
              onClick={openAdd}
            >
              Add Item
            </Button>
          </div>

          {items.length === 0 ? (
            <div className="pp-empty pc-empty">
              <strong>No requirements yet</strong>
              <p>Add items manually or continue from AI structuring suggestions.</p>
              <Button type="button" variant="primary" disabled={readOnly} onClick={openAdd}>
                Add Item
              </Button>
            </div>
          ) : (
            <div className="re-category-stack">
              {grouped.map(({ category, items: groupItems }) => (
                <div key={category.id} className="re-category-block">
                  <div className="re-category-head">
                    <h3>{category.label}</h3>
                    <p>{category.description}</p>
                  </div>
                  <ul className="re-item-list">
                    {groupItems.map((item) => (
                      <li
                        key={item.id}
                        className={`re-item-card${item.status === "conflict" ? " re-item-conflict" : ""}${item.status === "missing" ? " re-item-missing" : ""}`}
                      >
                        <div className="re-item-top">
                          <div>
                            <h4>{item.name}</h4>
                            <p className="pc-related">Category: {item.categoryLabel}</p>
                          </div>
                          <div className="pp-badges">
                            <span
                              className={`pp-chip pp-chip-${item.classification === "required" ? "open" : item.classification === "preferred" ? "in_progress" : "closed"}`}
                            >
                              {classificationLabel(item.classification)}
                            </span>
                            <span className="pp-badge pp-badge-soft">
                              {statusLabel(item.status)}
                            </span>
                          </div>
                        </div>

                        <div className="re-item-value">
                          <span>Value</span>
                          <p>
                            {item.value.trim()
                              ? item.value
                              : "No value — add data or mark Unknown / N/A"}
                          </p>
                        </div>

                        <p className="pp-muted">
                          Source: {item.source.label}
                        </p>
                        {item.notes ? (
                          <p className="pp-muted">Notes: {item.notes}</p>
                        ) : null}

                        {item.status === "conflict" ? (
                          <div className="re-inline-alert">
                            Conflict with another volume/value. Edit, reclassify,
                            remove, or resolve explicitly.
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={readOnly}
                              onClick={() => resolveConflict(item)}
                            >
                              Resolve (keep this)
                            </Button>
                          </div>
                        ) : null}

                        {item.status === "missing" ? (
                          <div className="re-inline-alert">
                            Missing required data for this item. Update the value
                            or reclassify it.
                          </div>
                        ) : null}

                        <div className="pc-thread-actions">
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={readOnly}
                            onClick={() => openEdit(item)}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={readOnly}
                            onClick={() => openReclassify(item)}
                          >
                            Reclassify
                          </Button>
                          <Button
                            type="button"
                            variant="text"
                            className="pp-archive-btn"
                            disabled={readOnly}
                            onClick={() => openRemove(item)}
                          >
                            Remove
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {uncategorized.length > 0 ? (
                <div className="re-category-block">
                  <div className="re-category-head">
                    <h3>Other</h3>
                  </div>
                  <ul className="re-item-list">
                    {uncategorized.map((item) => (
                      <li key={item.id} className="re-item-card">
                        <h4>{item.name}</h4>
                        <p>{item.value}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* Change reason + actions */}
        <section className="pp-section" aria-labelledby="re-actions-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="re-actions-heading">Save &amp; publish</h2>
              <p>
                Saving creates a new version. Continue to publish only when the
                structured draft is ready.
              </p>
            </div>
          </div>

          <div className="re-save-card">
            <label className="pc-field">
              Change reason
              <textarea
                rows={3}
                value={changeReason}
                disabled={readOnly}
                onChange={(e) => setChangeReason(e.target.value)}
                placeholder='Example: "Updated production volume and added certification requirement."'
              />
            </label>
            <div className="re-final-actions">
              <Button
                type="button"
                variant="ghost"
                disabled={readOnly}
                onClick={() => setModal("save")}
              >
                Save Version
              </Button>
              {canPublish ? (
                <Button href={needPublishPath(draft.id)} variant="primary">
                  Continue to Publish
                </Button>
              ) : (
                <Button type="button" variant="primary" disabled>
                  Continue to Publish
                </Button>
              )}
            </div>
            {!canPublish && !readOnly ? (
              <p className="pp-muted">
                Resolve missing data and conflicts, then save the current version
                before publishing.
              </p>
            ) : null}
          </div>
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
            aria-labelledby="re-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            {modal === "add" || modal === "edit" ? (
              <>
                <h3 id="re-modal-title">
                  {modal === "add" ? "Add requirement item" : "Edit requirement"}
                </h3>
                <p className="pp-muted">
                  {modal === "add"
                    ? "Manually added items are marked as Source: Manually added."
                    : "Editing an AI suggestion marks it as Edited."}
                </p>
                <label className="pc-field">
                  Category
                  <select
                    value={formCategoryId}
                    onChange={(e) => setFormCategoryId(e.target.value)}
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="pc-field">
                  Requirement name
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Production volume"
                  />
                </label>
                <label className="pc-field">
                  Value
                  <textarea
                    rows={3}
                    value={formValue}
                    onChange={(e) => setFormValue(e.target.value)}
                    placeholder="Requirement value"
                  />
                </label>
                <label className="pc-field">
                  Classification
                  <select
                    value={formClassification}
                    onChange={(e) =>
                      setFormClassification(
                        e.target.value as RequirementClassification,
                      )
                    }
                  >
                    <option value="required">Required</option>
                    <option value="preferred">Preferred</option>
                    <option value="unknown">Unknown</option>
                    <option value="not_applicable">Not Applicable</option>
                  </select>
                </label>
                <label className="pc-field">
                  Notes
                  <textarea
                    rows={2}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Optional notes"
                  />
                </label>
                <div className="pc-modal-actions">
                  <Button type="button" variant="ghost" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={modal === "add" ? handleAdd : handleEdit}
                  >
                    {modal === "add" ? "Add item" : "Save changes"}
                  </Button>
                </div>
              </>
            ) : null}

            {modal === "reclassify" && activeItem ? (
              <>
                <h3 id="re-modal-title">Reclassify</h3>
                <p className="pp-muted">
                  Change classification for <strong>{activeItem.name}</strong>.
                </p>
                <div className="re-classify-grid" role="radiogroup">
                  {(
                    [
                      "required",
                      "preferred",
                      "unknown",
                      "not_applicable",
                    ] as RequirementClassification[]
                  ).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`re-classify-option${formClassification === option ? " active" : ""}`}
                      onClick={() => setFormClassification(option)}
                    >
                      {classificationLabel(option)}
                    </button>
                  ))}
                </div>
                <div className="pc-modal-actions">
                  <Button type="button" variant="ghost" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleReclassify}
                  >
                    Apply classification
                  </Button>
                </div>
              </>
            ) : null}

            {modal === "remove" && activeItem ? (
              <>
                <h3 id="re-modal-title">Remove requirement</h3>
                <p className="pp-muted">
                  Remove <strong>{activeItem.name}</strong> from the current
                  draft? Prior saved versions stay in history.
                </p>
                <div className="pc-modal-actions">
                  <Button type="button" variant="ghost" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" onClick={handleRemove}>
                    Remove
                  </Button>
                </div>
              </>
            ) : null}

            {modal === "save" ? (
              <>
                <h3 id="re-modal-title">Save version</h3>
                <p className="pp-muted">
                  Creates version {draft.version + (dirty ? 1 : 0)} without
                  overwriting prior version history.
                </p>
                <label className="pc-field">
                  Change reason
                  <textarea
                    rows={3}
                    value={changeReason}
                    onChange={(e) => setChangeReason(e.target.value)}
                    placeholder="Why is this version changing?"
                  />
                </label>
                <div className="pc-modal-actions">
                  <Button type="button" variant="ghost" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleSaveVersion}
                  >
                    Save Version
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
