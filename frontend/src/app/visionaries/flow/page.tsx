import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { VisionaryFlow } from "@/components/visionary/VisionaryFlow";
import { visionarySignInHref } from "@/lib/visionary/paths";

export const metadata: Metadata = {
  title: "Let’s Start With You – X!Y",
};

export default async function VisionaryFlowPage() {
  const { userId } = await auth();
  if (!userId) redirect(visionarySignInHref());

  return <VisionaryFlow />;
}
