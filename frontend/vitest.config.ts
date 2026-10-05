import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Component tests in jsdom (no browser, no backend). Clerk and Next.js navigation are
// replaced by the stand-ins in tests/mocks. Live tests (tests/live) need a running backend
// and only run with: npm run test:live
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      { find: "@clerk/nextjs", replacement: here("./tests/mocks/clerk.tsx") },
      { find: "next/navigation", replacement: here("./tests/mocks/navigation.tsx") },
      { find: /^@\//, replacement: here("./src/") },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.tsx"],
    exclude: ["tests/live/**", "node_modules/**"],
    testTimeout: 10_000,
    // The suites share module-level fetch stand-ins; run files one after another.
    fileParallelism: false,
  },
});
