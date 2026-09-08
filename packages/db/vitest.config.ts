import { defineConfig } from "vitest/config";

// Unit tests run everywhere. Integration tests (*.integration.test.ts) skip
// themselves when DATABASE_URL is unset, keeping the fast lane Docker-free per
// docs/PHASE-1-DESIGN.md §5 — a skip is expected locally, a FAILURE would be wrong
// in CI's integration job, which does set DATABASE_URL.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
