// The `api` Edge Function. All logic is in apps/edge (src/router.ts); this file
// only hands requests to the bundle that `pnpm --filter @ourglass/edge build`
// writes next to it. Do not edit ourglass.js by hand — it is generated.
import { handle } from "./ourglass.js";

Deno.serve(handle);
