export const VISIONARY_OVERVIEW_PATH = "/visionaries";
export const VISIONARY_FLOW_PATH = "/visionaries/flow";

export function visionarySignInHref(): string {
  return `/sign-in?redirect_url=${encodeURIComponent(VISIONARY_FLOW_PATH)}`;
}

export type VisionarySlide =
  | "step1"
  | "step2"
  | "step3"
  | "guide"
  | "step4"
  | "results"
  | "request"
  | "submitted"
  | "project"
  | "projects"
  | "requests"
  | "manufacturer";

export const VISIONARY_SLIDE_TITLES: Record<VisionarySlide, string> = {
  step1: "Let’s Start With You – XfactorY",
  step2: "Your Idea – XfactorY",
  step3: "Project Stage – XfactorY",
  guide: "Your AI Guide – XfactorY",
  step4: "Manufacturing Needs – XfactorY",
  results: "Find a Manufacturer – XfactorY",
  request: "Create Manufacturing Request – XfactorY",
  submitted: "Manufacturing Request Sent – XfactorY",
  project: "My Project – XfactorY",
  projects: "View All Projects – XfactorY",
  requests: "View All Requests – XfactorY",
  manufacturer: "Manufacturer Profile – XfactorY",
};
