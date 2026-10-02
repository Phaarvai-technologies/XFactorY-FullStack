"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { XyMark } from "@/components/visionary/XyLogo";
import { VISIONARY_OVERVIEW_PATH } from "@/lib/visionary/paths";

export function FlowHeader() {
  return (
    <header className="header">
      <div className="wrap">
        <Link href={VISIONARY_OVERVIEW_PATH} className="xy-logo" aria-label="X!Y home">
          <XyMark />
          <span>X!Y</span>
        </Link>
      </div>
    </header>
  );
}

export function Progress({
  label,
  step,
}: {
  label: string;
  step: 1 | 2 | 3 | 4;
}) {
  return (
    <div className="progress" aria-label="Progress">
      <div className="progress-top">
        <span>{label}</span>
        <span>Step {step} of 4</span>
      </div>
      <div className="bars">
        <i className={step >= 1 ? "on" : undefined} />
        <i className={step >= 2 ? "on" : undefined} />
        <i className={step >= 3 ? "on" : undefined} />
        <i className={step >= 4 ? "on" : undefined} />
      </div>
    </div>
  );
}

export function VisionaryToast({ message, shown }: { message: string; shown: boolean }) {
  return (
    <div className={`toast${shown ? " show" : ""}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function useVisionaryToast(duration = 2400) {
  const [message, setMessage] = useState("");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => setShown(false), duration);
    return () => window.clearTimeout(timer);
  }, [shown, message, duration]);

  function show(next: string) {
    setMessage(next);
    setShown(true);
  }

  return { message, shown, show };
}
