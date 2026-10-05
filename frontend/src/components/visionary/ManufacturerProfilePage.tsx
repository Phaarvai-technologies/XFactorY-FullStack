"use client";

import { useEffect, useState } from "react";
import { FlowHeader } from "@/components/visionary/FlowChrome";
import { ApiError } from "@/lib/api";
import type {
  PublicCertification,
  PublicMachine,
  PublicManufacturerProfile,
} from "@/lib/manufacturer/publicProfile";
import { useVisionaryApi } from "@/lib/visionary/api";
import type { VisionarySlide } from "@/lib/visionary/paths";
import { TIMELINE_LABELS, initials, type ManufacturingRequest } from "@/lib/visionary/storage";
import { latestVisionaryRequest } from "@/lib/visionary/store";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | { status: "ready"; profile: PublicManufacturerProfile; request: ManufacturingRequest };

function money(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function ManufacturerProfilePage({
  onContinue,
}: {
  onContinue: (slide: VisionarySlide) => void;
}) {
  // Manufacturer of the latest request: GET /visionary/manufacturers/{id} -> profile.
  const [request] = useState(latestVisionaryRequest);
  const [state, setState] = useState<LoadState>(() =>
    request?.manufacturer_id ? { status: "loading" } : { status: "missing" },
  );
  const visionaryApi = useVisionaryApi();

  function fetchProfile() {
    if (!request?.manufacturer_id) return;
    visionaryApi.manufacturer(request.manufacturer_id).then(
      ({ profile }) => setState({ status: "ready", profile, request }),
      (error: unknown) =>
        setState({ status: error instanceof ApiError && error.status === 404 ? "missing" : "error" }),
    );
  }

  function load() {
    setState({ status: "loading" });
    fetchProfile();
  }

  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="view active" id="v-mfd">
      <FlowHeader />
      <main>
        <button type="button" className="back" onClick={() => onContinue("project")}>
          ← Back to My Project
        </button>
        <h1>Manufacturer Profile</h1>
        <p className="lead">
          View the manufacturer details, capabilities and information shared for this request.
        </p>

        {state.status === "loading" ? <ProfileSkeleton /> : null}
        {state.status === "error" ? (
          <div className="empty">
            <h2>Unable to load manufacturer profile.</h2>
            <button type="button" className="btn btn-primary" onClick={load}>
              Try Again
            </button>
          </div>
        ) : null}
        {state.status === "missing" ? (
          <div className="empty">
            <h2>Manufacturer profile unavailable.</h2>
            <button type="button" className="btn btn-primary" onClick={() => onContinue("project")}>
              Back to Project
            </button>
          </div>
        ) : null}
        {state.status === "ready" ? (
          <ProfileBody profile={state.profile} request={state.request} onContinue={onContinue} />
        ) : null}
      </main>
    </div>
  );
}

