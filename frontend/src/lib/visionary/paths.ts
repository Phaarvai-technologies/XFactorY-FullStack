export const VISIONARY_OVERVIEW_PATH = "/visionaries";
export const VISIONARY_FLOW_PATH = "/visionaries/flow";

export function visionarySignInHref(): string {
  return `/sign-in?redirect_url=${encodeURIComponent(VISIONARY_FLOW_PATH)}`;
}

export type VisionarySlide =
  | "step1"
  | "step2"
  | "step3"
  | "step4"
  | "results"
  | "request"
  | "submitted"
  | "project"
  | "manufacturer";

export const VISIONARY_SLIDE_TITLES: Record<VisionarySlide, string> = {
  step1: "Let’s Start With You – X!Y",
  step2: "Your Idea – X!Y",
  step3: "Project Stage – X!Y",
  step4: "Manufacturing Needs – X!Y",
  results: "Find a Manufacturer – X!Y",
  request: "Create Manufacturing Request – X!Y",
  submitted: "Manufacturing Request Sent – X!Y",
  project: "My Project – X!Y",
  manufacturer: "Manufacturer Profile – X!Y",
};
