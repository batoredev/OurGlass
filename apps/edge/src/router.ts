/**
 * The `api` Supabase Edge Function: one entry point, dispatching to the route
 * files under app/api exactly as Next.js did when they lived in apps/web.
 *
 * The route modules are imported UNCHANGED. Each exports `GET`/`POST`/`DELETE`
 * taking `(request, { params })`; this file only matches the path, builds
 * `params`, and adds what Next.js and next.config.ts used to add around them:
 * CORS for the Pages frontend, and the response headers below.
 *
 * Paths: Supabase serves this function at `/functions/v1/api/...`, and the
 * request the function sees starts at `/api/...`. Both are accepted so the
 * same table works locally and deployed.
 */
import * as activity from "../app/api/activity/route";
import * as commitments from "../app/api/commitments/route";
import * as documentFile from "../app/api/documents/[id]/file/route";
import * as documents from "../app/api/documents/route";
import * as entityTypeRecords from "../app/api/entity-types/[key]/records/route";
import * as entityTypes from "../app/api/entity-types/route";
import * as health from "../app/api/health/route";
import * as memories from "../app/api/memories/route";
import * as messages from "../app/api/messages/route";
import * as confirmPending from "../app/api/pending-actions/[id]/confirm/route";
import * as declinePending from "../app/api/pending-actions/[id]/decline/route";
import * as people from "../app/api/people/route";
import * as permissions from "../app/api/permissions/route";
import * as projects from "../app/api/projects/route";
import * as session from "../app/api/session/route";
import * as today from "../app/api/today/route";
import * as transcribe from "../app/api/transcribe/route";
import * as turn from "../app/api/turn/route";
import * as undo from "../app/api/undo/route";
import * as google from "../app/api/google/route";
import * as googleCallback from "../app/api/google/callback/route";
import * as googleConnect from "../app/api/google/connect/route";
import * as meetings from "../app/api/meetings/route";
import * as thoughts from "../app/api/thoughts/route";
import * as todayCheck from "../app/api/today/check/route";
import { isAllowedOrigin } from "../app/api/_http";
import { routePath } from "./route-path";

type Params = Record<string, string>;
type Handler = (request: Request, context: { params: Promise<Params> }) => Promise<Response> | Response;
type RouteModule = Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", Handler>>;

interface Route {
  readonly pattern: RegExp;
  readonly names: readonly string[];
  readonly module: RouteModule;
}

function route(path: string, module: unknown): Route {
  const names: string[] = [];
  const source = path.replace(/\[(\w+)\]/g, (_match, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}/?$`), names, module: module as RouteModule };
}

const ROUTES: readonly Route[] = [
  route("/activity", activity),
  route("/commitments", commitments),
  route("/documents/[id]/file", documentFile),
  route("/documents", documents),
  route("/entity-types/[key]/records", entityTypeRecords),
  route("/entity-types", entityTypes),
  route("/health", health),
  route("/memories", memories),
  route("/messages", messages),
  route("/pending-actions/[id]/confirm", confirmPending),
  route("/pending-actions/[id]/decline", declinePending),
  route("/people", people),
  route("/permissions", permissions),
  route("/projects", projects),
  route("/session", session),
  route("/today", today),
  route("/transcribe", transcribe),
  route("/turn", turn),
  route("/undo", undo),
  route("/google/connect", googleConnect),
  route("/google/callback", googleCallback),
  route("/google", google),
  route("/meetings", meetings),
  route("/thoughts", thoughts),
  route("/today/check", todayCheck),
];

const ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
// `apikey` and `x-client-info` are sent by Supabase's own client libraries;
// listed so a future switch to supabase-js does not fail preflight.
const ALLOWED_HEADERS = "authorization, content-type, apikey, x-client-info";

/**
 * Headers next.config.ts applied to every /api response. The page-level ones
 * (CSP for scripts, HSTS, frame options) now belong to the Pages site.
 */
function withResponseHeaders(response: Response, request: Request, path: string): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  if (/^\/documents\/[^/]+\/file\/?$/.test(path)) {
    // Same value as apps/web/lib/security-headers.ts UPLOADED_FILE_CSP: an
    // uploaded file is served with no origin at all.
    headers.set("content-security-policy", "sandbox; default-src 'none'; img-src 'self'");
  }
  const origin = request.headers.get("origin");
  if (origin !== null && isAllowedOrigin(origin, request)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-expose-headers", "content-disposition, retry-after");
  }
  headers.append("vary", "origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function handle(request: Request): Promise<Response> {
  const path = routePath(new URL(request.url).pathname);

  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin");
    if (origin === null || !isAllowedOrigin(origin, request)) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": ALLOWED_METHODS,
        "access-control-allow-headers": ALLOWED_HEADERS,
        "access-control-max-age": "600",
        vary: "origin",
      },
    });
  }

  if (path === null) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  for (const candidate of ROUTES) {
    const match = candidate.pattern.exec(path);
    if (!match) continue;
    const handler = candidate.module[request.method as "GET" | "POST" | "PATCH" | "DELETE"];
    if (!handler) {
      return withResponseHeaders(
        Response.json({ error: "Method not allowed." }, { status: 405 }),
        request,
        path,
      );
    }
    const params: Params = {};
    candidate.names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1] ?? "");
    });
    try {
      const response = await handler(request, { params: Promise.resolve(params) });
      return withResponseHeaders(response, request, path);
    } catch (error: unknown) {
      // Next.js turned an uncaught throw into a bare 500; so does this, after
      // logging it where Supabase's function logs will show it.
      console.error(`[api] ${request.method} ${path} failed:`, error);
      return withResponseHeaders(
        Response.json({ error: "Internal server error." }, { status: 500 }),
        request,
        path,
      );
    }
  }

  return withResponseHeaders(Response.json({ error: "Not found." }, { status: 404 }), request, path);
}
