/**
 * Pure request guards for the Route Handlers.
 *
 * Separate from `_lib.ts` on purpose: that module opens a Postgres pool, and
 * the route tests mock it to keep `pg` out of the test process. These guards
 * are the security-relevant logic, so the tests must run the REAL ones.
 */

/**
 * Refuse a cross-site request to a MUTATING route, or return null to proceed.
 *
 * CSRF is a browser attack: another site's page submits a request the victim's
 * browser authenticates. Two checks, each closing one path:
 *
 *   - `Origin`, when present, must be this request's own origin. Browsers send
 *     it on every cross-origin POST/DELETE, so a foreign page cannot hide it.
 *   - The body must be declared JSON. An HTML form cannot send
 *     `application/json`, and a cross-origin `fetch` that does triggers a
 *     preflight this app never approves.
 *
 * No `Origin` at all is allowed: that is curl or a server, not a browser a
 * victim is sitting in, and authentication (stage 12b) is what governs it.
 *
 * The frontend is a separate static site (Cloudflare Pages) calling this API
 * on Supabase, so its origin is NAMED in `ALLOWED_ORIGINS` rather than
 * inferred. Nothing else is trusted: a wildcard would hand the check back to
 * whichever page asked.
 */
export function rejectCrossSite(
  request: Request,
  options: { requireJson: boolean },
  env: Readonly<Record<string, string | undefined>> = process.env,
): Response | null {
  const origin = request.headers.get("origin");
  if (origin !== null && !isAllowedOrigin(origin, request, env)) {
    return Response.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  if (options.requireJson) {
    const type = request.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("application/json")) {
      return Response.json({ error: "Body must be application/json." }, { status: 415 });
    }
  }
  return null;
}

/**
 * The origins a browser may call this API from: the API's own, plus each
 * comma-separated entry of `ALLOWED_ORIGINS` (e.g. the Pages site's address).
 * Exact match only — no wildcards, no trailing slashes.
 */
export function isAllowedOrigin(
  origin: string,
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (origin === new URL(request.url).origin) return true;
  return allowedOrigins(env).includes(origin);
}

export function allowedOrigins(env: Readonly<Record<string, string | undefined>>): string[] {
  return (env["ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter((entry) => entry !== "");
}
