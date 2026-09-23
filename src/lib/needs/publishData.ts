import { getNeedDraftById } from "@/lib/needs/sampleData";
import type {
  PublishFieldVisibility,
  PublishFileAttachment,
  PublishReviewModel,
  PublishVisibility,
} from "@/lib/needs/publishTypes";
import type { NeedType, RequirementItem } from "@/lib/needs/types";
import { getProjectById } from "@/lib/projects/sampleData";

function defaultVisibilityForItem(item: RequirementItem): PublishVisibility {
  const name = item.name.toLowerCase();
  if (
    name.includes("confidential") ||
    name.includes("process detail") ||
    item.categoryId === "confidentiality"
  ) {
    return "private";
  }
  if (
    name.includes("dimension") ||
    name.includes("tolerance") ||
    name.includes("machine") ||
    item.categoryId === "dimensions" ||
    item.categoryId === "machinery"
  ) {
    return "restricted";
  }
  if (item.classification === "not_applicable") return "private";
  return "shared";
}

function buildFiles(): PublishFileAttachment[] {
  return [
    {
      id: "file-1",
      fileName: "Product Overview.pdf",
      fileType: "PDF",
      visibility: "shared",
      sensitive: false,
      includedInPublishedView: true,
    },
    {
      id: "file-2",
      fileName: "Technical Drawing.pdf",
      fileType: "PDF",
      visibility: "restricted",
      sensitive: true,
      includedInPublishedView: true,
    },
    {
      id: "file-3",
      fileName: "Confidential Process Notes.pdf",
      fileType: "PDF",
      visibility: "private",
      sensitive: true,
      includedInPublishedView: false,
    },
  ];
}

export function getPublishReviewByNeedId(
  needId: string,
  options?: {
    projectId?: string;
    needType?: NeedType;
    permissionRevoked?: boolean;
    versionStale?: boolean;
    forceVerificationRequired?: boolean;
  },
): PublishReviewModel {
  const draft = getNeedDraftById(needId, {
    projectId: options?.projectId,
    needType: options?.needType,
    permissionRevoked: options?.permissionRevoked,
  });
  const project = getProjectById(draft.projectId);

  const fields: PublishFieldVisibility[] = draft.items.map((item) => ({
    itemId: item.id,
    categoryLabel: item.categoryLabel,
    name: item.name,
    value: item.value,
    classification: item.classification,
    visibility: defaultVisibilityForItem(item),
    status: item.status,
  }));

  const files = buildFiles();
  const latest = draft.versions[0];
  const currentVersion = draft.version;
  const reviewedVersion = options?.versionStale
    ? Math.max(1, currentVersion - 1)
    : currentVersion;

  const missingRequired = draft.items.filter(
    (item) =>
      item.classification === "required" &&
      (!item.value.trim() || item.status === "missing"),
  );
  const conflicts = draft.items.filter((item) => item.status === "conflict");
  const unknowns = draft.items.filter(
    (item) =>
      item.classification === "unknown" ||
      item.status === "missing" ||
      item.status === "suggested",
  );
  const sensitiveRestricted = [
    ...fields.filter((f) => f.visibility !== "shared"),
    ...files.filter((f) => f.visibility !== "shared" || f.sensitive),
  ];

  const organizationVerified = project.ownership.organizationVerified;
  const verificationRequired =
    Boolean(options?.forceVerificationRequired) || !organizationVerified;

  const versionValid = !options?.versionStale;
  const conflictsResolved = conflicts.length === 0;
  const requiredComplete = missingRequired.length === 0;
  const authorized = draft.canEdit && !options?.permissionRevoked;

  const validationChecks = [
    {
      id: "version",
      label: "Requirement version is valid",
      state: versionValid ? ("pass" as const) : ("fail" as const),
      detail: versionValid
        ? `Reviewing version ${reviewedVersion}`
        : "A newer version exists — refresh before publishing",
    },
    {
      id: "required",
      label: "Required fields completed",
      state: requiredComplete ? ("pass" as const) : ("fail" as const),
      detail: requiredComplete
        ? undefined
        : missingRequired.map((i) => i.name).join(", "),
    },
    {
      id: "conflicts",
      label: "Conflicting values resolved",
      state: conflictsResolved ? ("pass" as const) : ("fail" as const),
      detail: conflictsResolved
        ? undefined
        : conflicts.map((i) => i.name).join(", "),
    },
    {
      id: "unknowns",
      label: "Unresolved unknowns reviewed",
      state: unknowns.length === 0 ? ("pass" as const) : ("warn" as const),
      detail:
        unknowns.length > 0
          ? `${unknowns.length} item(s) still unknown/missing`
          : undefined,
    },
    {
      id: "visibility",
      label: "Visibility settings reviewed",
      state: "warn" as const,
      detail: "Confirm field and file visibility before publishing",
    },
    {
      id: "sensitive",
      label: "Sensitive files reviewed",
      state: sensitiveRestricted.length > 0 ? ("warn" as const) : ("pass" as const),
      detail:
        sensitiveRestricted.length > 0
          ? `${sensitiveRestricted.length} restricted/private items`
          : undefined,
    },
    {
      id: "org",
      label: "Organization verified",
      state:
        organizationVerified && !options?.forceVerificationRequired
          ? ("pass" as const)
          : options?.forceVerificationRequired
            ? ("fail" as const)
            : ("warn" as const),
      detail:
        organizationVerified && !options?.forceVerificationRequired
          ? undefined
          : "Organization verification pending",
    },
    {
      id: "auth",
      label: "Publisher is authorized",
      state: authorized ? ("pass" as const) : ("fail" as const),
    },
  ];

  const blocking =
    !versionValid ||
    !requiredComplete ||
    !conflictsResolved ||
    !authorized ||
    (verificationRequired && Boolean(options?.forceVerificationRequired));

  const matchingLimitations: string[] = [];
  if (unknowns.length > 0) {
    matchingLimitations.push(
      `${unknowns.length} unresolved requirement(s) may reduce matching precision.`,
    );
  }
  if (fields.some((f) => f.visibility === "restricted")) {
    matchingLimitations.push(
      "Restricted fields limit what Organizations can evaluate before permitted access.",
    );
  }
  if (!organizationVerified) {
    matchingLimitations.push(
      "Organization verification is still pending and may limit marketplace reach.",
    );
  }

  return {
    draft,
    organizationName: project.ownership.organizationName,
    organizationVerified,
    marketplaceView: "Marketplace Matching View",
    visibleTo: "Eligible Organizations",
    canPublish: authorized,
    reviewedVersion,
    currentVersion,
    versionStale: Boolean(options?.versionStale),
    verificationRequired,
    changeCounts: {
      added: 2,
      modified: 3,
      reclassified: 1,
      removed: 0,
    },
    fields,
    files,
    validationChecks,
    publicationEligible: !blocking,
    matchingEligible: !blocking,
    matchingLimitations,
  };
}
