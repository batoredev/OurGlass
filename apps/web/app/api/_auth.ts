/**
 * Access control for the Route Handlers — PHASE-7-PERMISSIONS-DESIGN §8 (12b).
 *
 * ================================ READ THIS ================================
 * Until this file, `ENABLE_DEMO_ENDPOINT` was the ENTIRE access control: every
 * route either served personal data to anyone or served nothing. That is
 * either no authentication or no product.
 *
 * THREE MODES, decided by the environment, most restrictive winning:
 *
 *   token    OURGLASS_ACCESS_TOKEN is set. A request must carry either
 *            `Authorization: Bearer <token>` (curl, scripts) or a session
 *            cookie issued by POST /api/session (the browser).
 *   demo     No token, ENABLE_DEMO_ENDPOINT=true. LOCAL DEVELOPMENT ONLY —
 *            open, exactly as before. wrangler.toml is tested never to set it.
 *   closed   Neither. Every guarded route 404s: refuse by default.
 *
 * A token that is set but too short is a MISCONFIGURATION and refuses with a
 * 500 naming it, rather than quietly serving behind a guessable secret.
 *
 * WHY A SHARED TOKEN AND NOT ACCOUNTS: this is a single-user internal
 * assistant — the schema has one user row. Accounts would be an identity
 * system for a population of one. Cloudflare Access can sit in front of the
 * Worker as an additional layer; this is the layer that exists without it.
 *
 * PURE WEB CRYPTO, no dependency: `crypto.subtle` is global in Node 24 and in
 * Workers, so this runs identically under `next dev` and in production.
 * ===========================================================================
 */

export const SESSION_COOKIE = "og_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_TOKEN_LENGTH = 32;

type Env = Readonly<Record<string, string | undefined>>;

export type AccessMode =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "demo" }
  | { readonly kind: "closed" }
  | { readonly kind: "misconfigured"; readonly reason: string };

export function accessMode(env: Env = process.env): AccessMode {
  const token = env["OURGLASS_ACCESS_TOKEN"];
  if (token !== undefined && token !== "") {
    if (token.length < MIN_TOKEN_LENGTH) {
      return {
        kind: "misconfigured",
        reason: `OURGLASS_ACCESS_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters; refusing to serve.`,
      };
    }
    return { kind: "token", token };
  }
  if (env["ENABLE_DEMO_ENDPOINT"] === "true") return { kind: "demo" };
  return { kind: "closed" };
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", imported, encoder.encode(message));
}

/**
 * Equality that does not leak WHERE two strings differ.
 *
 * Both sides are HMAC'd under a per-call random key first, so the byte loop
 * always runs over two fixed-length digests: neither the length nor the
 * content of the secret shapes the timing.
 */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const [left, right] = await Promise.all([hmac(key, a), hmac(key, b)]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < x.length; i += 1) difference |= x[i]! ^ y[i]!;
  return difference === 0;
}

/** Sessions are signed with a key DERIVED from the token, so rotating the token ends them all. */
async function sessionSignature(token: string, payload: string): Promise<string> {
  const sessionKey = await hmac(encoder.encode(token), "ourglass-session-v1");
  return base64url(await hmac(sessionKey, payload));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function createSessionValue(token: string, now = Date.now()): Promise<string> {
  const payload = `v1.${now + SESSION_TTL_MS}`;
  return `${payload}.${await sessionSignature(token, payload)}`;
}

export async function verifySessionValue(
  token: string,
  value: string,
  now = Date.now(),
): Promise<boolean> {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  return constantTimeEqual(parts[2]!, await sessionSignature(token, `v1.${parts[1]}`));
}

export function sessionCookie(value: string): string {
  // HttpOnly: no script can read it. SameSite=Strict: no other site's page can
  // make the browser send it. Secure: never over plain HTTP (browsers treat
  // localhost as secure, so local development still works).
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** Whether a presented token is THE token — constant time. */
export async function tokenMatches(presented: string, token: string): Promise<boolean> {
  return constantTimeEqual(presented, token);
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/**
 * Null when the request may proceed; otherwise the response to return.
 *
 * Every data route calls this FIRST — `access-guard.test.ts` fails if one
 * does not. Only `/api/health` (no data) and `/api/session` (the door) skip it.
 */
export async function authorize(request: Request, env: Env = process.env): Promise<Response | null> {
  const mode = accessMode(env);
  switch (mode.kind) {
    case "closed":
      return Response.json({ error: "Not enabled." }, { status: 404 });
    case "misconfigured":
      return Response.json({ error: mode.reason }, { status: 500 });
    case "demo":
      return null;
    case "token": {
      const bearer = request.headers.get("authorization");
      if (bearer?.startsWith("Bearer ") && (await tokenMatches(bearer.slice(7), mode.token))) {
        return null;
      }
      const session = cookieValue(request, SESSION_COOKIE);
      if (session !== null && (await verifySessionValue(mode.token, session))) return null;
      return Response.json({ error: "Not signed in." }, { status: 401 });
    }
  }
}
