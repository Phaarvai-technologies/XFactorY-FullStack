import { SAMPLE_NEED_ID } from "@/lib/needs/paths";
import type { NeedRequirementDraft, NeedType } from "@/lib/needs/types";
import { VISIONARY_SAMPLE_PROJECT_ID } from "@/lib/projects/paths";
import { getProjectById } from "@/lib/projects/sampleData";

function manufacturingDraft(projectId: string): NeedRequirementDraft {
  const project = getProjectById(projectId);
  return {
    id: SAMPLE_NEED_ID,
    title: "Enclosure molding partner",
    needType: "manufacturing",
    requesterName: project.ownership.ownerName,
    projectId: project.id,
    projectTitle: project.title,
    confidentiality: "NDA required · Redacted externally",
    version: 2,
    previousVersion: 1,
    draftStatus: "incomplete",
    lastUpdated: "2026-09-22T10:30:00",
    canEdit: true,
    pendingChangeSummary: "",
    versions: [
      {
        version: 1,
        savedAt: "2026-09-18T16:00:00",
        changeReason: "Initial AI-assisted draft from project description.",
        author: project.ownership.ownerName,
        itemCount: 8,
        requiredCount: 4,
        preferredCount: 2,
        unknownCount: 1,
        naCount: 1,
        changeSummary: "Created first structured requirement set.",
      },
      {
        version: 2,
        savedAt: "2026-09-20T11:15:00",
        changeReason: "Confirmed volume and process from collaboration notes.",
        author: project.ownership.ownerName,
        itemCount: 10,
        requiredCount: 5,
        preferredCount: 3,
        unknownCount: 1,
        naCount: 1,
        changeSummary: "Added volume range and preferred certification.",
      },
    ],
    items: [
      {
        id: "ri-1",
        categoryId: "product",
        categoryLabel: "Product / Component",
        name: "Product type",
        value: "Compact climate device enclosure (housing)",
        classification: "required",
        status: "confirmed",
        source: {
          kind: "project",
          label: "Project description — summary",
        },
        notes: "",
      },
      {
        id: "ri-2",
        categoryId: "process",
        categoryLabel: "Process",
        name: "Manufacturing process",
        value: "Injection molding",
        classification: "required",
        status: "edited",
        source: {
          kind: "ai",
          label: "AI suggestion — Project description",
        },
        notes: "Edited after collaboration with manufacturing advisor.",
      },
      {
        id: "ri-3",
        categoryId: "material",
        categoryLabel: "Material",
        name: "Material type",
        value: "ABS / PC blend, Class-A cosmetic finish",
        classification: "required",
        status: "confirmed",
        source: {
          kind: "ai",
          label: "AI suggestion — Linked need summary",
        },
        notes: "",
      },
      {
        id: "ri-4",
        categoryId: "machinery",
        categoryLabel: "Machinery",
        name: "Machine capability",
        value: "",
        classification: "unknown",
        status: "missing",
        source: {
          kind: "ai",
          label: "AI suggestion — clarifying question",
        },
        notes: "Need tonnage / shot size guidance from partner.",
      },
      {
        id: "ri-5",
        categoryId: "volume",
        categoryLabel: "Volume",
        name: "Initial production volume",
        value: "2,500 – 5,000 units (first run)",
        classification: "required",
        status: "confirmed",
        source: {
          kind: "project",
          label: "Manufacturing readiness — Expected volume",
        },
        notes: "",
      },
      {
        id: "ri-6",
        categoryId: "volume",
        categoryLabel: "Volume",
        name: "Monthly volume",
        value: "5,000 units / month",
        classification: "preferred",
        status: "conflict",
        source: {
          kind: "ai",
          label: "AI suggestion — Project description — paragraph 3",
        },
        notes: "Conflicts with alternate monthly estimate below.",
        conflictWithId: "ri-7",
      },
      {
        id: "ri-7",
        categoryId: "volume",
        categoryLabel: "Volume",
        name: "Monthly volume (alternate estimate)",
        value: "10,000 units / month",
        classification: "preferred",
        status: "conflict",
        source: {
          kind: "document",
          label: "Uploaded document — page 4",
        },
        notes: "Conflicts with 5,000 units / month estimate.",
        conflictWithId: "ri-6",
      },
      {
        id: "ri-8",
        categoryId: "dimensions",
        categoryLabel: "Dimensions / Tolerance",
        name: "Cosmetic tolerance",
        value: "Tight Class-A surface finish; gate location review required",
        classification: "required",
        status: "confirmed",
        source: {
          kind: "ai",
          label: "AI suggestion — Collaboration Q&A",
        },
        notes: "",
      },
      {
        id: "ri-9",
        categoryId: "certifications",
        categoryLabel: "Certifications",
        name: "Preferred certifications",
        value: "ISO 9001; BIS / safety support preferred",
        classification: "preferred",
        status: "confirmed",
        source: {
          kind: "project",
          label: "Manufacturing readiness — Known constraints",
        },
        notes: "",
      },
      {
        id: "ri-10",
        categoryId: "geography",
        categoryLabel: "Geography",
        name: "Preferred manufacturing region",
        value: "India · Southeast Asia",
        classification: "preferred",
        status: "confirmed",
        source: {
          kind: "project",
          label: "Project profile — Target geography",
        },
        notes: "",
      },
      {
        id: "ri-11",
        categoryId: "timing",
        categoryLabel: "Timing",
        name: "Manufacturing timeline",
        value: "Tooling Q3 · Pilot run Q4",
        classification: "required",
        status: "confirmed",
        source: {
          kind: "project",
          label: "Manufacturing readiness — Timeline",
        },
        notes: "",
      },
      {
        id: "ri-12",
        categoryId: "confidentiality",
        categoryLabel: "Confidentiality",
        name: "Information sharing",
        value: "NDA required before CAD / BOM share",
        classification: "required",
        status: "confirmed",
        source: {
          kind: "manual",
          label: "Manually added",
        },
        notes: "",
      },
      {
        id: "ri-13",
        categoryId: "supporting",
        categoryLabel: "Supporting Services",
        name: "Secondary polishing",
        value: "Not preferred if mold quality is sufficient",
        classification: "not_applicable",
        status: "confirmed",
        source: {
          kind: "ai",
          label: "AI suggestion — Collaboration discussion",
        },
        notes: "Marked N/A pending mold polish grade decision.",
      },
    ],
  };
}

