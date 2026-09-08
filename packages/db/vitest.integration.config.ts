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
  },
});
