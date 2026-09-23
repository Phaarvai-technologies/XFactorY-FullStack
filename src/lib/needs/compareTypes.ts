import type { PersonaId } from "@/types/personas";

export type EvidenceStatus =
  | "verified"
  | "evidence_provided"
  | "partially_verified"
  | "not_provided"
  | "unknown"
  | "stale";

export type CandidateEligibility = "eligible" | "ineligible";

export type CompareValueKind = "text" | "unknown" | "not_provided" | "stale";

export interface CompareDimensionValue {
  kind: CompareValueKind;
  text: string;
  lastUpdatedLabel?: string;
}

export interface CompareDimension {
  id: string;
  label: string;
}

export interface CompareCandidate {
  id: string;
  name: string;
  organizationName: string;
  persona: PersonaId;
  personaLabel: string;
  location: string;
  verificationStatus: "verified" | "partial" | "unverified";
  eligibility: CandidateEligibility;
  ineligibleReason?: string;
  evidence: EvidenceStatus;
  values: Record<string, CompareDimensionValue>;
}

export interface CandidateNote {
  candidateId: string;
  text: string;
}

export interface CompareShortlistState {
  needId: string;
  needTitle: string;
  organizationName: string;
  selectedIds: string[];
  notes: CandidateNote[];
  saved: boolean;
  savedAt?: string;
}
