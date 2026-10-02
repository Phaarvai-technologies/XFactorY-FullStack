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
      saveIdea: (idea: VisionaryIdea, complete: boolean) => put("/project/idea", { ...idea, complete }),
      saveStage: (stage: string) => put("/project/stage", { stage }),
      saveRequirements: (requirements: VisionaryRequirements, complete: boolean) =>
        put("/project/requirements", { ...requirements, complete }),
      manufacturers: () => call<ManufacturerRecord[]>("/manufacturers"),
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
      sendRequest: (request: RequestInput) =>
        call<ManufacturingRequest>("/requests", { method: "POST", body: JSON.stringify(request) }),
    };
  }, [call]);
}
