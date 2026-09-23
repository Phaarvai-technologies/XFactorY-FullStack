/**
 * Visionary project profile model — frontend-first.
 * Replace sample loaders with API responses when backend is available.
 */

export type ProjectLifecycleStatus =
  | "private_draft"
  | "active"
  | "paused"
  | "archived";

export type ProjectVisibility = "private" | "redacted_published";

export type ConfidentialityLevel =
  | "public_safe"
  | "redacted"
  | "confidential"
  | "restricted";

export type PrototypeStatus =
  | "concept"
  | "in_development"
  | "prototype"
  | "ready_for_manufacturing";

export type EcosystemItemStatus = "open" | "in_progress" | "closed";

export interface EcosystemItem {
  id: string;
  title: string;
  summary: string;
  status: EcosystemItemStatus;
}

export interface ProjectOwnership {
  ownerName: string;
  ownerRole: string;
  organizationName: string;
  ownershipStatus: "verified" | "pending" | "unverified";
  organizationVerified: boolean;
}

export interface ManufacturingReadiness {
  prototypeStatus: PrototypeStatus;
  expectedVolume: string;
  timeline: string;
  constraints: string[];
}

export interface ProjectProfile {
  id: string;
  title: string;
  summary: string;
  stage: string;
  industry: string;
  targetGeography: string;
  status: ProjectLifecycleStatus;
  visibility: ProjectVisibility;
  confidentiality: ConfidentialityLevel;
  publicDescription: string;
  redactedOverview: string;
  mediaLabel: string;
  mediaCaption: string;
  manufacturing: ManufacturingReadiness;
  linkedNeeds: EcosystemItem[];
  shortlist: EcosystemItem[];
  engagements: EcosystemItem[];
  supportingRequests: EcosystemItem[];
  ownership: ProjectOwnership;
}
