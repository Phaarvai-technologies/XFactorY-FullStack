import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminRoot } from "@/components/admin/AdminRoot";

export const metadata: Metadata = {
  title: "X!Y — Admin Dashboard",
  robots: { index: false, follow: false },
};

/** /admin and every /admin/... screen. Access is checked by the API (admins only). */
export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminRoot />
    </Suspense>
  );
}
