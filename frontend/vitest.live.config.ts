import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Live tests: the real admin portal / manufacturer bell against a running backend on :8000
// with a TEST database. Needs ADMIN_TEST_PASSWORD (and MFR_TOKEN for the notification test);
// a test without its variables is skipped. Run: npm run test:live
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
    include: ["tests/live/**/*.test.tsx"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
