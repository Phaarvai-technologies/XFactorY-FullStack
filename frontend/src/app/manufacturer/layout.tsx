import type { ReactNode } from "react";
import { ManufacturerApp } from "@/components/manufacturer/ManufacturerApp";
import "@/app/manufacturer/manufacturer.css";

export default function ManufacturerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ManufacturerApp />
      {children}
    </>
  );
}
