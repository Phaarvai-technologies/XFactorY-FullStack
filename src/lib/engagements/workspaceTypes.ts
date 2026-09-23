import type { EngagementRequestType } from "@/lib/engagements/types";

export type EngagementStatus =
  | "sent"
  | "delivered"
  | "acknowledged"
  | "clarification"
  | "interested"
  | "declined"
  | "cancelled";

export type AttachmentAccessState =
  | "available"
  | "approved"
  | "restricted"
  | "pending_access"
  | "not_available"
  | "revoked"
  | "expired";

export type TimelineEventKind =
  | "system"
  | "communication"
  | "status"
  | "disclosure"
  | "file"
  | "version";

export type StructuredResponseKind =
  | "acknowledge"
  | "clarify"
  | "interested"
  | "decline"
  | "availability"
  | "quote"
  | "service";

export interface EngagementMessageAttachment {
  id: string;
  fileName: string;
  accessState: AttachmentAccessState;
}

export interface EngagementMessage {
  id: string;
  senderName: string;
  senderOrganization: string;
  senderRole: string;
  timestamp: string;
  content: string;
  attachments: EngagementMessageAttachment[];
  structuredResponse?: {
    kind: StructuredResponseKind;
    label: string;
    fields: { label: string; value: string }[];
  };
}

export interface EngagementTimelineEvent {
  id: string;
  kind: TimelineEventKind;
  eventType: string;
  actor: string;
  organization: string;
  timestamp: string;
  context: string;
}

export interface EngagementDisclosureItem {
  label: string;
  state: "shared" | "restricted" | "not_shared" | "revoked" | "expired";
}

export interface EngagementWorkspace {
  id: string;
  status: EngagementStatus;
  requestType: EngagementRequestType;
  requestTypeLabel: string;
  createdAt: string;
  requesterOrganization: string;
  recipientOrganization: string;
  requesterName: string;
  recipientName: string;
  needId: string;
  needTitle: string;
  needStatus: string;
  requirementVersion: number;
  requirementVersionDate: string;
  newerRequirementVersion: number | null;
  candidateId: string;
  candidateName: string;
  projectId: string;
  confidentiality: string;
  disclosureFields: EngagementDisclosureItem[];
  disclosureFiles: EngagementDisclosureItem[];
  disclosureLimitations: string[];
  messages: EngagementMessage[];
  timeline: EngagementTimelineEvent[];
  attachableFiles: { id: string; fileName: string; approved: boolean }[];
  canAccess: boolean;
}
