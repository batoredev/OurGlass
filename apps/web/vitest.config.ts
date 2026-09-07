import { defineConfig } from "vitest/config";

// Phase 0: no component tests yet — the UI is intentionally last-priority
// (see docs/EXECUTION-PLAN.md). Real component/page tests arrive with the
// Phase 5 inspection surfaces. passWithNoTests avoids a false-red CI.
export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
  },
});
