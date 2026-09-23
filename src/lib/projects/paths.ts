/** Default Visionary Explore destination for the homepage persona card. */
export const VISIONARY_SAMPLE_PROJECT_ID = "aurora-compact";

export const VISIONARY_EXPLORE_PATH = `/projects/${VISIONARY_SAMPLE_PROJECT_ID}`;

export function projectProfilePath(id: string): string {
  return `/projects/${id}`;
}

export function projectCollaborationPath(id: string): string {
  return `/projects/${id}/collaboration`;
}

/** Formal Need creation entry used from private collaboration discussions. */
export function formalNeedNewPath(params?: {
  projectId?: string;
  questionId?: string;
}): string {
  const search = new URLSearchParams();
  if (params?.projectId) search.set("projectId", params.projectId);
  if (params?.questionId) search.set("questionId", params.questionId);
  search.set("from", "collaboration");
  const query = search.toString();
  return query ? `/needs/new?${query}` : "/needs/new";
}
