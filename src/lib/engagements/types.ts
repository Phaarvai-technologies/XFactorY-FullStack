export type EngagementRequestType =
  | "inquiry"
  | "availability"
  | "quote"
  | "material_tooling"
  | "workforce"
  | "logistics"
  | "market_channel"
  | "investment_interest"
  | "legal_audit";

export type DisclosureVisibility = "shared" | "restricted" | "private";

export interface EngagementFieldDef {
  id: string;
  label: string;
  kind: "text" | "textarea" | "select";
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

export interface EngagementFileOption {
  id: string;
  fileName: string;
  fileType: string;
  visibility: DisclosureVisibility;
  sensitive: boolean;
  allowed: boolean;
}

export interface EngagementContext {
  requesterName: string;
  requesterOrganization: string;
  recipientName: string;
  recipientOrganization: string;
  recipientPersona: string;
  recipientLocation: string;
  recipientVerification: string;
  needId: string;
  needTitle: string;
  needType: string;
  requirementVersion: number;
  candidateId: string;
  candidateName: string;
  projectId: string;
}

export interface EngagementFieldShare {
  id: string;
  label: string;
  value: string;
  included: boolean;
  allowed: boolean;
}
