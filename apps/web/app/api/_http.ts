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
 */
export function rejectCrossSite(
  request: Request,
  options: { requireJson: boolean },
): Response | null {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
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
