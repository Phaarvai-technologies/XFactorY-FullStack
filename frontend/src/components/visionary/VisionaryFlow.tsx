"use client";

import { useEffect, useState } from "react";
import { ManufacturerResults } from "@/components/visionary/ManufacturerResults";
import { ManufacturingRequestForm } from "@/components/visionary/ManufacturingRequestForm";
import { StepIdea } from "@/components/visionary/StepIdea";
import { StepNeeds } from "@/components/visionary/StepNeeds";
import { StepProfile } from "@/components/visionary/StepProfile";
import { StepStage } from "@/components/visionary/StepStage";
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
    const stored = window.sessionStorage.getItem(SLIDE_KEY);
    if (stored && stored in VISIONARY_SLIDE_TITLES) return stored as VisionarySlide;
  } catch {
    // Ignore storage failures.
  }
  return "step1";
}

export function VisionaryFlow() {
  const [ready, setReady] = useState(false);
  const [slide, setSlide] = useState<VisionarySlide>("step1");
  const [manufacturerId, setManufacturerId] = useState<string | null>(null);
  const [visit, setVisit] = useState(0);
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

  function go(next: VisionarySlide) {
    setSlide(next);
    setVisit((current) => current + 1);
  }

  function selectManufacturer(id: string) {
    setManufacturerId(id);
    writeSelectedManufacturerId(id);
  }

  if (!ready) return null;

  return (
    <>
      {slide === "step1" ? <StepProfile onContinue={go} onToast={toast.show} /> : null}
      {slide === "step2" ? <StepIdea onContinue={go} onToast={toast.show} /> : null}
      {slide === "step3" ? <StepStage onContinue={go} onToast={toast.show} /> : null}
      {slide === "step4" ? <StepNeeds onContinue={go} onToast={toast.show} /> : null}
      {slide === "results" ? (
        <ManufacturerResults
          key={visit}
          onContinue={go}
          selectedId={manufacturerId}
          onSelect={selectManufacturer}
          onChoose={(id) => {
            selectManufacturer(id);
            go("request");
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
        <MyProject key={visit} onContinue={go} onToast={toast.show} />
      ) : null}
      {slide === "manufacturer" ? <ManufacturerProfilePage key={visit} onContinue={go} /> : null}
      <VisionaryToast message={toast.message} shown={toast.shown} />
    </>
  );
}
