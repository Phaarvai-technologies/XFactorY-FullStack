import type {
  ManufacturingRequest,
  VisionaryIdea,
  VisionaryProfile,
  VisionaryRequirements,
} from "@/lib/visionary/storage";

/** GET /visionary/me (and every save): the signed-in Visionary's saved data. */
export type VisionaryData = {
  profile: VisionaryProfile | null;
  idea: VisionaryIdea | null;
  stage: string;
  requirements: VisionaryRequirements | null;
  /** Oldest first; the screens show the latest. */
  requests: ManufacturingRequest[];
};

const EMPTY: VisionaryData = { profile: null, idea: null, stage: "", requirements: null, requests: [] };

/**
 * In-memory copy of the server data for the current page. VisionaryFlow loads it from the
 * API before any step renders, and every save replaces it with the server's answer, so the
 * steps can read it synchronously (as they did with browser storage). Nothing is persisted
 * in the browser; a refresh or a new sign-in loads it again from the database.
 */
let current: VisionaryData = EMPTY;

export function getVisionaryData(): VisionaryData {
  return current;
}

export function setVisionaryData(next: VisionaryData): void {
  current = { ...EMPTY, ...next, requests: next.requests ?? [] };
}

export function addVisionaryRequest(request: ManufacturingRequest): void {
  current = { ...current, requests: [...current.requests, request] };
}

export function latestVisionaryRequest(): ManufacturingRequest | null {
  return current.requests.length ? current.requests[current.requests.length - 1] : null;
}
