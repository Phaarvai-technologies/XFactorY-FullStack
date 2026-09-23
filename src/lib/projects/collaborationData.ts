import type { ProjectCollaboration } from "@/lib/projects/collaborationTypes";
import { VISIONARY_SAMPLE_PROJECT_ID } from "@/lib/projects/paths";

const SAMPLE_COLLABORATION: ProjectCollaboration = {
  projectId: VISIONARY_SAMPLE_PROJECT_ID,
  spaceStatus: "private",
  discussionScope: "internal",
  collaborators: [
    {
      id: "col-1",
      name: "Asha Raman",
      role: "Visionary / Founder",
      organization: "Aurora Labs",
      membershipStatus: "active",
      initials: "AR",
      isExternalOrg: false,
    },
    {
      id: "col-2",
      name: "Dev Patel",
      role: "Product Engineer",
      organization: "Aurora Labs",
      membershipStatus: "active",
      initials: "DP",
      isExternalOrg: false,
    },
    {
      id: "col-3",
      name: "Meera Krishnan",
      role: "Manufacturing Advisor",
      organization: "Precision Form Plastics",
      membershipStatus: "awaiting_response",
      initials: "MK",
      isExternalOrg: true,
    },
    {
      id: "col-4",
      name: "Jonah Lee",
      role: "Industrial Designer",
      organization: "Studio North",
      membershipStatus: "invited",
      initials: "JL",
      isExternalOrg: true,
    },
  ],
  questions: [
    {
      id: "q-1",
      title: "Can we hit Class-A finish at pilot volume?",
      content:
        "For the first 2,500 units, do we need secondary polishing, or can mold quality alone meet the cosmetic spec?",
      askedBy: "Asha Raman",
      askedByRole: "Visionary / Founder",
      createdAt: "2026-09-12",
      status: "awaiting_response",
      relatedArea: "manufacturing_readiness",
      relatedLabel: "Manufacturing Readiness → Prototype Status",
      replies: [
        {
          id: "r-1",
          authorName: "Dev Patel",
          authorRole: "Product Engineer",
          content:
            "Secondary polishing adds cost. Prefer a tighter cavity polish grade and a single gate location review.",
          createdAt: "2026-09-13",
        },
      ],
    },
    {
      id: "q-2",
      title: "SMT fixture ownership for pilot run",
      content:
        "Should the functional test fixture be owned by Aurora Labs or included in the manufacturer engagement?",
      askedBy: "Dev Patel",
      askedByRole: "Product Engineer",
      createdAt: "2026-09-10",
      status: "open",
      relatedArea: "manufacturing_need",
      relatedLabel: "Manufacturing Need — PCB assembly (SMT)",
      replies: [],
    },
    {
      id: "q-3",
      title: "Logistics SLA for pilot kits",
      content:
        "Confirmed three-city sample distribution can stay as a supporting need rather than bundling into manufacturing.",
      askedBy: "Asha Raman",
      askedByRole: "Visionary / Founder",
      createdAt: "2026-09-04",
      status: "resolved",
      relatedArea: "supporting_need",
      relatedLabel: "Supporting Need — Domestic logistics for pilot kits",
      replies: [
        {
          id: "r-2",
          authorName: "Dev Patel",
          authorRole: "Product Engineer",
          content:
            "Agreed — keep logistics as a supporting request so manufacturing quotes stay clean.",
          createdAt: "2026-09-05",
        },
      ],
    },
  ],
  decisions: [
    {
      id: "d-1",
      title: "Keep logistics as a supporting need",
      summary:
        "Pilot kit distribution remains a separate supporting request and is not bundled into manufacturing RFQs.",
      createdAt: "2026-09-05",
      createdBy: "Asha Raman",
      relatedLabel: "Supporting Need — Domestic logistics",
    },
  ],
  formalNeeds: [],
};

const COLLABORATIONS: Record<string, ProjectCollaboration> = {
  [VISIONARY_SAMPLE_PROJECT_ID]: SAMPLE_COLLABORATION,
};

export function getCollaborationByProjectId(
  projectId: string,
): ProjectCollaboration {
  const existing = COLLABORATIONS[projectId];
  if (existing) return existing;

  return {
    ...SAMPLE_COLLABORATION,
    projectId,
    collaborators: SAMPLE_COLLABORATION.collaborators.map((c) => ({ ...c })),
    questions: SAMPLE_COLLABORATION.questions.map((q) => ({
      ...q,
      replies: q.replies.map((r) => ({ ...r })),
    })),
    decisions: SAMPLE_COLLABORATION.decisions.map((d) => ({ ...d })),
    formalNeeds: [],
  };
}
