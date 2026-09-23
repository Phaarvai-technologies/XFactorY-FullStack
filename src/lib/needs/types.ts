/**
 * Need / requirement editor model — frontend-first.
 * Ready for API integration without a separate backend architecture.
 */

export type NeedType =
  | "manufacturing"
  | "vendor"
  | "labour"
  | "logistics"
  | "investor"
  | "legal"
  | "market_lead"
  | "supporting";

export type RequirementClassification =
  | "required"
  | "preferred"
  | "unknown"
  | "not_applicable";

export type RequirementItemStatus =
  | "suggested"
  | "confirmed"
  | "edited"
  | "missing"
  | "conflict";

export type RequirementSourceKind = "ai" | "manual" | "project" | "document";

export interface RequirementSource {
  kind: RequirementSourceKind;
  label: string;
}

export interface RequirementItem {
  id: string;
  categoryId: string;
  categoryLabel: string;
  name: string;
  value: string;
  classification: RequirementClassification;
  status: RequirementItemStatus;
  source: RequirementSource;
  notes: string;
  conflictWithId?: string;
}

export interface RequirementCategoryDef {
  id: string;
  label: string;
  description: string;
}

export interface RequirementVersionSnapshot {
  version: number;
  savedAt: string;
  changeReason: string;
  author: string;
  itemCount: number;
  requiredCount: number;
  preferredCount: number;
  unknownCount: number;
  naCount: number;
  changeSummary: string;
}

export type EditorDraftState =
  | "incomplete"
  | "valid_draft"
  | "missing_required"
  | "conflicting"
  | "version_changed"
  | "permission_revoked";

export interface NeedRequirementDraft {
  id: string;
  title: string;
  needType: NeedType;
  requesterName: string;
  projectId: string;
  projectTitle: string;
  confidentiality: string;
  version: number;
  previousVersion: number | null;
  draftStatus: "incomplete" | "valid_draft" | "ready_to_publish";
  lastUpdated: string;
  canEdit: boolean;
  items: RequirementItem[];
  versions: RequirementVersionSnapshot[];
  pendingChangeSummary: string;
}
