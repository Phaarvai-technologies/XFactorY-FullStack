"use client";

import { useEffect, useState } from "react";
import { FlowHeader } from "@/components/visionary/FlowChrome";
import { useVisionaryApi, type ManufacturerMatches } from "@/lib/visionary/api";
import type { VisionarySlide } from "@/lib/visionary/paths";
import {
  TIMELINE_LABELS,
  initials,
  type ManufacturerRecord,
  type VisionaryRequirements,
} from "@/lib/visionary/storage";
import { getVisionaryData } from "@/lib/visionary/store";

/** The requirement chips, in the existing order: location, quantity, budget, timeline, machines. */
function requirementChips(requirements: VisionaryRequirements | null | undefined): string[] {
  const chips: string[] = [];
  if (!requirements) return chips;
  if (requirements.manufacturing_location) chips.push(requirements.manufacturing_location);
  if (requirements.quantity?.value) chips.push(`${requirements.quantity.value.toLocaleString("en-IN")} units`);
  if (requirements.budget?.amount) chips.push(`₹${requirements.budget.amount.toLocaleString("en-IN")}`);
  if (requirements.timeline && TIMELINE_LABELS[requirements.timeline]) chips.push(TIMELINE_LABELS[requirements.timeline]);
  for (const machine of requirements.machines ?? []) chips.push(machine);
  return chips;
}

const FIELD_LABELS: Record<string, string> = { quantity: "quantity", budget: "budget", timeline: "timeline" };

/** "Matched on location and machines. Quantity, budget and timeline are shown for reference only: …"
 * (from the backend's answer: what it filtered on and what the data cannot be compared with). */
function matchingNote(result: ManufacturerMatches | null): string {
  if (!result?.requirements) return "";
  const lead = result.applied.length ? `Matched on ${result.applied.join(" and ")}.` : "";
  const skipped = result.notCompared.map((n) => FIELD_LABELS[n.field] ?? n.field);
  if (!skipped.length) return lead;
  const list = skipped.length > 1 ? `${skipped.slice(0, -1).join(", ")} and ${skipped.at(-1)}` : skipped[0];
  const many = skipped.length > 1;
  return `${lead} ${list.charAt(0).toUpperCase()}${list.slice(1)} ${many ? "are" : "is"} shown for reference only: manufacturer profiles don't record the data to compare ${many ? "them" : "it"} with.`.trim();
}

function Pin() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 18s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z"
        stroke="#5b6b88"
        strokeWidth="1.8"
      />
      <circle cx="10" cy="8" r="2.2" stroke="#5b6b88" strokeWidth="1.8" />
    </svg>
  );
}

