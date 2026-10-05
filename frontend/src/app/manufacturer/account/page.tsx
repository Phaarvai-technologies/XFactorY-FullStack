import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { manufacturerCreateAccountHref } from "@/lib/auth/manufacturerAccess";

export const metadata: Metadata = {
  title: "X!Y — Manufacturer Profile Setup",
};

export default async function ManufacturerAccountPage() {
  const { userId } = await auth();

  // Profile setup comes after Clerk auth — send signed-out users to Create Account.
  if (!userId) {
    redirect(manufacturerCreateAccountHref());
  }

  return null;
}
