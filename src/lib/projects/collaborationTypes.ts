/**
 * Private project collaboration model — frontend-first.
 * Replace sample loaders with API responses when backend is available.
 */

export type CollaboratorMembershipStatus =
  | "invited"
  | "active"
  | "awaiting_response"
  | "removed";

export type QuestionStatus = "open" | "awaiting_response" | "resolved";

export type DiscussionScope = "internal" | "cross_organization";

export type CollaborationSpaceStatus = "private" | "archived";

export type RelatedProjectArea =
  | "project_field"
  | "manufacturing_need"
  | "supporting_need"
  | "manufacturing_readiness"
  | "other";

export interface Collaborator {
  id: string;
  name: string;
  role: string;
  organization: string;
  membershipStatus: CollaboratorMembershipStatus;
  initials: string;
  isExternalOrg: boolean;
}

export interface QuestionReply {
  id: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
}

export interface CollaborationQuestion {
  id: string;
  title: string;
  content: string;
  askedBy: string;
  askedByRole: string;
  createdAt: string;
  status: QuestionStatus;
  relatedArea: RelatedProjectArea;
  relatedLabel: string;
  replies: QuestionReply[];
}

export interface DecisionNote {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  createdBy: string;
  relatedLabel: string;
}

export interface FormalNeedFromDiscussion {
  id: string;
  title: string;
  summary: string;
  sourceQuestionId?: string;
  createdAt: string;
}

export interface ProjectCollaboration {
  projectId: string;
  spaceStatus: CollaborationSpaceStatus;
  discussionScope: DiscussionScope;
  collaborators: Collaborator[];
  questions: CollaborationQuestion[];
  decisions: DecisionNote[];
  formalNeeds: FormalNeedFromDiscussion[];
}
