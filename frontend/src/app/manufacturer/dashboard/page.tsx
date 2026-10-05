import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { MANUFACTURER_OVERVIEW_PATH } from "@/lib/auth/manufacturerAccess";

export const metadata: Metadata = {
  title: "X!Y — Manufacturer Dashboard",
};

export default async function ManufacturerDashboardPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect(MANUFACTURER_OVERVIEW_PATH);
  }

  return null;
}
