/**
 * Writes `out/_headers` for Cloudflare Pages after `next build`.
 *
 * A static export cannot send headers itself, and Pages reads them from this
 * file instead (https://developers.cloudflare.com/pages/configuration/headers/).
 * The values come from lib/security-headers.ts — the module the tests pin —
 * plus the API's origin, which the CSP must name in `connect-src` or the
 * browser blocks every call to it.
 *
 * Run by `pnpm build` with Node's built-in TypeScript support (Node >= 24).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { securityHeaders } from "../lib/security-headers.ts";

const apiUrl = process.env["NEXT_PUBLIC_API_URL"] ?? "";
let apiOrigin: string | null = null;
if (apiUrl !== "") {
  try {
    apiOrigin = new URL(apiUrl).origin;
  } catch {
    console.error(`NEXT_PUBLIC_API_URL is not a URL: ${apiUrl}`);
    process.exit(1);
  }
} else {
  console.warn("NEXT_PUBLIC_API_URL is not set: the site's CSP will only allow same-origin API calls.");
}

const lines = ["/*", ...securityHeaders(false, apiOrigin).map((h) => `  ${h.key}: ${h.value}`), ""];
const target = resolve(import.meta.dirname, "..", "out", "_headers");
writeFileSync(target, lines.join("\n"));
console.log(`wrote ${target}${apiOrigin ? ` (API: ${apiOrigin})` : ""}`);
