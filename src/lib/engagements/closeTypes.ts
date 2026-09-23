export type CloseOutcomeReason =
  | "proceeded_outside"
  | "no_fit"
  | "timing"
  | "price"
  | "capacity"
  | "compliance"
  | "no_response"
  | "other";

export type DataFeedbackOption =
  | "accurate"
  | "outdated"
  | "requirement_unclear"
  | "candidate_inaccurate"
  | "match_not_relevant"
  | "other";

export const CLOSE_OUTCOME_OPTIONS: {
  id: CloseOutcomeReason;
  label: string;
}[] = [
  { id: "proceeded_outside", label: "Proceeded outside platform" },
  { id: "no_fit", label: "No fit" },
  { id: "timing", label: "Timing" },
  { id: "price", label: "Price" },
  { id: "capacity", label: "Capacity" },
  { id: "compliance", label: "Compliance" },
  { id: "no_response", label: "No response" },
  { id: "other", label: "Other" },
];

export const DATA_FEEDBACK_OPTIONS: {
  id: DataFeedbackOption;
  label: string;
}[] = [
  { id: "accurate", label: "Information was accurate" },
  { id: "outdated", label: "Information was outdated" },
  { id: "requirement_unclear", label: "Requirement was unclear" },
  {
    id: "candidate_inaccurate",
    label: "Candidate / service information was inaccurate",
  },
  { id: "match_not_relevant", label: "Match was not relevant" },
  { id: "other", label: "Other" },
];

export function outcomeLabel(reason: CloseOutcomeReason): string {
  return (
    CLOSE_OUTCOME_OPTIONS.find((option) => option.id === reason)?.label ??
    reason
  );
}

export function feedbackLabel(option: DataFeedbackOption): string {
  return (
    DATA_FEEDBACK_OPTIONS.find((entry) => entry.id === option)?.label ?? option
  );
}

export function engagementClosePath(id: string): string {
  return `/engagements/${id}/close`;
}
