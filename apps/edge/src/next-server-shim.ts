/**
 * Stands in for `next/server` when the route files are bundled for the
 * Supabase Edge Function (scripts/build-edge.mjs aliases the import here).
 *
 * The routes were written as Next.js Route Handlers and use exactly one thing
 * from Next: `NextResponse` — constructed directly (session/route.ts) and via
 * `NextResponse.json`. Both are plain Web `Response` behaviour, so a subclass
 * that adds nothing is enough. If a route ever imports more from
 * `next/server`, the bundle fails to build rather than failing at request time.
 */
export class NextResponse extends Response {
  static override json(body: unknown, init?: ResponseInit): Response {
    return Response.json(body, init);
  }
}
