import { defineConfig } from "vitest/config";

// Unit tests only. Integration tests (*.integration.test.ts) are EXCLUDED here and
// picked up by vitest.integration.config.ts instead — mirroring apps/api's split.
//
// This exclusion is load-bearing, not cosmetic: merge-resolution.integration.test.ts
// hard-fails (does not skip) whenever `CI=true` and DATABASE_URL is unset, so that a
// silent skip in the integration job can never masquerade as a pass. But GitHub
// Actions sets CI=true in EVERY job, including this package's plain `test` script
// run from the fast, Docker-free typecheck/lint/test/build job — so without this
// exclusion the hard-fail fires there too, on a job that was never supposed to touch
// a database at all. Found by CI's own first run (docs/DECISIONS.md, Phase 1 build
// findings). Keep the two configs' include/exclude patterns as exact opposites.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "test/**/*.integration.test.ts"],
  },
});
