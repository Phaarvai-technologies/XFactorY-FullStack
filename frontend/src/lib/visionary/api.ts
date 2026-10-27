"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useMemo } from "react";
import { api, ApiError } from "@/lib/api";
import type { PublicManufacturerProfile } from "@/lib/manufacturer/publicProfile";
import type {
  ManufacturerRecord,
  ManufacturingRequest,
  VisionaryIdea,
  VisionaryProfile,
  VisionaryRequirements,
} from "@/lib/visionary/storage";
import { setVisionaryData, type VisionaryData } from "@/lib/visionary/store";

/** Request form fields kept by "Save" (GET/PUT /visionary/manufacturers/{id}/draft). */
export type RequestDraft = Omit<ManufacturingRequest, "manufacturer_name" | "project_name" | "visionary">;

export type RequestInput = Omit<
  ManufacturingRequest,
  "manufacturer_name" | "project_name" | "visionary" | "status" | "id" | "request_id" | "created_at"
>;

/** GET /visionary/manufacturers/matches: what "Find a Manufacturer" shows. */
export type ManufacturerMatches = {
  /** The saved requirements the backend matched with (null: none saved yet). */
  requirements: VisionaryRequirements | null;
  /** Requirements used as filters: "location" and/or "machines". */
  applied: ("location" | "machines")[];
  /** Requirements the database cannot compare, with the reason (shown, never used to filter). */
  notCompared: { field: "quantity" | "budget" | "timeline"; reason: string }[];
  manufacturers: (ManufacturerRecord & { matchedMachines: string[] })[];
  /** Not-yet-verified directory listings (imported companies) in the same city: one page. */
  listings: (ManufacturerRecord & { listing: true })[];
  /** All listings for this city (and search), for "Show more". */
  listingsTotal: number;
};

// ---------------------------------------------------------------- AI assistant (optional)
export type AiPanel = "idea" | "guide";
export type AiFields = Partial<{
  project: string;
  idea: string;
  product: string;
  industry: string;
  machines: string[];
  additional_requirements: string;
}>;
export type AiSuggestion = {
  id: string;
  title: string;
  summary: string;
  target_users: string;
  problem: string;
  why_it_fits: string;
  materials_or_processes: string;
  first_step: string;
  assumptions: string;
  /** Proposed values for existing fields (validated by the backend); applied only after confirmation. */
  fields: AiFields;
};
export type AiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  mode?: "chat" | "start" | "explore" | "refine";
  chips?: string[];
  suggestions?: AiSuggestion[];
  refreshNote?: string;
  /** Suggestion ids the user already applied. */
  accepted?: string[];
};
export type AiHistory = { configured: boolean; messages: AiMessage[]; contextChanged: string[] };
/** The screen's current values (unsaved edits included); sent so the reply uses the latest input. */
export type AiForm = Partial<{
  project: string;
  idea: string;
  product: string;
  industry: string;
  manufacturing_location: string;
  machines: string[];
  quantity: number;
  budget: number;
  timeline: string;
  additional_requirements: string;
}>;
export type AiSendBody = {
  message: string;
  mode: "chat" | "start" | "explore" | "refine";
  form?: AiForm;
  request_id: string;
  /** Your idea opened by "Add Project": the next project's conversation, no saved project values. */
  new_project?: boolean;
};

export function errorMessage(error: unknown, fallback: string): string {
  // 4xx answers carry a readable "detail"; validation lists (422) and server errors do not.
  if (error instanceof ApiError && error.status > 0 && error.status < 500) {
    const message = String(error.message || "");
    if (message && !message.startsWith("[object")) return message;
  }
  return fallback;
}

/**
 * Backend calls for the Visionaries portal (backend: app/api/routes/visionary.py).
 * Every call sends the Clerk session token; calls that change the Visionary's data return
 * the updated data and refresh the in-memory copy the screens read (store.ts).
 */
export function useVisionaryApi() {
  const { getToken } = useAuth();

  const call = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const token = await getToken();
      if (!token) throw new ApiError(401, "Your session has expired. Please sign in again.");
      return api<T>(`/visionary${path}`, token, init);
    },
    [getToken],
  );

  return useMemo(() => {
    const put = (path: string, body: unknown) =>
      call<VisionaryData>(path, { method: "PUT", body: JSON.stringify(body) }).then((data) => {
        setVisionaryData(data);
        return data;
      });

    return {
      /** Flow load: profile, idea, stage, requirements and requests. */
      load: () =>
        call<VisionaryData>("/me").then((data) => {
          setVisionaryData(data);
          return data;
        }),
      saveProfile: (profile: VisionaryProfile) => put("/profile", profile),
      saveIdea: (idea: VisionaryIdea, complete: boolean, createNew = false) =>
        put("/project/idea", { ...idea, complete, create_new: createNew }),
      saveStage: (stage: string) => put("/project/stage", { stage }),
      saveRequirements: (requirements: VisionaryRequirements, complete: boolean) =>
        put("/project/requirements", { ...requirements, complete }),
      /** View All Projects "Save". Returns the refreshed overview. */
      updateProject: (
        id: string,
        project: {
          project: string;
          idea: string;
          product: string;
          industry: string;
          stage: string;
          manufacturing_location: string;
          quantity: number;
          budget: number;
          timeline: string;
          additional_requirements: string;
        },
      ) => put(`/projects/${encodeURIComponent(id)}`, project),
      /** Undo a sent request. The manufacturer is not notified. */
      cancelRequest: (id: string) =>
        call<VisionaryData>(`/requests/${encodeURIComponent(id)}/cancel`, { method: "POST" }).then((data) => {
          setVisionaryData(data);
          return data;
        }),
      manufacturers: () => call<ManufacturerRecord[]>("/manufacturers"),
      /** Manufacturers matching the signed-in Visionary's saved requirements (filtered on the server). */
      matches: (q = "", listingsOffset = 0) =>
        call<ManufacturerMatches>(
          `/manufacturers/matches?${new URLSearchParams({ q, listings_offset: String(listingsOffset) }).toString()}`,
        ),
      manufacturer: (id: string) =>
        call<{ record: ManufacturerRecord; profile: PublicManufacturerProfile }>(
          `/manufacturers/${encodeURIComponent(id)}`,
        ),
      draft: (manufacturerId: string) =>
        call<RequestDraft | null>(`/manufacturers/${encodeURIComponent(manufacturerId)}/draft`),
      saveDraft: (manufacturerId: string, draft: Omit<RequestInput, "manufacturer_id">) =>
        call<RequestDraft | null>(`/manufacturers/${encodeURIComponent(manufacturerId)}/draft`, {
          method: "PUT",
          body: JSON.stringify(draft),
        }),
      /** AI assistant: conversation for this screen of the current project (backend-stored). */
      aiHistory: (panel: AiPanel, newProject = false) =>
        call<AiHistory>(`/ai/${panel}${newProject ? "?new_project=true" : ""}`),
      aiSend: (panel: AiPanel, body: AiSendBody) =>
        call<{ messages: AiMessage[] }>(`/ai/${panel}/messages`, { method: "POST", body: JSON.stringify(body) }),
      aiAccepted: (
        panel: AiPanel,
        body: { message_id: string; suggestion_id: string; fields: string[]; new_project?: boolean },
      ) =>
        call<{ accepted: boolean }>(`/ai/${panel}/accepted`, { method: "POST", body: JSON.stringify(body) }),
      sendRequest: (request: RequestInput) =>
        call<ManufacturingRequest>("/requests", { method: "POST", body: JSON.stringify(request) }),
    };
  }, [call]);
}
