/**
 * THE DEPLOYED WORKER'S ENTRY POINT: OpenNext's generated `fetch`, plus OUR
 * `scheduled`.
 *
 * ┌─ WHY THIS FILE EXISTS ─────────────────────────────────────────────────┐
 * │ `.open-next/worker.js` exports ONLY `fetch`. Pointing wrangler at it    │
 * │ directly — which is what every OpenNext quickstart does — would deploy  │
 * │ an app whose cron trigger fires into a Worker with no `scheduled`       │
 * │ export: reminders would silently never fire, and the routes would look  │
 * │ perfectly healthy. So `main` points here instead, and this re-exports   │
 * │ the generated handler unchanged.                                       │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ EXCLUDED FROM `tsc` (see tsconfig.json). The import below resolves to a
 * BUILD ARTIFACT that does not exist until `opennextjs-cloudflare build` has
 * run, so typechecking this file would fail on a clean clone and in CI. It is
 * kept to the thinnest possible wiring for that reason — everything with logic
 * in it lives in `scheduled.ts`, which IS typechecked and unit-tested.
 * Wrangler still compiles this file, so a syntax or export mistake fails the
 * build rather than reaching production.
 */
import { default as generated } from "../.open-next/worker.js";
import scheduledWorker from "./scheduled.js";

/** Named before export, as in `scheduled.ts`: Cloudflare reads the handlers off
 * whatever the module's default happens to be, and the lint rule against
 * anonymous default exports keeps it inspectable. */
const worker = {
  fetch: generated.fetch,
  scheduled: scheduledWorker.scheduled,
};

export default worker;
