import type { CompareCandidate } from "@/lib/needs/compareTypes";
import { getNeedDraftById } from "@/lib/needs/sampleData";
import { getProjectById } from "@/lib/projects/sampleData";

function text(value: string) {
  return { kind: "text" as const, text: value };
}

function unknown() {
  return { kind: "unknown" as const, text: "Unknown" };
}

function notProvided() {
  return { kind: "not_provided" as const, text: "Not provided" };
}

function stale(value: string, lastUpdatedLabel: string) {
  return {
    kind: "stale" as const,
    text: value,
    lastUpdatedLabel,
  };
}

/** Isolated frontend candidate pool for comparison — replace with matching API later. */
export const COMPARE_CANDIDATE_POOL: CompareCandidate[] = [
  {
    id: "cand-precision-form",
    name: "Precision Form Plastics",
    organizationName: "Precision Form Plastics",
    persona: "manufacturer",
    personaLabel: "Manufacturer",
    location: "Chennai",
    verificationStatus: "verified",
    eligibility: "eligible",
    evidence: "verified",
    values: {
      capabilities: text("Injection molding · Class-A housings"),
      machinery: text("80–250T presses"),
      process: text("Injection molding"),
      material: text("ABS / PC · cosmetic grades"),
      volume: text("2k–20k units / run"),
      capacity: stale("10,000 units/month", "47 days ago"),
      availability: text("Available"),
      lead_time: text("14 days"),
      tolerance: text("Tight cosmetic tolerances"),
      certifications: text("ISO 9001"),
      geography: text("Chennai · South India"),
      evidence: text("Verified"),
      verification: text("Verified"),
    },
  },
  {
    id: "cand-coastal-tooling",
    name: "Coastal Tooling Works",
    organizationName: "Coastal Tooling Works",
    persona: "manufacturer",
    personaLabel: "Manufacturer",
    location: "Pune",
    verificationStatus: "partial",
    eligibility: "eligible",
    evidence: "partially_verified",
    values: {
      capabilities: text("Injection molding · tooling support"),
      machinery: text("120–400T presses"),
      process: text("Injection molding"),
      material: text("ABS · PC · filled grades"),
      volume: text("5k–50k units / run"),
      capacity: unknown(),
      availability: unknown(),
      lead_time: text("21 days"),
      tolerance: notProvided(),
      certifications: unknown(),
      geography: text("Pune · West India"),
      evidence: text("Partially verified"),
      verification: text("Partial"),
    },
  },
  {
    id: "cand-delta-mould",
    name: "Delta Mould Systems",
    organizationName: "Delta Mould Systems",
    persona: "manufacturer",
    personaLabel: "Manufacturer",
    location: "Chennai",
    verificationStatus: "verified",
    eligibility: "ineligible",
    ineligibleReason: "Outside current serviceable capacity window for this need.",
    evidence: "verified",
    values: {
      capabilities: text("Injection molding · CNC fixtures"),
      machinery: text("CNC + 100–180T presses"),
      process: text("Injection molding · secondary CNC"),
      material: text("Engineering plastics"),
      volume: text("1k–8k units / run"),
      capacity: text("Limited this quarter"),
      availability: text("Available"),
      lead_time: unknown(),
      tolerance: text("Prototype to pilot"),
      certifications: text("ISO 9001"),
      geography: text("Chennai"),
      evidence: text("Verified"),
      verification: text("Verified"),
    },
  },
  {
    id: "cand-harbor-logistics",
    name: "Harbor Link Logistics",
    organizationName: "Harbor Link Logistics",
    persona: "logistics_provider",
    personaLabel: "Logistics Provider",
    location: "Bengaluru",
    verificationStatus: "verified",
    eligibility: "eligible",
    evidence: "evidence_provided",
    values: {
      pickup: text("Bengaluru · Chennai corridors"),
      delivery: text("3 metro last-mile"),
      storage: text("Ambient warehouse available"),
      packaging: text("Pilot-kit packaging"),
      product_type: text("Finished goods · sample kits"),
      geography: text("South India"),
      availability: text("Available"),
      lead_time: text("3–5 days"),
      handling: notProvided(),
      evidence: text("Evidence provided"),
      capabilities: text("Domestic logistics for pilot kits"),
      certifications: unknown(),
      verification: text("Verified"),
    },
  },
];

export function getCompareBootstrap(needId: string, projectId?: string) {
  const draft = getNeedDraftById(needId, { projectId });
  const project = getProjectById(draft.projectId);
  return {
    needId: draft.id,
    needTitle: draft.title,
    organizationName: project.ownership.organizationName,
    pool: COMPARE_CANDIDATE_POOL,
    initialSelectedIds: [
      "cand-precision-form",
      "cand-coastal-tooling",
      "cand-delta-mould",
    ],
  };
}

export function candidateProfilePath(candidateId: string, needId: string): string {
  return `/candidates/${candidateId}?needId=${encodeURIComponent(needId)}&from=compare`;
}

export function startEngagementPath(needId: string, candidateId: string): string {
  const search = new URLSearchParams();
  search.set("needId", needId);
  search.set("candidateId", candidateId);
  return `/engagements/new?${search.toString()}`;
}
