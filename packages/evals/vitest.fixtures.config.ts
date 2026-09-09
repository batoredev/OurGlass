import { defineConfig } from "vitest/config";

/**
 * The free lane: every test except the live one. Runs on every PR.
 * `*.live.test.ts` is excluded because it makes paid model calls; it has its own
 * config and is only ever run by an explicit `pnpm test:live`.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.live.test.ts"],
    environment: "node",
  },
});
