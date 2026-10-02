import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./visionary.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--xy-inter",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--xy-jakarta",
});

export default function VisionaryLayout({ children }: { children: ReactNode }) {
  return <div className={`xy-visionary ${inter.variable} ${jakarta.variable}`}>{children}</div>;
}
