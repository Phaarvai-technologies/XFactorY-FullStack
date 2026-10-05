import { HowItWorksBand } from "@/components/home/HowItWorksBand";
import { PersonasSection } from "@/components/home/PersonasSection";
import { ProcessSection } from "@/components/home/ProcessSection";
import { ScopeSection } from "@/components/home/ScopeSection";
import { TrustStrip } from "@/components/home/TrustStrip";

/** Remaining landing sections below the hero, matching the reference HTML order. */
export function FeatureSections() {
  return (
    <>
      <TrustStrip />
      <PersonasSection />
      <HowItWorksBand />
      <ProcessSection />
      <ScopeSection />
    </>
  );
}
