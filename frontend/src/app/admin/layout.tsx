import type { ReactNode } from "react";
// Reuses the Manufacturer site's XY styles (tokens, buttons, inputs, cards, badges, modal)
// and adds the admin layout on top. Both are scoped, so no other page is affected.
import "@/app/manufacturer/manufacturer.css";
import "@/app/admin/admin.css";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
