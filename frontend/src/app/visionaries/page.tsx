import type { Metadata } from "next";
import { VisionaryOverview } from "@/components/visionary/VisionaryOverview";

export const metadata: Metadata = {
  title: "XfactorY — Visionary",
  description:
    "Bring your product idea to life by connecting with manufacturers, resources, and the right ecosystem through XfactorY.",
};

export default function VisionaryOverviewPage() {
  return <VisionaryOverview />;
}
