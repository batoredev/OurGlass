/**
 * `opennextjs-cloudflare build`, with the two build variables the adapter's
 * troubleshooting guide requires — set HERE rather than in a `.env` file.
 *
 * WHY A SCRIPT AND NOT `VAR=x opennextjs-cloudflare build`: that syntax is
 * POSIX-only and this repo is developed on Windows. The adapter's docs put
 * these in `.env`, which this repo cannot use for build configuration — the
 * root `.env` holds real secrets and is gitignored, so a value kept there
 * would be missing on every other machine and in CI.
 *
 * WHAT THEY DO: the Worker bundle is built with esbuild, and a package whose
 * `exports` map offers a `workerd` entry gets that entry by default. `pg`'s
 * points at a build importing `cloudflare:sockets`, which esbuild then tried to
 * resolve as a directory under node_modules, failing the build. Clearing the
 * conditions and forcing the `node` platform selects pg's ordinary Node entry,
 * whose `net` comes from the `nodejs_compat` flag wrangler.toml already sets.
 * Documented at opennext.js.org/cloudflare/troubleshooting.
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("opennextjs-cloudflare", ["build", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, WRANGLER_BUILD_CONDITIONS: "", WRANGLER_BUILD_PLATFORM: "node" },
});

process.exit(result.status ?? 1);
