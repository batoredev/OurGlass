/**
 * Bundles the API and the reminder pass into the two Supabase Edge Functions.
 *
 *   src/router.ts    -> supabase/functions/api/ourglass.js
 *   src/reminders.ts -> supabase/functions/reminders/ourglass.js
 *
 * ONE FILE PER FUNCTION, with every dependency inside it (pg, the AI SDKs,
 * chrono-node...). The Edge runtime is Deno, and a self-contained bundle means
 * nothing is resolved from npm at deploy time: what was tested is what runs.
 *
 * The banner gives the bundle what Node code expects and Deno provides only
 * through `node:` modules: a `require` for the CommonJS packages inside it
 * (pg is one), and the `process` and `Buffer` globals. Without the `require`
 * shim, esbuild's ESM output throws "Dynamic require of ... is not supported"
 * on the first `require("events")`.
 *
 * Prerequisite: `pnpm run build:libs` at the repo root, because @ourglass/api
 * and friends resolve to their built dist/.
 */
import { build } from "esbuild";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Deno resolves Node built-ins only with the `node:` prefix; a bare
 * `import "module"` (as some bundled packages write it) is read as a relative
 * path and fails at load. Rewrite every bare built-in to its `node:` form.
 */
const nodePrefix = {
  name: "node-prefix",
  setup(b) {
    const bare = new RegExp(`^(${builtinModules.map((m) => m.replace(/[/]/g, "\\/")).join("|")})$`);
    b.onResolve({ filter: bare }, (args) => ({ path: `node:${args.path}`, external: true }));
  },
};

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const repoRoot = path.resolve(appRoot, "..", "..");

const banner = [
  'import { createRequire as __ogCreateRequire } from "node:module";',
  'import __ogProcess from "node:process";',
  'import { Buffer as __ogBuffer } from "node:buffer";',
  "const require = __ogCreateRequire(import.meta.url);",
  // pg's Pool reads `global.Promise`; Deno has only `globalThis`.
  "globalThis.global ??= globalThis;",
  "globalThis.process ??= __ogProcess;",
  "globalThis.Buffer ??= __ogBuffer;",
].join("\n");

const entries = [
  { entry: "src/router.ts", out: "supabase/functions/api/ourglass.js" },
  { entry: "src/reminders.ts", out: "supabase/functions/reminders/ourglass.js" },
];

for (const { entry, out } of entries) {
  await build({
    entryPoints: [path.join(appRoot, entry)],
    outfile: path.join(repoRoot, out),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    // Optional native addon pg probes for and never needs.
    external: ["pg-native"],
    alias: { "next/server": path.join(appRoot, "src", "next-server-shim.ts") },
    banner: { js: banner },
    plugins: [nodePrefix],
    legalComments: "none",
    // Minified: unminified, the `api` bundle (5.2 MB) was refused by Supabase's
    // deploy endpoint with 413. keepNames because errors are told apart by
    // class name and `.name` in places, and those must survive.
    minify: true,
    keepNames: true,
    logLevel: "info",
  });
}