function supportingDraft(projectId: string, needType: NeedType): NeedRequirementDraft {
  const project = getProjectById(projectId);
  return {
    id: `${SAMPLE_NEED_ID}-${needType}`,
    title:
      needType === "logistics"
        ? "Domestic logistics for pilot kits"
        : "Supporting ecosystem need",
    needType,
    requesterName: project.ownership.ownerName,
    projectId: project.id,
    projectTitle: project.title,
    confidentiality: "Private · Invite-only details",
    version: 1,
    previousVersion: null,
    draftStatus: "incomplete",
    lastUpdated: "2026-09-22T09:00:00",
    canEdit: true,
    pendingChangeSummary: "",
    versions: [],
    items: [
      {
        id: "si-1",
        categoryId: needType === "logistics" ? "pickup" : "material_type",
        categoryLabel: needType === "logistics" ? "Pickup location" : "Material type",
        name: needType === "logistics" ? "Pickup city" : "Requirement",
        value: needType === "logistics" ? "Bengaluru" : "",
        classification: needType === "logistics" ? "required" : "unknown",
        status: needType === "logistics" ? "confirmed" : "missing",
        source: {
          kind: "ai",
          label: "AI suggestion — Supporting request",
        },
        notes: "",
      },
      {
        id: "si-2",
        categoryId: "timing",
        categoryLabel: "Timing",
        name: "Delivery window",
        value: "Within 10 business days of pilot kits",
        classification: "preferred",
        status: "suggested",
        source: {
          kind: "ai",
          label: "AI suggestion — Project timeline",
        },
        notes: "",
      },
      {
        id: "si-3",
        categoryId: "confidentiality",
        categoryLabel: "Confidentiality",
        name: "Information sharing",
        value: "Private collaboration only",
        classification: "required",
        status: "confirmed",
        source: {
          kind: "manual",
          label: "Manually added",
        },
        notes: "",
      },
    ],
  };
}

export function getNeedDraftById(
  needId: string,
  options?: { projectId?: string; needType?: NeedType; permissionRevoked?: boolean },
): NeedRequirementDraft {
  const projectId = options?.projectId ?? VISIONARY_SAMPLE_PROJECT_ID;
  const needType = options?.needType ?? "manufacturing";

  const base =
    needType === "manufacturing"
      ? manufacturingDraft(projectId)
      : supportingDraft(projectId, needType);

  return {
    ...base,
    id: needId || base.id,
    projectId,
    projectTitle: getProjectById(projectId).title,
    canEdit: options?.permissionRevoked ? false : base.canEdit,
    items: base.items.map((item) => ({ ...item })),
    versions: base.versions.map((version) => ({ ...version })),
  };
}

/** AI structuring suggestions shown before the editor (not auto-confirmed). */
export function getAiSuggestionsForNeed(needId: string) {
  const draft = getNeedDraftById(needId);
  return draft.items
    .filter((item) => item.source.kind === "ai" || item.status === "suggested")
    .map((item) => ({
      id: item.id,
      name: item.name,
      value: item.value || "(no value yet)",
      category: item.categoryLabel,
      source: item.source.label,
      accepted: false,
    }));
}
