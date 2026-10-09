"use client";

import { useEffect } from "react";

export function HowItWorksHashScroll() {
  useEffect(() => {
    const hash = window.location.hash;
    if (hash !== "#how-it-works" && hash !== "#explore") return;

    const align = () => {
      const section = document.getElementById(hash.slice(1));
      if (!section) return;
      const header = document.querySelector(".site-header");
      const offset = header instanceof HTMLElement ? header.getBoundingClientRect().height : 0;
      if (Math.abs(section.getBoundingClientRect().top - offset) < 8) return;
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    align();
    const retry = window.setTimeout(align, 250);
    return () => window.clearTimeout(retry);
  }, []);

  return null;
}
