import type { Metadata } from "next";
import { VisionaryOverview } from "@/components/visionary/VisionaryOverview";

export const metadata: Metadata = {
  title: "X!Y — Visionary",
  description:
    "Bring your product idea to life by connecting with manufacturers, resources, and the right ecosystem through X!Y.",
};

export default function VisionaryOverviewPage() {
  return <VisionaryOverview />;
}
