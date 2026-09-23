import { getEngagementContext } from "@/lib/engagements/sampleData";
import type { EngagementWorkspace } from "@/lib/engagements/workspaceTypes";
import { REQUEST_TYPE_OPTIONS } from "@/lib/engagements/requestTypes";

export const SAMPLE_ENGAGEMENT_ID = "eng-aurora-precision-001";

export function engagementWorkspacePath(id: string): string {
  return `/engagements/${id}`;
}

export function getEngagementWorkspaceById(
  id: string,
  options?: { denied?: boolean },
): EngagementWorkspace | null {
  const context = getEngagementContext({
    needId: "need-aurora-enclosure",
    candidateId: "cand-precision-form",
  });
  if (!context) return null;

  const requestType = "availability" as const;
  const requestTypeLabel =
    REQUEST_TYPE_OPTIONS.find((option) => option.id === requestType)?.label ??
    "Availability";

  return {
    id: id || SAMPLE_ENGAGEMENT_ID,
    status: "delivered",
    requestType,
    requestTypeLabel,
    createdAt: "2026-09-22T11:05:00",
    requesterOrganization: context.requesterOrganization,
    recipientOrganization: context.recipientOrganization,
    requesterName: context.requesterName,
    recipientName: context.recipientName,
    needId: context.needId,
    needTitle: context.needTitle,
    needStatus: "Published",
    requirementVersion: context.requirementVersion,
    requirementVersionDate: "2026-09-20T11:15:00",
    newerRequirementVersion: context.requirementVersion + 1,
    candidateId: context.candidateId,
    candidateName: context.candidateName,
    projectId: context.projectId,
    confidentiality: "Organization-confidential",
    disclosureFields: [
      { label: "Service / product required", state: "shared" },
      { label: "Required quantity / capacity", state: "shared" },
      { label: "Required date / timeframe", state: "shared" },
      { label: "Geography", state: "shared" },
      { label: "Availability question", state: "shared" },
      { label: "Internal shortlist notes", state: "not_shared" },
      { label: "Private BOM details", state: "not_shared" },
    ],
    disclosureFiles: [
      { label: "Product Overview.pdf", state: "shared" },
      { label: "Technical Drawing.pdf", state: "restricted" },
      { label: "Confidential Process Notes.pdf", state: "not_shared" },
    ],
    disclosureLimitations: [
      "Shared information is limited to the stated request context.",
      "Restricted files require permitted access and are not openly downloadable.",
      "Private Organization notes and internal matching data are never included.",
    ],
    messages: [
      {
        id: "msg-1",
        senderName: context.requesterName,
        senderOrganization: context.requesterOrganization,
        senderRole: "Visionary / Requester",
        timestamp: "2026-09-22T11:05:00",
        content:
          "We would like to confirm whether you can support enclosure molding for our pilot run. This is a nonbinding availability request.",
        attachments: [
          {
            id: "att-1",
            fileName: "Product Overview.pdf",
            accessState: "available",
          },
        ],
      },
      {
        id: "msg-2",
        senderName: "Ops Desk",
        senderOrganization: context.recipientOrganization,
        senderRole: "Manufacturer",
        timestamp: "2026-09-22T12:20:00",
        content:
          "Thanks — we received the request. We can review prototype capacity this week. Please clarify cosmetic tolerance expectations if known.",
        attachments: [],
        structuredResponse: {
          kind: "acknowledge",
          label: "Acknowledge",
          fields: [
            { label: "Acknowledgement", value: "Request received" },
            { label: "Notes", value: "Reviewing prototype capacity this week" },
          ],
        },
      },
      {
        id: "msg-3",
        senderName: "Ops Desk",
        senderOrganization: context.recipientOrganization,
        senderRole: "Manufacturer",
        timestamp: "2026-09-22T13:10:00",
        content:
          "Indicative availability for the requested pilot window, subject to final drawing package under NDA.",
        attachments: [
          {
            id: "att-2",
            fileName: "Technical Drawing.pdf",
            accessState: "pending_access",
          },
        ],
        structuredResponse: {
          kind: "availability",
          label: "Availability Response",
          fields: [
            { label: "Availability", value: "Available for discussion" },
            { label: "Capacity", value: "Pilot run support possible" },
            { label: "Available date", value: "From mid-Q4" },
            { label: "Lead time", value: "Approximately 14 days after release" },
            {
              label: "Notes",
              value: "Nonbinding — depends on final specs and NDA share",
            },
          ],
        },
      },
    ],
    timeline: [
      {
        id: "tl-1",
        kind: "system",
        eventType: "Engagement created",
        actor: context.requesterName,
        organization: context.requesterOrganization,
        timestamp: "2026-09-22T11:05:00",
        context: `Availability request based on Requirement v${context.requirementVersion}`,
      },
      {
        id: "tl-2",
        kind: "communication",
        eventType: "Message sent",
        actor: context.requesterName,
        organization: context.requesterOrganization,
        timestamp: "2026-09-22T11:05:00",
        context: "Initial nonbinding availability request",
      },
      {
        id: "tl-3",
        kind: "status",
        eventType: "Status → Delivered",
        actor: "System",
        organization: "X!Y",
        timestamp: "2026-09-22T11:05:12",
        context: "Request delivered to recipient Organization",
      },
      {
        id: "tl-4",
        kind: "communication",
        eventType: "Acknowledgement",
        actor: "Ops Desk",
        organization: context.recipientOrganization,
        timestamp: "2026-09-22T12:20:00",
        context: "Recipient acknowledged the request",
      },
      {
        id: "tl-5",
        kind: "status",
        eventType: "Status → Acknowledged",
        actor: "Ops Desk",
        organization: context.recipientOrganization,
        timestamp: "2026-09-22T12:20:00",
        context: "Engagement marked acknowledged",
      },
      {
        id: "tl-6",
        kind: "file",
        eventType: "File access pending",
        actor: "Ops Desk",
        organization: context.recipientOrganization,
        timestamp: "2026-09-22T13:10:00",
        context: "Technical Drawing.pdf — pending access",
      },
      {
        id: "tl-7",
        kind: "communication",
        eventType: "Availability response",
        actor: "Ops Desk",
        organization: context.recipientOrganization,
        timestamp: "2026-09-22T13:10:00",
        context: "Structured availability response shared (nonbinding)",
      },
      {
        id: "tl-8",
        kind: "version",
        eventType: "Requirement version updated (source Need)",
        actor: context.requesterName,
        organization: context.requesterOrganization,
        timestamp: "2026-09-22T14:00:00",
        context: `A newer Requirement version (v${context.requirementVersion + 1}) now exists. Original engagement context remains v${context.requirementVersion}.`,
      },
      {
        id: "tl-9",
        kind: "disclosure",
        eventType: "Disclosure unchanged",
        actor: "System",
        organization: "X!Y",
        timestamp: "2026-09-22T14:00:00",
        context:
          "Engagement continues on original disclosed fields/files; newer Need version is not auto-applied.",
      },
    ],
    attachableFiles: [
      { id: "af-1", fileName: "Product Overview.pdf", approved: true },
      { id: "af-2", fileName: "Pilot FAQ (public-safe).pdf", approved: true },
      {
        id: "af-3",
        fileName: "Confidential Process Notes.pdf",
        approved: false,
      },
    ],
    canAccess: !options?.denied,
  };
}
