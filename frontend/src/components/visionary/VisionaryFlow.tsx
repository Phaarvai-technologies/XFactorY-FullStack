"use client";

import { useEffect, useState } from "react";
import { ManufacturerResults } from "@/components/visionary/ManufacturerResults";
import { ManufacturingRequestForm } from "@/components/visionary/ManufacturingRequestForm";
import { StepIdea } from "@/components/visionary/StepIdea";
import { StepNeeds } from "@/components/visionary/StepNeeds";
import { StepProfile } from "@/components/visionary/StepProfile";
import { StepStage } from "@/components/visionary/StepStage";
import { StepGuide } from "@/components/visionary/StepGuide";
import { VisionaryToast, useVisionaryToast } from "@/components/visionary/FlowChrome";
import { ManufacturerProfilePage } from "@/components/visionary/ManufacturerProfilePage";
import { MyProject, RequestSubmitted } from "@/components/visionary/VisionarySlides";
import { errorMessage, useVisionaryApi } from "@/lib/visionary/api";
import { VISIONARY_SLIDE_TITLES, type VisionarySlide } from "@/lib/visionary/paths";
import {
  readSelectedManufacturerId,
  writeSelectedManufacturerId,
} from "@/lib/visionary/storage";

const SLIDE_KEY = "xy-visionary-slide";

function readSlide(): VisionarySlide {
  try {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("slide");
      if (fromUrl && fromUrl in VISIONARY_SLIDE_TITLES) return fromUrl as VisionarySlide;
      const stored = window.sessionStorage.getItem(SLIDE_KEY);
      if (stored && stored in VISIONARY_SLIDE_TITLES) return stored as VisionarySlide;
    }
  } catch {
    // Ignore storage failures.
  }
  return "step1";
}

function buildSlideUrl(targetSlide: VisionarySlide): string {
  try {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    if (targetSlide !== "step1") {
      params.set("slide", targetSlide);
    } else {
      params.delete("slide");
    }
    const query = params.toString();
    return window.location.pathname + (query ? `?${query}` : "");
  } catch {
    return "";
  }
}

export function VisionaryFlow() {
  const [ready, setReady] = useState(false);
  const [slide, setSlide] = useState<VisionarySlide>("step1");
  const [manufacturerId, setManufacturerId] = useState<string | null>(null);
  const [visit, setVisit] = useState(0);
  const [freshIdea, setFreshIdea] = useState(false);
  const toast = useVisionaryToast();
  const visionaryApi = useVisionaryApi();
  const showToast = toast.show;

  // Saved data comes from the database (GET /visionary/me) before any step renders, so a
  // refresh or a new sign-in continues with the same details.
  useEffect(() => {
    let cancelled = false;
    visionaryApi
      .load()
      .catch((error: unknown) => {
        if (!cancelled) showToast(errorMessage(error, "Couldn’t load your saved details. Please refresh."));
      })
      .finally(() => {
        if (cancelled) return;
        setManufacturerId(readSelectedManufacturerId());
        setSlide(readSlide());
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync history state on initial mount when ready
  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    try {
      const currentState = window.history.state;
      if (!currentState || currentState.slide !== slide) {
        window.history.replaceState(
          { slide, manufacturerId },
          "",
          buildSlideUrl(slide),
        );
      }
    } catch {
      // Ignore history failures.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Handle browser back and forward navigation (e.g. browser back arrow button)
  useEffect(() => {
    if (!ready || typeof window === "undefined") return;

    function onPopState(event: PopStateEvent) {
      const stateSlide = event.state?.slide as VisionarySlide | undefined;
      const targetSlide =
        (stateSlide && stateSlide in VISIONARY_SLIDE_TITLES && stateSlide) ||
        (() => {
          try {
            const params = new URLSearchParams(window.location.search);
            const querySlide = params.get("slide");
            if (querySlide && querySlide in VISIONARY_SLIDE_TITLES) {
              return querySlide as VisionarySlide;
            }
          } catch {}
          return "step1";
        })();

      setFreshIdea(false);
      setSlide(targetSlide);
      setVisit((current) => current + 1);

      try {
        window.sessionStorage.setItem(SLIDE_KEY, targetSlide);
      } catch {
        // Ignore storage failures.
      }

      const targetMid =
        event.state && "manufacturerId" in event.state
          ? event.state.manufacturerId
          : readSelectedManufacturerId();
      setManufacturerId(targetMid ?? null);
      if (targetMid) {
        writeSelectedManufacturerId(targetMid);
      }
    }

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    document.title = VISIONARY_SLIDE_TITLES[slide];
    window.scrollTo(0, 0);
    try {
      window.sessionStorage.setItem(SLIDE_KEY, slide);
    } catch {
      // Ignore storage failures.
    }
  }, [ready, slide, visit]);

  function go(next: VisionarySlide, nextManufacturerId?: string) {
    if (next === slide) return;
    if (next !== "step2") setFreshIdea(false);

    const mid =
      nextManufacturerId !== undefined
        ? nextManufacturerId
        : readSelectedManufacturerId() ?? manufacturerId;

    if (typeof window !== "undefined") {
      try {
        window.history.pushState(
          { slide: next, manufacturerId: mid },
          "",
          buildSlideUrl(next),
        );
      } catch {
        // Ignore history failures.
      }
    }

    setSlide(next);
    setVisit((current) => current + 1);
  }

  function startNewProject() {
    setFreshIdea(true);
    go("step2");
  }

  function selectManufacturer(id: string) {
    setManufacturerId(id);
    writeSelectedManufacturerId(id);
  }

  if (!ready) return null;

  return (
    <>
      {slide === "step1" ? <StepProfile onContinue={go} onToast={toast.show} /> : null}
      {slide === "step2" ? (
        <StepIdea key={freshIdea ? "new-idea" : "idea"} fresh={freshIdea} onContinue={go} onToast={toast.show} />
      ) : null}
      {slide === "step3" ? <StepStage onContinue={go} onToast={toast.show} /> : null}
      {slide === "guide" ? <StepGuide onContinue={go} onToast={toast.show} /> : null}
      {slide === "step4" ? <StepNeeds onContinue={go} onToast={toast.show} /> : null}
      {slide === "results" ? (
        <ManufacturerResults
          key={visit}
          onContinue={go}
          selectedId={manufacturerId}
          onSelect={selectManufacturer}
          onChoose={(id) => {
            selectManufacturer(id);
            go("request", id);
          }}
        />
      ) : null}
      {slide === "request" ? (
        <ManufacturingRequestForm
          key={`${manufacturerId ?? "none"}-${visit}`}
          manufacturerId={manufacturerId}
          onContinue={go}
          onToast={toast.show}
        />
      ) : null}
      {slide === "submitted" ? <RequestSubmitted key={visit} onContinue={go} /> : null}
      {slide === "project" ? (
        <MyProject key={visit} onContinue={go} onAddProject={startNewProject} onToast={toast.show} />
      ) : null}
      {slide === "manufacturer" ? <ManufacturerProfilePage key={visit} onContinue={go} /> : null}
      <VisionaryToast message={toast.message} shown={toast.shown} />
    </>
  );
}