function ProfileBody({
  profile,
  request,
  onContinue,
}: {
  profile: PublicManufacturerProfile;
  request: ManufacturingRequest;
  onContinue: (slide: VisionarySlide) => void;
}) {
  const companyRows = [
    ["Company Name", profile.name],
    ["Company Type", profile.companyType],
    ["Industry", profile.industry],
    ["Year Established", profile.established],
    ["Company Size", profile.companySize],
    ["Location", profile.location],
    ["Address", profile.address],
    ["Company Description", profile.about],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  const quantity = request.quantity?.value
    ? `${Number(request.quantity.value).toLocaleString("en-IN")} units`
    : "";
  const budget = request.budget?.amount ? money(request.budget.amount) : "";
  const timeline = TIMELINE_LABELS[request.timeline] || "";

  return (
    <div className="layout">
      <div className="main">
        <section className="card hero-card">
          <div className="who">
            {profile.logo ? (
              <img className="logo" src={profile.logo} alt="" />
            ) : (
              <span className="ini">{initials(profile.name)}</span>
            )}
            <div>
              <h2>{profile.name}</h2>
              {profile.location ? <p className="loc">{profile.location}</p> : null}
              {profile.industry ? <p className="industry">{profile.industry}</p> : null}
              {profile.verified ? <span className="verify">✓ Verified Manufacturer</span> : null}
            </div>
          </div>
          {profile.about ? <p className="about">{profile.about}</p> : null}
        </section>

        {companyRows.length > 0 ? (
          <section className="card">
            <h3>Company Details</h3>
            <dl className="rows">
              {companyRows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {profile.processes.length ||
        profile.products.length ||
        profile.industries.length ||
        profile.materials.length ? (
          <section className="card">
            <h3>Manufacturing Capabilities</h3>
            <CapabilityBlock title="Manufacturing Processes" items={profile.processes} />
            <CapabilityBlock title="Products manufactured" items={profile.products} />
            <CapabilityBlock title="Industries Served" items={profile.industries} />
            <CapabilityBlock title="Materials handled" items={profile.materials} />
          </section>
        ) : null}

        {profile.machines.length > 0 ? (
          <section className="card">
            <h3>Available Machinery</h3>
            <div className="machines">
              {profile.machines.map((machine, index) => (
                <MachineCard key={`${machine.name}-${index}`} machine={machine} />
              ))}
            </div>
          </section>
        ) : null}

        {profile.capacityText ? (
          <section className="card">
            <h3>Production Capacity</h3>
            <div className="stat">
              <small>Production capacity</small>
              <b>{profile.capacityText}</b>
            </div>
          </section>
        ) : null}

        {profile.availability || profile.availabilityNote ? (
          <section className="card">
            <h3>Machine & Production Availability</h3>
            {profile.availability ? (
              <p className={`status${/available/i.test(profile.availability) && !/contact/i.test(profile.availability) ? " on" : ""}`}>
                <i />
                {profile.availability}
              </p>
            ) : null}
            {profile.availabilityNote ? <p className="note">{profile.availabilityNote}</p> : null}
          </section>
        ) : null}

        {profile.certifications.length > 0 ? (
          <section className="card">
            <h3>Certifications & Verification</h3>
            <ul className="certs">
              {profile.certifications.map((item) => (
                <CertificationRow key={`${item.name}-${item.body}`} item={item} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <aside className="side">
        <section className="card">
          <h3>Request Context</h3>
          <dl className="rows">
            {request.project_name ? (
              <div>
                <dt>Project</dt>
                <dd>{request.project_name}</dd>
              </div>
            ) : null}
            {quantity ? (
              <div>
                <dt>Requested Quantity</dt>
                <dd>{quantity}</dd>
              </div>
            ) : null}
            {budget ? (
              <div>
                <dt>Budget</dt>
                <dd>{budget}</dd>
              </div>
            ) : null}
            {timeline ? (
              <div>
                <dt>Timeline</dt>
                <dd>{timeline}</dd>
              </div>
            ) : null}
          </dl>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => onContinue("project")}>
              Back to Project
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onContinue("submitted")}>
              View Manufacturing Request
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}

function CapabilityBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="cap-block">
      <h4>{title}</h4>
      <div className="chips">
        {items.map((item) => (
          <span className="chip" key={item}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function MachineCard({ machine }: { machine: PublicMachine }) {
  const facts = [
    ["Machine Type", machine.type],
    ["Capacity", machine.capacity],
    ["Quantity", machine.quantity],
    ["Availability", machine.availability],
    ["Specifications", machine.specifications],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <article className="machine">
      {machine.image ? <img src={machine.image} alt="" /> : <div className="ph">{initials(machine.name)}</div>}
      <h4>{machine.name}</h4>
      <dl>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function CertificationRow({ item }: { item: PublicCertification }) {
  const detail = [item.body, item.status].filter(Boolean).join(" · ");
  return (
    <li>
      <b>{item.name}</b>
      {detail ? <span>{detail}</span> : null}
    </li>
  );
}

function ProfileSkeleton() {
  return (
    <div className="layout" aria-hidden="true">
      <div className="main">
        <article className="card">
          <div className="bone lg" />
          <div className="bone" />
          <div className="bone" />
        </article>
        <article className="card">
          <div className="bone" />
          <div className="bone" />
        </article>
      </div>
      <aside className="side">
        <article className="card">
          <div className="bone" />
          <div className="bone" />
        </article>
      </aside>
    </div>
  );
}
