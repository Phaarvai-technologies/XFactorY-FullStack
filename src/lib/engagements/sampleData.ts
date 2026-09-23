import { COMPARE_CANDIDATE_POOL } from "@/lib/needs/compareData";
import { getNeedDraftById } from "@/lib/needs/sampleData";
import { needTypeLabel } from "@/lib/needs/templates";
import { getProjectById } from "@/lib/projects/sampleData";
import type {
  EngagementContext,
  EngagementFileOption,
} from "@/lib/engagements/types";
import { defaultRequestTypeForPersona } from "@/lib/engagements/requestTypes";

export function createEngagementPath(params: {
  needId: string;
  candidateId: string;
}): string {
  const search = new URLSearchParams();
  search.set("needId", params.needId);
  search.set("candidateId", params.candidateId);
  return `/engagements/new?${search.toString()}`;
}

export function getEngagementContext(params: {
  needId?: string;
  candidateId?: string;
}): EngagementContext | null {
  const needId = params.needId ?? "need-aurora-enclosure";
  const candidateId = params.candidateId;
  if (!candidateId) return null;

  const candidate = COMPARE_CANDIDATE_POOL.find(
    (entry) => entry.id === candidateId,
  );
  if (!candidate) return null;

  const draft = getNeedDraftById(needId);
  const project = getProjectById(draft.projectId);

  return {
    requesterName: draft.requesterName,
    requesterOrganization: project.ownership.organizationName,
    recipientName: candidate.name,
    recipientOrganization: candidate.organizationName,
    recipientPersona: candidate.personaLabel,
    recipientLocation: candidate.location,
    recipientVerification:
      candidate.verificationStatus === "verified"
        ? "Verified"
        : candidate.verificationStatus === "partial"
          ? "Partial"
          : "Unverified",
    needId: draft.id,
    needTitle: draft.title,
    needType: needTypeLabel(draft.needType),
    requirementVersion: draft.version,
    candidateId: candidate.id,
    candidateName: candidate.name,
    projectId: draft.projectId,
  };
}

export function getEngagementFiles(): EngagementFileOption[] {
  return [
    {
      id: "eng-file-1",
      fileName: "Product Overview.pdf",
      fileType: "PDF",
      visibility: "shared",
      sensitive: false,
      allowed: true,
    },
    {
      id: "eng-file-2",
      fileName: "Technical Drawing.pdf",
      fileType: "PDF",
      visibility: "restricted",
      sensitive: true,
      allowed: true,
    },
    {
      id: "eng-file-3",
      fileName: "Confidential Process Notes.pdf",
      fileType: "PDF",
      visibility: "private",
      sensitive: true,
      allowed: false,
    },
  ];
}

export function initialFieldValues(
  context: EngagementContext,
): Record<string, string> {
  const type = defaultRequestTypeForPersona(context.recipientPersona);
  const base: Record<string, string> = {
    subject: `${context.needTitle} — discussion`,
    purpose: `Discuss support for ${context.needTitle}`,
    message: `We would like to start a nonbinding conversation about ${context.needTitle}.`,
    reference: context.needId,
    response_timeframe: "Within 5 business days",
    service: context.needTitle,
    quantity: "Pilot / first production run",
    timeframe: "Q4 tooling · pilot window",
    geography: context.recipientLocation,
    availability_question:
      "Are you currently available for this requirement?",
    product: context.needTitle,
    specifications: "Visibility-safe specifications only — details on request.",
    delivery_timeframe: "Pilot run timeframe",
    delivery_location: context.recipientLocation,
    quote_info: "Indicative / nonbinding pricing only.",
    material_type: "ABS / PC enclosure materials",
    specification: "Cosmetic-grade housing support",
    required_date: "Aligned to pilot timeline",
    skill: "Production / assembly support",
    shift: "Day shift",
    duration: "Pilot period",
    pickup: "Bengaluru",
    delivery: "Multi-city sample distribution",
    product_type: "Finished sample kits",
    target_market: "Urban housing / compact climate",
    segment: "OEM / channel partners",
    requirement: "Market access discussion",
    project: context.needTitle,
    funding: "Discussion only — nonbinding",
    stage: "Prototype",
    service_type: "Compliance / documentation support",
    compliance: "Safety / documentation review",
    jurisdiction: "India",
    industry: "Consumer hardware",
    relevant: "",
    notes: "",
    certifications: "",
    packaging: "",
    storage: "",
    handling: "",
    experience: "",
  };

  if (type === "availability") {
    base.subject = `Availability — ${context.needTitle}`;
  }
  return base;
}

export { defaultRequestTypeForPersona };
