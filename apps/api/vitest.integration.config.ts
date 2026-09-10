import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    environment: "node",
    testTimeout: 15_000,
    // fileParallelism DEFAULTS TO TRUE in Vitest — do not remove this without
    // re-reading why. Every *.integration.test.ts file here opens its own
    // pool against the SAME live DATABASE_URL (one shared Postgres, per
    // docs/PHASE-1-DESIGN.md §5's truncate-not-transaction isolation
    // strategy) and calls truncateAll in its own beforeEach. With file
    // parallelism on, Vitest runs these files concurrently in separate
    // workers, so one file's beforeEach TRUNCATE can fire between another
    // file's commit and its own read-back assertion — a genuinely raced,
    // intermittent failure, reproduced directly: a two-file timing probe
    // run through this exact config showed file B starting before file A
    // finished. This is NOT a per-test-file isolation problem (each file's
    // OWN tests are already serial via beforeEach) — it is cross-FILE
    // interference on one shared mutable resource. Serialising here is the
    // simple, honest fix; per-file schema/database isolation was considered
    // and rejected as unwarranted machinery at this suite size.
    fileParallelism: false,
  },
});
