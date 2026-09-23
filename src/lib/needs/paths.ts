export const SAMPLE_NEED_ID = "need-aurora-enclosure";

export function needAiStructurePath(needId: string): string {
  return `/needs/${needId}/structure`;
}

export function needRequirementEditorPath(needId: string): string {
  return `/needs/${needId}/editor`;
}

/** Spec path used by Publish Confirmation “Back to Edit”. */
export function needRequirementsPath(needId: string): string {
  return `/needs/${needId}/requirements`;
}

export function needPublishPath(needId: string): string {
  return `/needs/${needId}/publish`;
}

export function needComparePath(needId: string): string {
  return `/needs/${needId}/compare`;
}

export function createNeedContinuePath(params: {
  projectId?: string;
  type?: string;
}): string {
  const needId = SAMPLE_NEED_ID;
  const search = new URLSearchParams();
  if (params.projectId) search.set("projectId", params.projectId);
  if (params.type) search.set("type", params.type);
  search.set("from", "need-create");
  const query = search.toString();
  return `${needAiStructurePath(needId)}${query ? `?${query}` : ""}`;
}
