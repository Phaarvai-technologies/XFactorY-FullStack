"use client";

import { FlowHeader } from "@/components/visionary/FlowChrome";
import type { VisionarySlide } from "@/lib/visionary/paths";
import { TIMELINE_LABELS, initials } from "@/lib/visionary/storage";
import { getVisionaryData, latestVisionaryRequest } from "@/lib/visionary/store";

/** Request status as the Visionary sees it ("submitted" = just sent). */
function statusLabel(status: string | undefined): string {
  return status && status !== "submitted" ? status : "Request Sent";
}

export function RequestSubmitted({ onContinue }: { onContinue: (slide: VisionarySlide) => void }) {
  // Latest request, from the database (loaded by VisionaryFlow / returned when sent).
  const request = latestVisionaryRequest();

  const rows = request
    ? [
        ["Request ID", request.request_id],
        ["Visionary", request.visionary],
        ["Project", request.project_name],
        ["Manufacturer", request.manufacturer_name],
        ["Location", request.manufacturing_location],
        [
          "Quantity",
          request.quantity?.value
            ? `${Number(request.quantity.value).toLocaleString("en-IN")} units`
            : "",
        ],
        ["Timeline", TIMELINE_LABELS[request.timeline] || ""],
        ["Status", statusLabel(request.status)],
      ]
    : [];

  const lead =
    request?.manufacturer_name && request.project_name
      ? `${request.manufacturer_name} has received your request for ${request.project_name}.`
      : "Your request has been sent to the manufacturer.";

  return (
    <div className="view active" id="v-sub">
      <FlowHeader />
      <main>
        <section className="sub-hero">
          <div className="ok">
            <i>
              <svg width="30" height="30" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M3 8.5l3.2 3.2L13 4.8"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </i>
          </div>
          <h1>Your Manufacturing Request Has Been Sent</h1>
          <p className="lead">{lead}</p>
        </section>
        <section className="card" aria-labelledby="sb-sumh">
          <h2 id="sb-sumh">Request summary</h2>
          <dl className="sum">
            {rows.map(([label, value]) =>
              value ? (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{label === "Status" ? <span className="badge">{value}</span> : value}</dd>
                </div>
              ) : null,
            )}
          </dl>
        </section>
        <section className="card" aria-labelledby="sb-nexth">
          <h2 id="sb-nexth">What happens next?</h2>
          <ol className="steps">
            <li>
              <b>1</b>Manufacturer reviews your request
            </li>
            <li>
              <b>2</b>Manufacturer responds with availability/details
            </li>
            <li>
              <b>3</b>You can continue the conversation
            </li>
          </ol>
        </section>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => onContinue("project")}>
            View My Project
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onContinue("results")}>
            Explore More Manufacturers
          </button>
        </div>
      </main>
    </div>
  );
}

export function MyProject({
  onContinue,
  onToast,
}: {
  onContinue: (slide: VisionarySlide) => void;
  onToast: (message: string) => void;
}) {
  // Project and latest request from the database. Before any request is sent, the project's
  // own requirements are shown (this replaces the former sample data).
  const { idea, requirements, stage } = getVisionaryData();
  const sent = latestVisionaryRequest();
  const request = sent ?? {
    manufacturer_name: "",
    project_name: idea?.project ?? "",
    manufacturing_location: requirements?.manufacturing_location ?? "",
    quantity: requirements?.quantity,
    budget: requirements?.budget,
    timeline: requirements?.timeline ?? "",
    created_at: "",
    status: "",
  };

  const projectName = request.project_name || idea?.project || "";
  const created = request.created_at ? new Date(request.created_at) : null;
  const dateLabel =
    created && !Number.isNaN(created.getTime())
      ? created.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : "";

  const tiles = [
    ["Industry", idea?.industry],
    ["Location", request.manufacturing_location],
    [
      "Quantity",
      request.quantity?.value ? `${Number(request.quantity.value).toLocaleString("en-IN")} units` : "",
    ],
    ["Budget", request.budget?.amount ? `₹${Number(request.budget.amount).toLocaleString("en-IN")}` : ""],
    ["Timeline", TIMELINE_LABELS[request.timeline] || ""],
    ["Project Stage", stage || "Finding a manufacturer"],
  ];

  return (
    <div className="view active" id="v-pj">
      <FlowHeader />
      <main>
        <div className="top">
          <h1>My Project</h1>
        </div>
        <section className="pj-hero card" aria-label="Project">
          <div className="row">
            <span className="ic">{(projectName || "P").charAt(0).toUpperCase()}</span>
            <div>
              <small>Project</small>
              <h2>{projectName}</h2>
            </div>
            <span className="pill">{sent ? "Manufacturing Request Sent" : "No Request Sent Yet"}</span>
          </div>
          <div className="track" aria-label="Progress">
            <div className={sent ? "step done" : "step"}>Request sent</div>
            <div className="step">Manufacturer reviews</div>
            <div className="step">Manufacturer responds</div>
          </div>
        </section>
        <div className="grid">
          <section className="card" aria-labelledby="pj-dh">
            <h3 id="pj-dh">Project Details</h3>
            <div className="tiles">
              {tiles.map(([label, value]) =>
                value ? (
                  <div className="tile" key={label}>
                    <small>{label}</small>
                    <b>{value}</b>
                  </div>
                ) : null,
              )}
            </div>
          </section>
          <section className="card" aria-labelledby="pj-rh">
            <h3 id="pj-rh">Manufacturer Requests</h3>
            {sent ? (
              <>
                <div className="mreq">
                  <span className="av">{initials(sent.manufacturer_name || "M")}</span>
                  <div>
                    <b>{sent.manufacturer_name}</b>
                    <small>{dateLabel}</small>
                  </div>
                </div>
                <span className="badge">{statusLabel(sent.status)}</span>
              </>
            ) : (
              <div className="mreq">
                <span className="av">—</span>
                <div>
                  <b>No requests yet</b>
                  <small>Find a manufacturer to send your first request.</small>
                </div>
              </div>
            )}
          </section>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => onToast("Coming soon.")}>
            View Project
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onContinue("manufacturer")}>
            View Manufacturer
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onContinue("submitted")}>
            View Request
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onToast("Coming soon.")}>
            Edit Project
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onContinue("results")}>
            Explore Manufacturers
          </button>
        </div>
      </main>
    </div>
  );
}
