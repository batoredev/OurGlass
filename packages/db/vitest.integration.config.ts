import { defineConfig } from "vitest/config";

// Companion to vitest.config.ts, mirroring apps/api's split. Only this config picks
// up *.integration.test.ts. `test:integration` runs vitest with THIS config
// explicitly, so the merge-resolution suite's CI=true-without-DATABASE_URL hard-fail
// only ever fires here — the one job that is supposed to have a live Postgres.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.integration.test.ts"],
    testTimeout: 15_000,
    // Only one integration file lives here today, so fileParallelism has no
    // effect yet — but the identical setting in apps/api/vitest.integration
    // .config.ts exists because a SECOND integration file there raced
    // against a shared live DATABASE_URL (both truncateAll in beforeEach,
    // Vitest running the files concurrently by default). Set the same way
    // here pre-emptively: the moment this directory gains a second
    // *.integration.test.ts file, it inherits that exact hazard silently
    // unless this is already off. Cheap now; a real, hard-to-reproduce flake
    // later if skipped.
    fileParallelism: false,
  },
});