export function ManufacturerResults({
  onContinue,
  onSelect,
  onChoose,
  selectedId,
}: {
  onContinue: (slide: VisionarySlide) => void;
  onSelect: (id: string) => void;
  onChoose: (id: string) => void;
  selectedId: string | null;
}) {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const saved = getVisionaryData().requirements;
  const visionaryApi = useVisionaryApi();
  /** Which saved requirements the answer belongs to; an answer for other requirements is never shown. */
  /** The search as sent to the server (for the not-yet-verified listings), 300 ms after typing. */
  const [searchKey, setSearchKey] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchKey(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const savedKey = JSON.stringify(saved ?? null);
  const requestKey = `${savedKey}|${searchKey}`;
  const [answer, setAnswer] = useState<{ key: string; attempt: number; status: "ready" | "error"; result: ManufacturerMatches | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const current = answer && answer.key === requestKey && answer.attempt === attempt ? answer : null;
  const status: "loading" | "ready" | "error" = current ? current.status : "loading";
  const result = current?.result ?? null;
  /** Further pages of listings ("Show more"), for this exact answer only. */
  const [more, setMore] = useState<{ answer: object; items: ManufacturerRecord[] } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const extra = more && current && more.answer === current ? more.items : [];
  const listings: ManufacturerRecord[] = [...(result?.listings ?? []), ...extra];
  const verifiedMatches: ManufacturerRecord[] = result?.manufacturers ?? [];
  const manufacturers: ManufacturerRecord[] = [...verifiedMatches, ...listings];
  const listingsTotal = result?.listingsTotal ?? 0;

  /**
   * GET /visionary/manufacturers/matches: the backend matches the Visionary's SAVED requirements
   * against the manufacturers in the database (same visibility and approval rules as before).
   * Runs on open, whenever the saved requirements change, and on "Try Again". Nothing is cached,
   * and an answer that arrives after a newer request started is ignored.
   */
  useEffect(() => {
    let active = true;
    visionaryApi.matches(searchKey, 0).then(
      (next) => {
        if (active) setAnswer({ key: requestKey, attempt, status: "ready", result: next });
      },
      () => {
        if (active) setAnswer({ key: requestKey, attempt, status: "error", result: null });
      },
    );
    return () => {
      active = false;
    };
    // Only the requirements, the search and Try Again start a new request (not a new API helper object).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, attempt]);

  function load() {
    setAttempt((n) => n + 1);
  }

  /** "Show more": the next page of not-yet-verified listings for the same requirements and search. */
  function showMore() {
    if (!current || loadingMore) return;
    const owner = current;
    setLoadingMore(true);
    visionaryApi.matches(searchKey, listings.length).then(
      (next) => {
        setMore((prev) => ({ answer: owner, items: [...(prev && prev.answer === owner ? prev.items : []), ...next.listings] }));
        setLoadingMore(false);
      },
      () => setLoadingMore(false),
    );
  }

  // The chips show the requirements the backend matched with (while loading: the saved ones).
  const chips = requirementChips(status === "ready" ? result?.requirements : saved);
  const note = status === "ready"
    ? [matchingNote(result),
       listingsTotal > 0
         ? "Companies marked “Not yet verified” come from public business records and have not joined X!Y yet: you can view them, but requests can only be sent to verified manufacturers."
         : ""].filter(Boolean).join(" ")
    : "";

  // Search: within the matching manufacturers, by company name, product or machine.
  const visible = manufacturers.filter((item) => {
    const text = query.trim().toLowerCase();
    if (!text) return true;
    return [item.name, ...item.machines, ...item.products].join(" ").toLowerCase().includes(text);
  });

  const filtersActive = Boolean(query.trim());
  // Verified matches on this page + every listing the server found (listings are paged).
  const shownTotal = visible.filter((item) => !item.listing).length + (query.trim() === searchKey ? listingsTotal : visible.filter((item) => item.listing).length);

  return (
    <div className="view active" id="v-mf">
      <FlowHeader />
      <main>
        <button type="button" className="back" onClick={() => onContinue("step4")}>
          ← Back to requirements
        </button>
        <h1>Find a Manufacturer</h1>
        <p className="lead">Explore manufacturers that can support your manufacturing requirements.</p>
        {chips.length > 0 ? (
          <div className="reqs">
            <b>Your requirements</b>
            {chips.map((chip) => (
              <span className="c" key={chip}>
                {chip}
              </span>
            ))}
          </div>
        ) : null}
        {note ? <p className="lead">{note}</p> : null}

        {profileId ? null : (
        <section className="filters search-only" aria-label="Filters">
          <div className="f sw-wrap">
            <label htmlFor="mf-q">Search</label>
            <div className="sw">
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="9" cy="9" r="6" stroke="#1d5fe0" strokeWidth="2" />
                <path d="M14 14l4 4" stroke="#1d5fe0" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                id="mf-q"
                placeholder="Search by name, product or machine"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
        </section>
        )}

        {profileId || status !== "ready" ? null : (
        <div className="bar">
          <span aria-live="polite">
            <strong>{shownTotal}</strong> manufacturer{shownTotal === 1 ? "" : "s"}
          </span>
          {filtersActive ? (
            <button
              type="button"
              className="link"
              onClick={() => {
                setQuery("");
                document.getElementById("mf-q")?.focus();
              }}
            >
              Clear search
            </button>
          ) : null}
        </div>
        )}

        {profileId ? (
          <ManufacturerProfile
            item={manufacturers.find((item) => item.id === profileId) ?? null}
            onBack={() => setProfileId(null)}
            onChoose={onChoose}
          />
        ) : (
        <section className="grid" aria-label="Manufacturers" aria-busy={status === "loading"}>
          {status === "loading" ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : status === "error" ? (
            <div className="empty">
              <h3>Unable to load manufacturers</h3>
              <p>Please try again.</p>
              <button type="button" className="btn" onClick={load}>
                Try Again
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty">
              <h3>No matching manufacturers found</h3>
              <p>
                {!result?.requirements
                  ? "Add your manufacturing requirements to find matching manufacturers."
                  : manufacturers.length > 0
                    ? "Try changing your search."
                    : "No manufacturer matches your requirements yet. Try changing your requirements."}
              </p>
            </div>
          ) : (
            visible.map((item) => (
              <ManufacturerCard
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onSelect={onSelect}
                onChoose={onChoose}
                onView={() => setProfileId(item.id)}
              />
            ))
          )}
        </section>
        )}
        {!profileId && status === "ready" && query.trim() === searchKey && listings.length < listingsTotal ? (
          <div className="bar">
            <span />
            <button type="button" className="link" onClick={showMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : `Show more (${(listingsTotal - listings.length).toLocaleString("en-IN")} more)`}
            </button>
          </div>
        ) : null}

        <nav className="pager" aria-label="Page navigation">
          <button type="button" className="pbtn pg-prev" onClick={() => onContinue("step4")}>
            Previous
          </button>
          <button type="button" className="pbtn pg-skip" onClick={() => onContinue("project")}>
            Skip
          </button>
          <button type="button" className="pbtn pg-next" onClick={() => onContinue("request")}>
            Continue
          </button>
        </nav>
      </main>
    </div>
  );
}

function Mark({ item }: { item: ManufacturerRecord }) {
  if (item.logo) {
    return <img className="logo" src={item.logo} alt="" />;
  }
  return (
    <div className="ini" aria-hidden="true">
      {initials(item.name)}
    </div>
  );
}

function ManufacturerCard({
  item,
  selected,
  onSelect,
  onChoose,
  onView,
}: {
  item: ManufacturerRecord;
  selected: boolean;
  onSelect: (id: string) => void;
  onChoose: (id: string) => void;
  onView: () => void;
}) {
  const later = !/^(accepting|available)/i.test(item.availability);
  const capabilityLine = item.capabilities || item.category;
  return (
    <article
      className={`mcard${selected ? " selected" : ""}`}
      onClick={() => {
        if (!item.listing) onSelect(item.id); // a not-yet-verified listing cannot be chosen
      }}
    >
      <div className="top">
        <Mark item={item} />
        <div>
          <h3>{item.name}</h3>
          {item.location ? (
            <div className="loc">
              <Pin />
              {item.location}
            </div>
          ) : null}
          {item.verified ? <span className="verify">Verified</span> : null}
        </div>
      </div>
      {capabilityLine ? <p className="cap">{capabilityLine}</p> : null}
      {item.about ? <p className="about">{item.about}</p> : null}
      {item.machines.length > 0 ? (
        <>
          <div className="lbl">Available machinery</div>
          <div className="chips">
            {item.machines.map((machine) => (
              <span className="chip" key={machine}>
                {machine}
              </span>
            ))}
          </div>
        </>
      ) : null}
      <div className="stats">
        <div className="stat">
          <small>Production capacity</small>
          <b>{item.capacity ? `${item.capacity.toLocaleString("en-IN")} units/month` : "Not specified"}</b>
        </div>
        <div className="stat">
          <small>Available machines</small>
          <b>{item.machines.length ? String(item.machines.length) : "Not specified"}</b>
        </div>
      </div>
      {item.moq ? (
        <div className="lbl">Minimum order: {item.moq.toLocaleString("en-IN")} units</div>
      ) : null}
      <div className={`avail${later ? " later" : ""}`}>
        <i />
        {item.availability}
      </div>
      <div className="spacer" />
      <div className="btns">
        {item.listing ? null : (
        <button
          type="button"
          className="btn"
          onClick={(event) => {
            event.stopPropagation();
            onChoose(item.id);
          }}
        >
          Select Manufacturer
        </button>
        )}
        <button
          type="button"
          className="btn-ghost"
          onClick={(event) => {
            event.stopPropagation();
            onView();
          }}
        >
          View Profile
        </button>
      </div>
    </article>
  );
}

function ManufacturerProfile({
  item,
  onBack,
  onChoose,
}: {
  item: ManufacturerRecord | null;
  onBack: () => void;
  onChoose: (id: string) => void;
}) {
  if (!item) {
    return (
      <div className="empty">
        <h3>Unable to load manufacturers</h3>
        <p>Please try again.</p>
        <button type="button" className="btn" onClick={onBack}>
          Back to manufacturers
        </button>
      </div>
    );
  }
  const later = !/^(accepting|available)/i.test(item.availability);
  return (
    <article className="profile">
      <button type="button" className="back" onClick={onBack}>
        ← Back to manufacturers
      </button>
      <div className="top">
        <Mark item={item} />
        <div>
          <h2>{item.name}</h2>
          {item.location ? (
            <div className="loc">
              <Pin />
              {item.location}
            </div>
          ) : null}
          {item.verified ? <span className="verify">Verified</span> : null}
        </div>
      </div>
      {item.category ? <p className="cap">{item.category}</p> : null}
      {item.about ? <p className="about">{item.about}</p> : null}
      {item.capabilities ? (
        <>
          <div className="lbl">Manufacturing capabilities</div>
          <p className="cap">{item.capabilities}</p>
        </>
      ) : null}
      {item.machines.length > 0 ? (
        <>
          <div className="lbl">Available machinery</div>
          <div className="chips">
            {item.machines.map((machine) => (
              <span className="chip" key={machine}>
                {machine}
              </span>
            ))}
          </div>
        </>
      ) : null}
      <div className="stats">
        <div className="stat">
          <small>Production capacity</small>
          <b>{item.capacity ? `${item.capacity.toLocaleString("en-IN")} units/month` : "Not specified"}</b>
        </div>
        <div className="stat">
          <small>Minimum order</small>
          <b>{item.moq ? `${item.moq.toLocaleString("en-IN")} units` : "Not specified"}</b>
        </div>
      </div>
      <div className={`avail${later ? " later" : ""}`}>
        <i />
        Availability: {item.availability}
      </div>
      {item.listing ? null : (
        <button type="button" className="btn" onClick={() => onChoose(item.id)}>
          Select Manufacturer
        </button>
      )}
    </article>
  );
}

function SkeletonCard() {
  return (
    <article className="mcard" aria-hidden="true">
      <div className="bone lg" />
      <div className="bone" />
      <div className="bone" />
      <div className="bone" />
    </article>
  );
}
