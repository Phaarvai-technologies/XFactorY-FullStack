"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FlowHeader, Progress } from "@/components/visionary/FlowChrome";
import { IDEA_ICONS, ideaFrame, resolveIdeaIcon } from "@/lib/visionary/ideaVisual";
import { errorMessage, useVisionaryApi } from "@/lib/visionary/api";
import type { VisionarySlide } from "@/lib/visionary/paths";
import type { VisionaryIdea } from "@/lib/visionary/storage";
import { getVisionaryData } from "@/lib/visionary/store";

const EMPTY: VisionaryIdea = { project: "", idea: "", product: "", industry: "" };

const SECTORS = [
  "Food & Beverage",
  "Consumer Products",
  "Electronics",
  "Textiles & Apparel",
  "Automotive",
  "Packaging",
  "Furniture & Home",
  "Healthcare & Medical Devices",
  "Construction & Building Materials",
  "Agriculture & Agri-tech",
  "Machinery & Industrial Equipment",
  "Chemicals & Plastics",
  "Toys & Games",
  "Beauty & Personal Care",
  "Renewable Energy",
  "Aerospace & Defence",
  "Sports & Outdoor",
];

export function StepIdea({
  onContinue,
  onToast,
}: {
  onContinue: (slide: VisionarySlide) => void;
  onToast: (message: string) => void;
}) {
  const visionaryApi = useVisionaryApi();
  const [saving, setSaving] = useState(false);
  const [stored] = useState<Partial<VisionaryIdea>>(() => getVisionaryData().idea ?? {});
  const [idea, setIdea] = useState<VisionaryIdea>({
    ...EMPTY,
    ...stored,
    industry: stored.industry ?? "",
  });
  const [sector, setSector] = useState(() => {
    const parts = (stored.industry ?? "").split(" / ").map((part) => part.trim()).filter(Boolean);
    return parts[parts.length - 1] ?? "";
  });
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [shownIcon, setShownIcon] = useState(() =>
    resolveIdeaIcon({
      project: idea.project,
      product: idea.product,
      idea: idea.idea,
      sectors: sector ? [sector] : [],
    }),
  );
  const [swap, setSwap] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const industryValue = sector;
  const iconName = resolveIdeaIcon({
    project: idea.project,
    product: idea.product,
    idea: idea.idea,
    sectors: sector ? [sector] : [],
  });
  const markup = ideaFrame(IDEA_ICONS[shownIcon] ?? IDEA_ICONS.idea);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onPointerDown);
    return () => document.removeEventListener("click", onPointerDown);
  }, []);

  useEffect(() => {
    if (iconName === shownIcon) {
      setSwap(false);
      return;
    }
    setSwap(true);
    const timer = window.setTimeout(() => {
      setShownIcon(iconName);
      setSwap(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [iconName, shownIcon]);

  const options = useMemo(() => {
    const items = sector && !SECTORS.includes(sector) ? [...SECTORS, sector] : [...SECTORS];
    const q = query.trim().toLowerCase();
    return items.filter((item) => !q || item.toLowerCase().includes(q));
  }, [query, sector]);

  const canAdd =
    query.trim().length > 0 &&
    !SECTORS.some((item) => item.toLowerCase() === query.trim().toLowerCase()) &&
    sector.toLowerCase() !== query.trim().toLowerCase();

  function chooseSector(value: string) {
    setSector(value);
    setErrors((current) => ({ ...current, industry: false }));
    setOpen(false);
    setQuery("");
  }

  function update(key: keyof VisionaryIdea, value: string) {
    setIdea((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: false }));
  }

  function payload(): VisionaryIdea {
    return {
      project: idea.project.trim(),
      idea: idea.idea.trim(),
      product: idea.product.trim(),
      industry: industryValue.trim(),
    };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const data = payload();
    const nextErrors = {
      project: !data.project,
      idea: !data.idea,
      product: !data.product,
      industry: !data.industry,
    };
    setErrors(nextErrors);
    const first = (["project", "idea", "product", "industry"] as const).find((key) => nextErrors[key]);
    if (first) {
      document.getElementById(first === "industry" ? "msBtn" : first)?.focus();
      return;
    }
    setSaving(true);
    try {
      await visionaryApi.saveIdea(data, true); // PUT /visionary/project/idea
      onContinue("step3");
    } catch (error) {
      onToast(errorMessage(error, "Couldn’t save your idea. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  const caption = idea.product.trim() || idea.project.trim() || "Your idea takes shape here";

  return (
    <div className="view active" id="v-s2">
      <FlowHeader />
      <main>
        <section className="side">
          <h1>What is the idea you want to bring to life?</h1>
          <p>
            Tell us about your idea in simple words. You do not need to know the technical
            manufacturing details yet.
          </p>
          <div className="illus" aria-hidden="true">
            <div
              className={`stage${swap ? " swap" : ""}`}
              dangerouslySetInnerHTML={{ __html: markup }}
            />
            <p className="cap">{caption}</p>
          </div>
        </section>
        <section>
          <Progress label="Your idea" step={2} />
          <form className="card" noValidate onSubmit={submit}>
            <div className={`field${errors.project ? " error" : ""}`}>
              <label htmlFor="project">Project / Product name</label>
              <p className="hint">A working title is fine. You can change it later.</p>
              <input
                id="project"
                placeholder="e.g. Customized Coffee Cups"
                required
                value={idea.project}
                onChange={(event) => update("project", event.target.value)}
              />
              <p className="err">Please give your project a name.</p>
            </div>
            <div className={`field${errors.idea ? " error" : ""}`}>
              <label htmlFor="idea">Describe your idea</label>
              <p className="hint">Who is it for, and what problem or need does it meet?</p>
              <textarea
                id="idea"
                maxLength={500}
                placeholder="e.g. I want to manufacture customized coffee cups for cafés and businesses."
                required
                value={idea.idea}
                onChange={(event) => update("idea", event.target.value)}
              />
              <div className="count">
                <span>{idea.idea.length}</span>/500
              </div>
              <p className="err">Please describe your idea in a sentence or two.</p>
            </div>
            <div className="row">
              <div className={`field${errors.product ? " error" : ""}`}>
                <label htmlFor="product">What do you want to manufacture?</label>
                <p className="hint">The product itself, in a few words.</p>
                <input
                  id="product"
                  placeholder="e.g. Printed paper coffee cups"
                  required
                  value={idea.product}
                  onChange={(event) => update("product", event.target.value)}
                />
                <p className="err">Tell us what you want to manufacture.</p>
              </div>
              <div className={`field${errors.industry ? " error" : ""}`} ref={panelRef}>
                <label htmlFor="msBtn">Industry / Sector</label>
                <p className="hint">Select one sector.</p>
                <div className={`ms${open ? " open" : ""}`}>
                  <button
                    type="button"
                    className="ms-btn"
                    id="msBtn"
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    onClick={() => {
                      setOpen((current) => !current);
                      setQuery("");
                    }}
                  >
                    <span className="ms-tags">
                      {sector ? sector : <span className="ph">Select industry / sector</span>}
                    </span>
                    <svg className="chev" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path d="M5 7.5l5 5 5-5" stroke="#1d5fe0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <div className="ms-panel" hidden={!open}>
                    <input
                      type="text"
                      className="ms-search"
                      placeholder="Search sectors"
                      autoComplete="off"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setOpen(false);
                          document.getElementById("msBtn")?.focus();
                        }
                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (canAdd) chooseSector(query.trim());
                          else if (options[0]) chooseSector(options[0]);
                        }
                      }}
                    />
                    {options.length === 0 && !canAdd ? (
                      <div className="ms-empty">No sectors found.</div>
                    ) : (
                      <ul className="ms-list" role="radiogroup" aria-label="Industry / Sector">
                        {options.map((value) => (
                          <li key={value} className={sector === value ? "sel" : undefined}>
                            <label>
                              <input
                                type="radio"
                                name="sector"
                                value={value}
                                checked={sector === value}
                                onChange={() => chooseSector(value)}
                              />
                              {value}
                            </label>
                          </li>
                        ))}
                        {canAdd ? (
                          <li className="add">
                            <label>
                              <input
                                type="radio"
                                name="sector"
                                value={query.trim()}
                                checked={false}
                                onChange={() => chooseSector(query.trim())}
                              />
                              Add “{query.trim()}”
                            </label>
                          </li>
                        ) : null}
                      </ul>
                    )}
                  </div>
                </div>
                <p className="err">Please choose or enter an industry.</p>
              </div>
            </div>
            <div className="actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  // "Previous" keeps whatever was typed (not validated), as before.
                  void visionaryApi.saveIdea(payload(), false).catch(() => undefined);
                  onContinue("step1");
                }}
              >
                Previous
              </button>
              <button type="submit" className="btn btn-primary" aria-busy={saving}>
                Save &amp; Next
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
