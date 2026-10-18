import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { securityHeaders } from "./lib/security-headers";

/**
 * Local development reads the REPO-ROOT `.env`.
 *
 * Next only loads `.env` from its own directory, and this monorepo keeps one
 * `.env` at the root — the same file the poller and the paid lanes use. Without
 * this, `pnpm dev` starts the web app with no NEXT_PUBLIC_API_URL, and every
 * page fails in a way that looks like broken code rather than missing
 * configuration.
 *
 * AN ALREADY-SET VARIABLE ALWAYS WINS, so `NEXT_PUBLIC_API_URL=… pnpm dev`
 * overrides the file rather than fighting it. On Cloudflare Pages there is no
 * file: NEXT_PUBLIC_API_URL is set in the Pages project, and this is skipped.
 * Only NEXT_PUBLIC_* values ever reach the browser bundle.
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

/** The API origin, for the CSP's connect-src (lib/security-headers.ts). */
function apiOrigin(): string | null {
  const url = process.env["NEXT_PUBLIC_API_URL"];
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * A STATIC SITE in production (Cloudflare Pages): `next build` writes plain
 * HTML/JS to `out/`, and the API is a Supabase Edge Function on its own origin
 * (NEXT_PUBLIC_API_URL). Headers then come from `out/_headers`, written by
 * scripts/write-headers.ts — a static export cannot send any itself.
 *
 * `next dev` serves the same headers directly, so the CSP a developer runs
 * under is the one that ships.
 */
export default function config(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    reactStrictMode: true,
    transpilePackages: ["@ourglass/shared"],
    ...(dev ? {} : { output: "export" as const }),
    // NO IMAGE OPTIMIZER. This app renders no `next/image` — the only asset is
    // an inline SVG icon — and a static export has no server to optimize on.
    images: { unoptimized: true },
    ...(dev
      ? {
          async headers() {
            return [{ source: "/:path*", headers: [...securityHeaders(true, apiOrigin())] }];
          },
        }
      : {}),
  };
}
