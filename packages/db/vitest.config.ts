import { defineConfig } from "vitest/config";

// Phase 0: this package is a placeholder (see src/index.ts). Real tests
// arrive in Phase 1 alongside the bitemporal schema and migrations.
// passWithNoTests avoids a false-red CI until then.
export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
  },
});
