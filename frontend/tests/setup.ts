import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no scrolling; the dashboard calls window.scrollTo when it changes panels.
window.scrollTo = () => undefined;

afterEach(() => cleanup());
