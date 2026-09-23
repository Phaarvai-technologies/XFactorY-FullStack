"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { dimensionsForCandidates } from "@/lib/needs/compareDimensions";
import {
  candidateProfilePath,
  startEngagementPath,
} from "@/lib/needs/compareData";
import type {
  CandidateNote,
  CompareCandidate,
  CompareDimensionValue,
  EvidenceStatus,
} from "@/lib/needs/compareTypes";
import { needPublishPath } from "@/lib/needs/paths";

const MAX_CANDIDATES = 4;

type CompareCandidatesViewProps = {
  needId: string;
  needTitle: string;
  organizationName: string;
  pool: CompareCandidate[];
  initialSelectedIds: string[];
};

function evidenceLabel(status: EvidenceStatus): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "evidence_provided":
      return "Evidence provided";
    case "partially_verified":
      return "Partially verified";
    case "not_provided":
      return "Not provided";
    case "unknown":
      return "Unknown";
    case "stale":
      return "Stale";
  }
}

function verificationLabel(
  status: CompareCandidate["verificationStatus"],
): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "partial":
      return "Partial";
    case "unverified":
      return "Unverified";
  }
}

function renderValue(value: CompareDimensionValue | undefined) {
  if (!value) {
    return (
      <span className="cmp-unknown">
        Not provided
      </span>
    );
  }
  if (value.kind === "unknown") {
    return <span className="cmp-unknown">Unknown</span>;
  }
  if (value.kind === "not_provided") {
    return <span className="cmp-unknown">Not provided</span>;
  }
  if (value.kind === "stale") {
    return (
      <div className="cmp-stale">
        <span>{value.text}</span>
        <span className="pp-muted">
          Last updated: {value.lastUpdatedLabel}
        </span>
        <span className="pp-chip pp-chip-closed">Stale</span>
      </div>
    );
  }
  return <span>{value.text}</span>;
}

