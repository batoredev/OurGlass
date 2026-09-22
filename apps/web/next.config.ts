import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

/**
 * Local development reads the REPO-ROOT `.env`.
 *
 * Next only loads `.env` from its own directory, and this monorepo keeps one
 * `.env` at the root — the same file the poller and the paid lanes use. Without
 * this, `pnpm dev` starts the web app with no DATABASE_URL and no provider key,
 * and every page fails in a way that looks like broken code rather than missing
 * configuration.
 *
 * AN ALREADY-SET VARIABLE ALWAYS WINS, so `OURGLASS_ACCESS_TOKEN=… pnpm dev`
 * overrides the file rather than fighting it. In production there is no file:
 * Workers supplies secrets, and this is skipped.
 *
 * Deliberately not a dependency and not a second copy of the file. A duplicated
 * `.env` under `apps/web` would be one more place for a real key to be copied
 * into, in a PUBLIC repository.
 */
function loadRootEnv(): void {
  const file = resolve(process.cwd(), "../../.env");
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    const raw = trimmed.slice(eq + 1).trim();
    // Strip one layer of surrounding quotes, as dotenv-style files use them.
    process.env[key] =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
  }
}

loadRootEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ourglass/shared"],
  // Every route, pages and /api alike. See lib/security-headers.ts for what
  // the CSP does and — stated there on purpose — does not do.
  async headers() {
    return [
      { source: "/:path*", headers: [...securityHeaders(process.env.NODE_ENV !== "production")] },
    ];
  },
};

export default nextConfig;
