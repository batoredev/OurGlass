/**
 * OpenNext's Cloudflare build configuration (docs/DEPLOYMENT-DESIGN.md §6, task 4).
 *
 * NO INCREMENTAL CACHE, deliberately. The adapter's own example wires an R2
 * bucket for Next's ISR cache, and this app has nothing to put in it: every
 * page reads per-request state behind an access guard, and every route handler
 * is `dynamic = "force-dynamic"`. An R2 binding would be a resource to
 * provision, pay for and secure in order to cache nothing.
 *
 * Add one the day a page becomes statically revalidated — the override is a
 * single field (`incrementalCache`), and the caching docs are at
 * <https://opennext.js.org/cloudflare/caching>.
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
