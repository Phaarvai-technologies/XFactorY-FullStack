"use client";

import { useState, type ReactNode } from "react";
import { FlowHeader } from "@/components/visionary/FlowChrome";
import type { VisionarySlide } from "@/lib/visionary/paths";
import { TIMELINE_LABELS, initials, type ManufacturingRequest } from "@/lib/visionary/storage";
import { getVisionaryData, type VisionaryProject } from "@/lib/visionary/store";

const DURATION_LABELS: Record<string, string> = {
  "1_week": "1 week",
  "2_weeks": "2 weeks",
  "1_month": "1 month",
  "2_months": "2 months",
  "3_months": "3 months",
  "6_months": "6 months",
};

function statusLabel(status: string | undefined): string {
  return status && status !== "submitted" ? status : "Request Sent";
}

function money(amount: number | undefined): string {
  return amount ? `₹${Number(amount).toLocaleString("en-IN")}` : "";
}

function units(value: number | undefined): string {
  return value ? `${Number(value).toLocaleString("en-IN")} units` : "";
}

function when(value: string | undefined): string {
  if (!value) return "";
  const created = new Date(value);
  if (Number.isNaN(created.getTime())) return "";
  return created.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function projectCards(): VisionaryProject[] {
  const data = getVisionaryData();
  if (data.projects.length) return data.projects;
  if (!data.idea?.project && !data.idea?.idea && !data.idea?.product) return [];
  return [
    {
      id: "current",
      project: data.idea?.project ?? "",
      idea: data.idea?.idea ?? "",
      product: data.idea?.product ?? "",
      industry: data.idea?.industry ?? "",
      stage: data.stage,
      requirements: data.requirements,
      created_at: "",
    },
  ];
}

function DetailGrid({ rows }: { rows: Array<[string, string]> }) {
  const visible = rows.filter(([, value]) => value);
  if (!visible.length) return null;
  return (
    <div className="tiles">
      {visible.map(([label, value]) => (
        <div className="tile" key={label}>
          <small>{label}</small>
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

function ExpandCard({
  open,
  onToggle,
  mark,
  title,
  subtitle,
  aside,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  mark: string;
  title: string;
  subtitle: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <article className={`card pcard${open ? " open" : ""}`}>
      <button type="button" className="head" aria-expanded={open} onClick={onToggle}>
        <span className="av" aria-hidden="true">
          {mark}
        </span>
        <span className="grow">
          <b>{title}</b>
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
        {aside ? <span className="badge">{aside}</span> : null}
        <span className="chev" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? <div className="body">{children}</div> : null}
    </article>
  );
}

export function ProjectList({ onContinue }: { onContinue: (slide: VisionarySlide) => void }) {
  const projects = projectCards();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="view active" id="v-pj">
      <FlowHeader />
      <main>
        <button type="button" className="back" onClick={() => onContinue("project")}>
          ← Back to My Project
        </button>
        <h1>Your Projects</h1>
        <p className="lead">Each project you added is here. Tap a card to see its details.</p>
        {projects.length === 0 ? (
          <div className="empty">You have not added a project yet.</div>
        ) : (
          <div className="plist">
            {projects.map((project) => {
              const needs = project.requirements;
              const title = project.project || "Untitled project";
              const subtitle = [project.industry, project.stage].filter(Boolean).join(" · ");
              return (
                <ExpandCard
                  key={project.id}
                  open={openId === project.id}
                  onToggle={() => setOpenId((current) => (current === project.id ? null : project.id))}
                  mark={(title.charAt(0) || "P").toUpperCase()}
                  title={title}
                  subtitle={subtitle}
                >
                  {project.idea ? <p className="idea">{project.idea}</p> : null}
                  <DetailGrid
                    rows={[
                      ["Product", project.product],
                      ["Industry", project.industry],
                      ["Project stage", project.stage],
                      ["Location", needs?.manufacturing_location ?? ""],
                      ["Quantity", units(needs?.quantity?.value)],
                      ["Budget", money(needs?.budget?.amount)],
                      ["Timeline", TIMELINE_LABELS[needs?.timeline ?? ""] || ""],
                      ["Machines", (needs?.machines ?? []).filter(Boolean).join(", ")],
                      ["Other needs", needs?.additional_requirements ?? ""],
                      ["Added", when(project.created_at)],
                    ]}
                  />
                </ExpandCard>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

export function RequestList({ onContinue }: { onContinue: (slide: VisionarySlide) => void }) {
  const requests = [...getVisionaryData().requests].reverse();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="view active" id="v-pj">
      <FlowHeader />
      <main>
        <button type="button" className="back" onClick={() => onContinue("project")}>
          ← Back to My Project
        </button>
        <h1>Your Requests</h1>
        <p className="lead">
          Every manufacturing request you sent, with the project and the manufacturer it went to. Tap a
          card to see the details.
        </p>
        {requests.length === 0 ? (
          <div className="empty">You have not sent a manufacturing request yet.</div>
        ) : (
          <div className="plist">
            {requests.map((request, index) => (
              <RequestCard
                key={request.id || request.request_id || String(index)}
                request={request}
                open={openId === (request.id || request.request_id || String(index))}
                onToggle={() => {
                  const id = request.id || request.request_id || String(index);
                  setOpenId((current) => (current === id ? null : id));
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function RequestCard({
  request,
  open,
  onToggle,
}: {
  request: ManufacturingRequest;
  open: boolean;
  onToggle: () => void;
}) {
  const project = request.project_name || "Untitled project";
  const manufacturer = request.manufacturer_name || "Manufacturer";
  return (
    <ExpandCard
      open={open}
      onToggle={onToggle}
      mark={initials(manufacturer) || "M"}
      title={project}
      subtitle={`Sent to ${manufacturer}`}
      aside={statusLabel(request.status)}
    >
      <DetailGrid
        rows={[
          ["Project", project],
          ["Manufacturer", manufacturer],
          ["Request ID", request.request_id ?? ""],
          ["Sent", when(request.created_at)],
          ["Visionary", request.visionary],
          ["Machine", request.machine],
          ["Quantity", units(request.quantity?.value)],
          ["Duration", DURATION_LABELS[request.required_duration] || request.required_duration],
          ["Location", request.manufacturing_location],
          ["Budget", money(request.budget?.amount)],
          ["Timeline", TIMELINE_LABELS[request.timeline] || ""],
          ["Other needs", request.additional_requirements],
          ["Status", statusLabel(request.status)],
        ]}
      />
    </ExpandCard>
  );
}
