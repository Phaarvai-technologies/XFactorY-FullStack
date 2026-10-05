"use client";

import { useEffect, useRef, useState } from "react";
import { FlowHeader } from "@/components/visionary/FlowChrome";
import { useVisionaryApi } from "@/lib/visionary/api";
import type { VisionarySlide } from "@/lib/visionary/paths";
import {
  TIMELINE_LABELS,
  initials,
  type ManufacturerRecord,
} from "@/lib/visionary/storage";
import { getVisionaryData } from "@/lib/visionary/store";

function inRange(value: number, range: string): boolean {
  if (!range) return true;
  const [lowRaw, highRaw] = range.split("-");
  const low = lowRaw ? Number(lowRaw) : 0;
  const high = highRaw ? Number(highRaw) : Infinity;
  return (value > low && value <= high) || (low === 0 && value <= high);
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
  const [manufacturers, setManufacturers] = useState<ManufacturerRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [capacity, setCapacity] = useState("");
  const seededLocation = useRef(false);
  const requirements = getVisionaryData().requirements;
  const visionaryApi = useVisionaryApi();

  /** GET /visionary/manufacturers: manufacturers with a saved profile (from the database). */
  function load() {
    setStatus("loading");
    fetchManufacturers();
  }

  function fetchManufacturers() {
    visionaryApi.manufacturers().then(
      (next) => {
        setManufacturers(next);
        if (!seededLocation.current) {
          seededLocation.current = true;
          const wanted = (requirements?.manufacturing_location || "").trim().toLowerCase();
          const match =
            next.find((item) => {
              const place = item.location.toLowerCase();
              return place === wanted || place.startsWith(`${wanted},`);
            })?.location ?? "";
          if (match) setLocation(match);
        }
        setStatus("ready");
      },
      () => {
        setManufacturers([]);
        setStatus("error");
      },
    );
  }

  useEffect(() => {
    fetchManufacturers(); // status starts as "loading"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const locations = [...new Set(manufacturers.map((item) => item.location).filter(Boolean))].sort();
  const categories = [...new Set(manufacturers.map((item) => item.category).filter(Boolean))].sort();

  const chips: string[] = [];
  if (requirements?.manufacturing_location) chips.push(requirements.manufacturing_location);
  if (requirements?.quantity?.value) {
    chips.push(`${requirements.quantity.value.toLocaleString("en-IN")} units`);
  }
  if (requirements?.budget?.amount) {
    chips.push(`₹${requirements.budget.amount.toLocaleString("en-IN")}`);
  }
  if (requirements?.timeline && TIMELINE_LABELS[requirements.timeline]) {
    chips.push(TIMELINE_LABELS[requirements.timeline]);
  }

  const visible = manufacturers.filter((item) => {
    const text = query.trim().toLowerCase();
    if (text) {
      const haystack = [
        item.name,
        item.location,
        item.category,
        item.capabilities,
        item.about,
        ...item.machines,
        ...item.products,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    if (location && item.location !== location) return false;
    if (category && item.category !== category) return false;
    return inRange(item.capacity, capacity);
  });

  const filtersActive = Boolean(query.trim() || location || category || capacity);

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

        {profileId ? null : (
        <section className="filters" aria-label="Filters">
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
          <div className="f">
            <label htmlFor="mf-loc">Location</label>
            <select id="mf-loc" value={location} onChange={(event) => setLocation(event.target.value)}>
              <option value="">All locations</option>
              {locations.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="f">
            <label htmlFor="mf-cat">Industry / Category</label>
            <select id="mf-cat" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="f">
            <label htmlFor="mf-cap">Capacity</label>
            <select id="mf-cap" value={capacity} onChange={(event) => setCapacity(event.target.value)}>
              <option value="">Any capacity</option>
              <option value="0-2500">Up to 2,500 units/month</option>
              <option value="2500-5000">2,500 – 5,000 units/month</option>
              <option value="5000-10000">5,000 – 10,000 units/month</option>
              <option value="10000-">10,000+ units/month</option>
            </select>
          </div>
        </section>
        )}

        {profileId || status !== "ready" ? null : (
        <div className="bar">
          <span aria-live="polite">
            <strong>{visible.length}</strong> manufacturer{visible.length === 1 ? "" : "s"}
          </span>
          {filtersActive ? (
            <button
              type="button"
              className="link"
              onClick={() => {
                setQuery("");
                setLocation("");
                setCategory("");
                setCapacity("");
                document.getElementById("mf-q")?.focus();
              }}
            >
              Clear filters
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
              {manufacturers.length === 0 ? (
                <>
                  <h3>No manufacturers available yet</h3>
                  <p>Manufacturers will appear here as soon as they create their profiles.</p>
                </>
              ) : (
                <>
                  <h3>No matching manufacturers</h3>
                  <p>Try changing your search or filters.</p>
                </>
              )}
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
      onClick={() => onSelect(item.id)}
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
      <button type="button" className="btn" onClick={() => onChoose(item.id)}>
        Select Manufacturer
      </button>
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