export function CompareCandidatesView({
  needId,
  needTitle,
  organizationName,
  pool,
  initialSelectedIds,
}: CompareCandidatesViewProps) {
  const [selectedIds, setSelectedIds] = useState(initialSelectedIds);
  const [notes, setNotes] = useState<CandidateNote[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [shortlistSaved, setShortlistSaved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => pool.find((candidate) => candidate.id === id))
        .filter((candidate): candidate is CompareCandidate => Boolean(candidate)),
    [selectedIds, pool],
  );

  const availableToAdd = pool.filter(
    (candidate) => !selectedIds.includes(candidate.id),
  );

  const dimensions = useMemo(
    () => dimensionsForCandidates(selected.map((c) => c.persona)),
    [selected],
  );

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  }

  function removeCandidate(id: string) {
    setSelectedIds((current) => current.filter((entry) => entry !== id));
    setShortlistSaved(false);
  }

  function addCandidate(id: string) {
    if (selectedIds.includes(id)) return;
    if (selectedIds.length >= MAX_CANDIDATES) {
      showToast("Comparison supports up to 4 candidates.");
      return;
    }
    setSelectedIds((current) => [...current, id]);
    setShortlistSaved(false);
    setAddOpen(false);
    showToast("Candidate added to comparison.");
  }

  function saveNote(candidateId: string) {
    const text = (noteDrafts[candidateId] ?? "").trim();
    setNotes((current) => {
      const without = current.filter((note) => note.candidateId !== candidateId);
      return text ? [...without, { candidateId, text }] : without;
    });
    setShortlistSaved(false);
    showToast("Private note saved for your Organization.");
  }

  function saveShortlist() {
    if (selected.length < 2) {
      showToast("Select at least 2 candidates to save a shortlist.");
      return;
    }
    setShortlistSaved(true);
    showToast("Shortlist saved");
  }

  const shortlistStatus = shortlistSaved
    ? "Shortlist saved"
    : selected.length >= 2
      ? "Ready to save"
      : "Incomplete selection";

  return (
    <div className="req-editor project-profile compare-page">
      <div className="wrap">
        <div className="pc-back">
          <Button href={needPublishPath(needId)} variant="text">
            ← Back to publish / matching
          </Button>
        </div>

        <header className="pp-header">
          <div className="pp-header-main">
            <p className="pp-eyebrow">Candidate comparison</p>
            <h1>Compare Candidates</h1>
            <p className="pp-summary">
              Side-by-side facts only — no overall ranking, score, tier, or
              recommendation. Unknowns stay visible as Unknown / Not provided.
            </p>
            <div className="pp-badges">
              <span className="pp-badge">{needTitle}</span>
              <span className="pp-badge pp-badge-soft">Need ID: {needId}</span>
              <span className="pp-badge pp-badge-soft">{organizationName}</span>
              <span className="pp-badge">
                {selected.length} selected
              </span>
              <span className="pp-badge pp-badge-soft">{shortlistStatus}</span>
            </div>
          </div>
          <div className="pp-header-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={selectedIds.length >= MAX_CANDIDATES}
              onClick={() => setAddOpen(true)}
            >
              Add Candidate
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={selected.length < 2}
              onClick={saveShortlist}
            >
              Save Shortlist
            </Button>
          </div>
        </header>

        {selectedIds.length >= MAX_CANDIDATES ? (
          <div className="pp-banner pp-banner-info" role="status">
            <strong>Comparison limit reached.</strong> You can compare up to 4
            candidates. Remove one to add another.
          </div>
        ) : null}

        {shortlistSaved ? (
          <div className="pp-banner pp-banner-info" role="status">
            <strong>Shortlist saved.</strong> Notes stay private to your
            Organization. Engagement is not started automatically.
          </div>
        ) : null}

        {/* Selected chips */}
        <section className="pp-section" aria-labelledby="cmp-selected-heading">
          <div className="pp-section-head">
            <div>
              <h2 id="cmp-selected-heading">Selected candidates</h2>
              <p>Manage a set of 2–4 candidates for transparent comparison.</p>
            </div>
          </div>

          {selected.length === 0 ? (
            <div className="pp-empty pc-empty">
              <strong>No candidates selected</strong>
              <p>Add candidates from matching results to begin comparison.</p>
              <Button type="button" variant="primary" onClick={() => setAddOpen(true)}>
                Add Candidate
              </Button>
            </div>
          ) : (
            <ul className="cmp-chip-grid">
              {selected.map((candidate) => (
                <li
                  key={candidate.id}
                  className={`cmp-chip-card${candidate.eligibility === "ineligible" ? " cmp-ineligible" : ""}`}
                >
                  <div className="cmp-chip-top">
                    <h3>{candidate.name}</h3>
                    <span
                      className={`pp-chip ${
                        candidate.eligibility === "ineligible"
                          ? "pp-chip-closed"
                          : "pp-chip-in_progress"
                      }`}
                    >
                      {candidate.eligibility === "ineligible"
                        ? "No longer eligible"
                        : "Eligible"}
                    </span>
                  </div>
                  <p className="pp-muted">
                    {candidate.personaLabel} · {candidate.organizationName}
                  </p>
                  <p className="pp-muted">{candidate.location}</p>
                  <div className="pp-badges" style={{ marginTop: 10 }}>
                    <span className="pp-badge pp-badge-soft">
                      {verificationLabel(candidate.verificationStatus)}
                    </span>
                    <span className="pp-badge pp-badge-soft">
                      {evidenceLabel(candidate.evidence)}
                    </span>
                  </div>
                  {candidate.eligibility === "ineligible" &&
                  candidate.ineligibleReason ? (
                    <p className="pp-muted" style={{ marginTop: 10 }}>
                      Reason: {candidate.ineligibleReason}
                    </p>
                  ) : null}
                  <div className="pc-thread-actions">
                    <Button
                      href={candidateProfilePath(candidate.id, needId)}
                      variant="ghost"
                    >
                      Open Candidate
                    </Button>
                    <Button
                      type="button"
                      variant="text"
                      className="pp-archive-btn"
                      onClick={() => removeCandidate(candidate.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Empty / insufficient */}
        {selected.length === 1 ? (
          <div className="pp-empty pc-empty">
            <strong>Select at least 2 candidates to compare.</strong>
            <p>Add another candidate from the matching results.</p>
            <Button
              type="button"
              variant="primary"
              disabled={selectedIds.length >= MAX_CANDIDATES}
              onClick={() => setAddOpen(true)}
            >
              Add Candidate
            </Button>
          </div>
        ) : null}

        {selected.length === 0 ? null : selected.length >= 2 ? (
          <>
            {/* Desktop table */}
            <section
              className="pp-section cmp-desktop-only"
              aria-labelledby="cmp-table-heading"
            >
              <div className="pp-section-head">
                <div>
                  <h2 id="cmp-table-heading">Comparison</h2>
                  <p>
                    Role-relevant dimensions. Values are factual — no winner or
                    score.
                  </p>
                </div>
              </div>
              <div className="cmp-table-wrap">
                <table className="cmp-table">
                  <thead>
                    <tr>
                      <th scope="col">Dimension</th>
                      {selected.map((candidate) => (
                        <th key={candidate.id} scope="col">
                          {candidate.name}
                          {candidate.eligibility === "ineligible" ? (
                            <span className="cmp-th-note">Ineligible</span>
                          ) : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dimensions.map((dimension) => (
                      <tr key={dimension.id}>
                        <th scope="row">{dimension.label}</th>
                        {selected.map((candidate) => (
                          <td key={`${candidate.id}-${dimension.id}`}>
                            {renderValue(candidate.values[dimension.id])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Mobile stacked */}
            <section
              className="pp-section cmp-mobile-only"
              aria-labelledby="cmp-stack-heading"
            >
              <div className="pp-section-head">
                <div>
                  <h2 id="cmp-stack-heading">Comparison</h2>
                  <p>Stacked candidate cards for smaller screens.</p>
                </div>
              </div>
              <div className="cmp-stack">
                {selected.map((candidate) => (
                  <article
                    key={candidate.id}
                    className={`re-item-card${candidate.eligibility === "ineligible" ? " cmp-ineligible" : ""}`}
                  >
                    <div className="re-item-top">
                      <div>
                        <h4>{candidate.name}</h4>
                        <p className="pc-related">
                          {candidate.personaLabel} · {candidate.location}
                        </p>
                      </div>
                      <span
                        className={`pp-chip ${
                          candidate.eligibility === "ineligible"
                            ? "pp-chip-closed"
                            : "pp-chip-open"
                        }`}
                      >
                        {candidate.eligibility === "ineligible"
                          ? "No longer eligible"
                          : "Eligible"}
                      </span>
                    </div>
                    <dl className="cmp-stack-dl">
                      {dimensions.map((dimension) => (
                        <div key={dimension.id}>
                          <dt>{dimension.label}</dt>
                          <dd>{renderValue(candidate.values[dimension.id])}</dd>
                        </div>
                      ))}
                    </dl>
                    {candidate.eligibility === "ineligible" &&
                    candidate.ineligibleReason ? (
                      <p className="pp-muted">
                        Reason: {candidate.ineligibleReason}
                      </p>
                    ) : null}
                    <div className="pc-thread-actions">
                      <Button
                        href={candidateProfilePath(candidate.id, needId)}
                        variant="ghost"
                      >
                        Open Candidate
                      </Button>
                      <Button
                        type="button"
                        variant="text"
                        className="pp-archive-btn"
                        onClick={() => removeCandidate(candidate.id)}
                      >
                        Remove
                      </Button>
                      {candidate.eligibility === "eligible" ? (
                        <Button
                          href={startEngagementPath(needId, candidate.id)}
                          variant="primary"
                        >
                          Start Engagement
                        </Button>
                      ) : (
                        <Button type="button" variant="primary" disabled>
                          Start Engagement
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {/* Desktop engagement row */}
            <section className="pp-section cmp-desktop-only">
              <div className="pp-section-head">
                <div>
                  <h2>Start engagement</h2>
                  <p>
                    Start from an eligible candidate. Ineligible candidates stay
                    visible but cannot start engagement.
                  </p>
                </div>
              </div>
              <ul className="cmp-engage-row">
                {selected.map((candidate) => (
                  <li key={candidate.id}>
                    <span>{candidate.name}</span>
                    {candidate.eligibility === "eligible" ? (
                      <Button
                        href={startEngagementPath(needId, candidate.id)}
                        variant="ghost"
                      >
                        Start Engagement
                      </Button>
                    ) : (
                      <Button type="button" variant="ghost" disabled>
                        Start Engagement
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {/* Private notes */}
            <section className="pp-section" aria-labelledby="cmp-notes-heading">
              <div className="pp-section-head">
                <div>
                  <h2 id="cmp-notes-heading">Shortlist notes</h2>
                  <p>Private to your Organization — never shown to candidates.</p>
                </div>
              </div>
              <ul className="cmp-notes-list">
                {selected.map((candidate) => {
                  const existing = notes.find(
                    (note) => note.candidateId === candidate.id,
                  );
                  const draft =
                    noteDrafts[candidate.id] ?? existing?.text ?? "";
                  return (
                    <li key={candidate.id} className="re-item-card">
                      <h4>{candidate.name}</h4>
                      <p className="pp-muted" style={{ marginBottom: 10 }}>
                        Private to {organizationName}
                      </p>
                      <label className="pc-field" style={{ marginTop: 0 }}>
                        Note
                        <textarea
                          rows={3}
                          value={draft}
                          onChange={(e) =>
                            setNoteDrafts((current) => ({
                              ...current,
                              [candidate.id]: e.target.value,
                            }))
                          }
                          placeholder='Example: "Follow up about prototype capacity."'
                        />
                      </label>
                      <div className="pc-thread-actions">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => saveNote(candidate.id)}
                        >
                          Save note
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="pp-section">
              <div className="re-final-actions">
                <Button
                  type="button"
                  variant="primary"
                  onClick={saveShortlist}
                >
                  Save Shortlist
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={selectedIds.length >= MAX_CANDIDATES}
                  onClick={() => setAddOpen(true)}
                >
                  Add Candidate
                </Button>
              </div>
            </section>
          </>
        ) : null}
      </div>

      {addOpen ? (
        <div
          className="pc-modal-backdrop"
          role="presentation"
          onClick={() => setAddOpen(false)}
        >
          <div
            className="pc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cmp-add-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="cmp-add-title">Add candidate</h3>
            <p className="pp-muted">
              Select from matching results. Duplicates are prevented. Maximum{" "}
              {MAX_CANDIDATES} candidates.
            </p>
            {availableToAdd.length === 0 ? (
              <div className="pp-empty">
                No additional candidates available in the current matching set.
              </div>
            ) : (
              <ul className="cmp-add-list">
                {availableToAdd.map((candidate) => (
                  <li key={candidate.id}>
                    <div>
                      <strong>{candidate.name}</strong>
                      <p className="pp-muted">
                        {candidate.personaLabel} · {candidate.location}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={selectedIds.length >= MAX_CANDIDATES}
                      onClick={() => addCandidate(candidate.id)}
                    >
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="pc-modal-actions">
              <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
                Close
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
