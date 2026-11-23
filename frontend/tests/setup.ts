import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { BACKEND_WAKE } from "@/lib/auth/registration";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no scrolling; the dashboard calls window.scrollTo when it changes panels.
if (typeof window !== "undefined") window.scrollTo = () => undefined; // (node-environment tests have no window)

// Tests get the backend's answer at once: no waiting for a sleeping server and no wake-up
// request when a page opens (the tests of that waiting turn it on themselves).
function noWaking() {
  BACKEND_WAKE.deadlineMs = 0;
  BACKEND_WAKE.prewarm = false;
}
noWaking();

afterEach(() => {
  cleanup();
  noWaking();
});
