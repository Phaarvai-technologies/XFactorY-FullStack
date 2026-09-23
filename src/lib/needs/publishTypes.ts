import type {
  NeedRequirementDraft,
  RequirementClassification,
  RequirementItem,
} from "@/lib/needs/types";

/** Field/file visibility for cross-Organization disclosure. */
export type PublishVisibility = "shared" | "restricted" | "private";

export interface PublishFieldVisibility {
  itemId: string;
  categoryLabel: string;
  name: string;
  value: string;
  classification: RequirementClassification;
  visibility: PublishVisibility;
  status: RequirementItem["status"];
}

export interface PublishFileAttachment {
  id: string;
  fileName: string;
  fileType: string;
  visibility: PublishVisibility;
  sensitive: boolean;
  includedInPublishedView: boolean;
}

export interface PublishVersionChangeCounts {
  added: number;
  modified: number;
  reclassified: number;
  removed: number;
}

export interface PublishValidationCheck {
  id: string;
  label: string;
  state: "pass" | "warn" | "fail";
  detail?: string;
}

export interface PublishReviewModel {
  draft: NeedRequirementDraft;
  organizationName: string;
  organizationVerified: boolean;
  marketplaceView: string;
  visibleTo: string;
  canPublish: boolean;
  reviewedVersion: number;
  currentVersion: number;
  versionStale: boolean;
  verificationRequired: boolean;
  changeCounts: PublishVersionChangeCounts;
  fields: PublishFieldVisibility[];
  files: PublishFileAttachment[];
  validationChecks: PublishValidationCheck[];
  publicationEligible: boolean;
  matchingEligible: boolean;
  matchingLimitations: string[];
}
