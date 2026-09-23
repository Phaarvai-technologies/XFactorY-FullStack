import type { ProjectProfile } from "@/lib/projects/types";
import { VISIONARY_SAMPLE_PROJECT_ID } from "@/lib/projects/paths";

const SAMPLE_PROJECT: ProjectProfile = {
  id: VISIONARY_SAMPLE_PROJECT_ID,
  title: "Aurora Compact",
  summary:
    "A modular home climate device designed for dense urban housing — quieter, smaller, and easier to service than conventional units.",
  stage: "Prototype",
  industry: "Consumer Hardware",
  targetGeography: "India · Southeast Asia",
  status: "active",
  visibility: "redacted_published",
  confidentiality: "redacted",
  publicDescription:
    "Aurora Compact is a next-generation compact climate product for apartments and small commercial spaces. The external profile shares category, stage, and manufacturing intent without revealing proprietary designs.",
  redactedOverview:
    "Visible externally: product category, target geography, manufacturing readiness signals, and engagement pathways. Proprietary CAD, BOM details, firmware architecture, and supplier pricing remain private.",
  mediaLabel: "Visibility-safe product silhouette",
  mediaCaption:
    "Public-safe media only — detailed industrial design and technical drawings stay confidential.",
  manufacturing: {
    prototypeStatus: "prototype",
    expectedVolume: "2,500 – 5,000 units (first production run)",
    timeline: "Tooling Q3 · Pilot run Q4 · Scale early next year",
    constraints: [
      "Injection-molded enclosure with tight cosmetic tolerances",
      "Low-noise motor assembly and vibration isolation",
      "BIS / safety certification support preferred",
      "Local component sourcing where feasible",
    ],
  },
  linkedNeeds: [
    {
      id: "need-1",
      title: "Enclosure molding partner",
      summary: "Seeking a manufacturer for ABS/PC housing with Class-A surface finish.",
      status: "open",
    },
    {
      id: "need-2",
      title: "PCB assembly (SMT)",
      summary: "Small-batch SMT with functional test fixtures for pilot volumes.",
      status: "in_progress",
    },
  ],
  shortlist: [
    {
      id: "short-1",
      title: "Precision Form Plastics",
      summary: "Injection molding · cosmetic housings · ISO 9001",
      status: "open",
    },
  ],
  engagements: [
    {
      id: "eng-1",
      title: "Capability review — Precision Form",
      summary: "Intro call completed. Awaiting NDA-backed drawing package.",
      status: "in_progress",
    },
  ],
  supportingRequests: [
    {
      id: "sup-1",
      title: "Domestic logistics for pilot kits",
      summary: "Need last-mile distribution for sample units across three cities.",
      status: "open",
    },
  ],
  ownership: {
    ownerName: "Asha Raman",
    ownerRole: "Visionary / Founder",
    organizationName: "Aurora Labs",
    ownershipStatus: "pending",
    organizationVerified: false,
  },
};

/** In-memory sample catalog — swap for API fetch later. */
const PROJECTS: Record<string, ProjectProfile> = {
  [VISIONARY_SAMPLE_PROJECT_ID]: SAMPLE_PROJECT,
};

export function getProjectById(id: string): ProjectProfile {
  const existing = PROJECTS[id];
  if (existing) return existing;

  return {
    ...SAMPLE_PROJECT,
    id,
    title: `Project ${id}`,
    summary:
      "Sample Visionary project profile. Connect this route to your project API when available.",
  };
}
