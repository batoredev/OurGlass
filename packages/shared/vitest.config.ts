import { defineConfig } from "vitest/config";

/**
 * SCOPED TO `src`, and that is load-bearing rather than tidiness.
 *
 * ================================ READ THIS ================================
 * This package had no vitest config at all, so vitest used its default
 * include — which matched `dist` as well. `pnpm build:libs` compiles the test
 * files alongside everything else, so every test in this package RAN TWICE:
 * once from `src/*.test.ts` and once from the emitted `dist/*.test.js`. The
 * suite reported 44 tests where there are 22.
 *
 * Double-counting was the harmless half. The real defect is that `dist` is a
 * BUILD ARTIFACT and nothing prunes it: delete a test from `src` and its
 * compiled copy keeps passing from `dist` until someone happens to clean.
 * Green would then mean "a stale build still agrees with itself".
 *
 * That is the same stale-`dist` family as the CI failure already recorded in
 * this repo, where `build:libs` did not build `@ourglass/api` and a leftover
 * `dist/` masked it locally while CI could not resolve the module.
 *
 * `apps/api` and `packages/db` were never exposed: both name an explicit
 * `include`. This file brings the third package in line.
 * ===========================================================================
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "dist/**"],
  },
});
