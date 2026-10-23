"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { FlowHeader } from "@/components/visionary/FlowChrome";
import { errorMessage, useVisionaryApi } from "@/lib/visionary/api";
import type { VisionarySlide } from "@/lib/visionary/paths";
import { TIMELINE_LABELS, digitsOnly, initials, type ManufacturingRequest } from "@/lib/visionary/storage";
import { getVisionaryData, type VisionaryData, type VisionaryProject } from "@/lib/visionary/store";

const STAGES = ["Idea Stage", "Design Stage", "Prototype Stage", "Ready for Manufacturing"];

const DURATION_LABELS: Record<string, string> = {
  "1_week": "1 week",
  "2_weeks": "2 weeks",
  "1_month": "1 month",
  "2_months": "2 months",
  "3_months": "3 months",
  "6_months": "6 months",
};

type EditFields = {
  project: string;
  idea: string;
  product: string;
  industry: string;
  stage: string;
  manufacturing_location: string;
  quantity: string;
  budget: string;
  timeline: string;
  additional_requirements: string;
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

function editFrom(project: VisionaryProject): EditFields {
  return {
    project: project.project,
    idea: project.idea,
    product: project.product,
    industry: project.industry,
    stage: project.stage,
    manufacturing_location: project.requirements?.manufacturing_location ?? "",
    quantity: project.requirements?.quantity?.value ? String(project.requirements.quantity.value) : "",
    budget: project.requirements?.budget?.amount ? String(project.requirements.budget.amount) : "",
    timeline: project.requirements?.timeline ?? "",
    additional_requirements: project.requirements?.additional_requirements ?? "",
  };
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

export function ProjectList({
  onContinue,
  onToast,
}: {
  onContinue: (slide: VisionarySlide) => void;
  onToast: (message: string) => void;
}) {
  const [projects, setProjects] = useState(projectCards);

  return (
    <div className="view active" id="v-pj">
      <FlowHeader />
      <main>
        <button type="button" className="back" onClick={() => onContinue("project")}>
          ← Back to My Project
        </button>
        <h1>View All Projects</h1>
        <p className="lead">Each project you added is here. Tap a card to see its details, or edit and save it.</p>
        {projects.length === 0 ? (
          <div className="empty">You have not added a project yet.</div>
        ) : (
          <div className="plist">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onToast={onToast}
                onSaved={(data) => setProjects(data.projects.length ? data.projects : projectCards())}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ProjectCard({
  project,
  onToast,
  onSaved,
}: {
  project: VisionaryProject;
  onToast: (message: string) => void;
  onSaved: (data: VisionaryData) => void;
}) {
  const visionaryApi = useVisionaryApi();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<EditFields>(() => editFrom(project));
  const needs = project.requirements;
  const title = project.project || "Untitled project";
  const subtitle = [project.industry, project.stage].filter(Boolean).join(" · ");

  function setField(key: keyof EditFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const name = fields.project.trim();
    if (!name) {
      onToast("Give the project a name.");
      return;
    }
    if (project.id === "current") {
      onToast("Save the project from Add Project before editing it here.");
      return;
    }
    setSaving(true);
    try {
      const data = await visionaryApi.updateProject(project.id, {
        project: name,
        idea: fields.idea.trim(),
        product: fields.product.trim(),
        industry: fields.industry.trim(),
        stage: fields.stage,
        manufacturing_location: fields.manufacturing_location.trim(),
        quantity: Number(digitsOnly(fields.quantity) || 0),
        budget: Number(digitsOnly(fields.budget) || 0),
        timeline: fields.timeline,
        additional_requirements: fields.additional_requirements.trim(),
      });
      onSaved(data);
      setEditing(false);
    } catch (error) {
      onToast(errorMessage(error, "Couldn’t save this project. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ExpandCard
      open={open}
      onToggle={() => setOpen((current) => !current)}
      mark={(title.charAt(0) || "P").toUpperCase()}
      title={title}
      subtitle={subtitle}
    >
      {editing ? (
        <form className="edit-form" onSubmit={save}>
          <div>
            <label htmlFor={`name-${project.id}`}>Project name</label>
            <input id={`name-${project.id}`} value={fields.project} onChange={(event) => setField("project", event.target.value)} />
          </div>
          <div>
            <label htmlFor={`idea-${project.id}`}>Idea</label>
            <textarea id={`idea-${project.id}`} value={fields.idea} maxLength={500} onChange={(event) => setField("idea", event.target.value)} />
          </div>
          <div>
            <label htmlFor={`product-${project.id}`}>Product</label>
            <input id={`product-${project.id}`} value={fields.product} onChange={(event) => setField("product", event.target.value)} />
          </div>
          <div>
            <label htmlFor={`industry-${project.id}`}>Industry</label>
            <input id={`industry-${project.id}`} value={fields.industry} onChange={(event) => setField("industry", event.target.value)} />
          </div>
          <div>
            <label htmlFor={`stage-${project.id}`}>Project stage</label>
            <select id={`stage-${project.id}`} value={fields.stage} onChange={(event) => setField("stage", event.target.value)}>
              <option value="">Select a stage</option>
              {STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`location-${project.id}`}>Location</label>
            <input id={`location-${project.id}`} value={fields.manufacturing_location} onChange={(event) => setField("manufacturing_location", event.target.value)} />
          </div>
          <div>
            <label htmlFor={`quantity-${project.id}`}>Quantity</label>
            <input id={`quantity-${project.id}`} inputMode="numeric" value={fields.quantity} onChange={(event) => setField("quantity", digitsOnly(event.target.value))} />
          </div>
          <div>
            <label htmlFor={`budget-${project.id}`}>Budget (₹)</label>
            <input id={`budget-${project.id}`} inputMode="numeric" value={fields.budget} onChange={(event) => setField("budget", digitsOnly(event.target.value))} />
          </div>
          <div>
            <label htmlFor={`timeline-${project.id}`}>Timeline</label>
            <select id={`timeline-${project.id}`} value={fields.timeline} onChange={(event) => setField("timeline", event.target.value)}>
              <option value="">Select a timeline</option>
              {Object.entries(TIMELINE_LABELS).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`needs-${project.id}`}>Other needs</label>
            <textarea id={`needs-${project.id}`} value={fields.additional_requirements} maxLength={500} onChange={(event) => setField("additional_requirements", event.target.value)} />
          </div>
          <div className="edit-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setFields(editFrom(project));
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
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
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setFields(editFrom(project));
              setEditing(true);
            }}
          >
            Edit
          </button>
        </>
      )}
    </ExpandCard>
  );
}

export function RequestList({
  onContinue,
  onToast,
}: {
  onContinue: (slide: VisionarySlide) => void;
  onToast: (message: string) => void;
}) {
  const [requests, setRequests] = useState(() => [...getVisionaryData().requests].reverse());

  return (
    <div className="view active" id="v-pj">
      <FlowHeader />
      <main>
        <button type="button" className="back" onClick={() => onContinue("project")}>
          ← Back to My Project
        </button>
        <h1>View All Requests</h1>
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
                onToast={onToast}
                onChanged={(data) => setRequests([...(data.requests ?? [])].reverse())}
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
  onToast,
  onChanged,
}: {
  request: ManufacturingRequest;
  onToast: (message: string) => void;
  onChanged: (data: VisionaryData) => void;
}) {
  const visionaryApi = useVisionaryApi();
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const project = request.project_name || "Untitled project";
  const manufacturer = request.manufacturer_name || "Manufacturer";
  const label = statusLabel(request.status);
  const canUndo = Boolean(request.id) && (label === "Request Sent" || label === "Edited");

  async function undo() {
    if (!request.id || cancelling) return;
    setCancelling(true);
    try {
      const data = await visionaryApi.cancelRequest(request.id);
      onChanged(data);
    } catch (error) {
      onToast(errorMessage(error, "Couldn’t undo this request. Please try again."));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <ExpandCard
      open={open}
      onToggle={() => setOpen((current) => !current)}
      mark={initials(manufacturer) || "M"}
      title={project}
      subtitle={`Sent to ${manufacturer}`}
      aside={label}
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
          ["Status", label],
        ]}
      />
      {canUndo ? (
        <div className="edit-actions">
          <button type="button" className="btn btn-ghost" onClick={undo} disabled={cancelling}>
            {cancelling ? "Undoing…" : "Undo request"}
          </button>
          <p className="hint">This cancels the request. The manufacturer is not told.</p>
        </div>
      ) : null}
    </ExpandCard>
  );
}
