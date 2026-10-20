/**
 * Google Calendar — OAuth and the one call the assistant makes (§34).
 *
 * ================================ READ THIS ================================
 * THE DIRECT CALENDAR API, not Google's Calendar MCP server (in developer
 * preview, 2026-10). MCP exists so a model can pick tools for itself; in this
 * product the model never picks tools — Resolve does, in code — so MCP would
 * add a moving part and no capability. Owner's call, 2026-10-20.
 *
 * WHAT IT CAN DO: create an event on the user's primary calendar. Scope
 * `calendar.events` only — no reading other calendars, no settings.
 *
 * THE REFRESH TOKEN IS ENCRYPTED AT REST (AES-GCM). The key is derived from
 * the OAuth client secret, so a database dump alone cannot reach the user's
 * calendar; rotating the secret means reconnecting, which is the right cost.
 *
 * PLAIN `fetch` AND WEB CRYPTO: no SDK, and it runs unchanged in the Supabase
 * Edge Function (Deno) and in Node.
 * ===========================================================================
 */

import { events } from "@ourglass/db";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
/**
 * SEND ONLY: OurGlass can send as the user, and cannot read, search or delete
 * their mail. A "sensitive" scope, not "restricted" — no paid security review
 * to publish. Optional at consent: without it, email drafts say to reconnect.
 */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** A meeting with no stated end — ONE declaration, shared with the clash check. */
export const DEFAULT_MEETING_MINUTES = events.DEFAULT_EVENT_MINUTES;
/** How long a connect link stays valid. */
const STATE_TTL_MS = 10 * 60 * 1000;

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Must match an "Authorized redirect URI" on the OAuth client exactly. */
  readonly redirectUri: string;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "GoogleCalendarError";
  }
}

/** The config, or null when Google Calendar is not set up (all three are needed). */
export function googleConfigFromEnv(env: Readonly<Record<string, string | undefined>>): GoogleOAuthConfig | null {
  const clientId = env["GOOGLE_CLIENT_ID"]?.trim();
  const clientSecret = env["GOOGLE_CLIENT_SECRET"]?.trim();
  const redirectUri = env["GOOGLE_REDIRECT_URI"]?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derivedKey(secret: string, purpose: string, usage: "hmac" | "aes") {
  const material = await crypto.subtle.digest("SHA-256", encoder.encode(`${purpose}:${secret}`));
  return usage === "hmac"
    ? crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
    : crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** AES-GCM, base64url(iv ‖ ciphertext). */
export async function encryptToken(plain: string, secret: string): Promise<string> {
  const key = await derivedKey(secret, "ourglass-google-token-v1", "aes");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plain)));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv, 0);
  out.set(sealed, iv.length);
  return toBase64Url(out);
}

export async function decryptToken(sealed: string, secret: string): Promise<string> {
  const key = await derivedKey(secret, "ourglass-google-token-v1", "aes");
  const bytes = fromBase64Url(sealed);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  return new TextDecoder().decode(plain);
}

/**
 * The OAuth `state`: an expiry signed with a key only the server holds. The
 * callback is reached by a redirect with no access token, so this signature
 * is what proves the flow was started by an authenticated /api/google/connect
 * — a forged callback cannot attach a stranger's Google account.
 */
export async function signState(secret: string, now = Date.now()): Promise<string> {
  const payload = `${now + STATE_TTL_MS}.${toBase64Url(crypto.getRandomValues(new Uint8Array(12)))}`;
  const key = await derivedKey(secret, "ourglass-google-state-v1", "hmac");
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return `${payload}.${toBase64Url(signature)}`;
}

export async function verifyState(state: string, secret: string, now = Date.now()): Promise<boolean> {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [expires, nonce, signature] = parts as [string, string, string];
  const key = await derivedKey(secret, "ourglass-google-state-v1", "hmac");
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(signature), encoder.encode(`${expires}.${nonce}`));
  } catch {
    return false;
  }
  return valid && Number(expires) > now;
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function authorizationUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    // openid + email: only to show WHICH account is connected in Settings.
    scope: `openid email ${CALENDAR_SCOPE} ${GMAIL_SEND_SCOPE}`,
    // Already-granted scopes carry over, so reconnecting to add Gmail keeps
    // Calendar without asking for it twice.
    include_granted_scopes: "true",
    // offline + consent: Google issues a refresh token only on a consented
    // offline grant, and without one the connection would last an hour.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function postToken(body: Record<string, string>, fetchFn: FetchFn): Promise<TokenResponse> {
  const response = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok) {
    // `invalid_grant` on refresh = the user revoked access, or Google expired a
    // testing-mode grant (7 days). Either way: reconnect in Settings.
    throw new GoogleCalendarError(
      json.error === "invalid_grant"
        ? "Google Calendar access has expired or was revoked — reconnect it in Settings."
        : `Google refused the token request (${json.error ?? response.status}).`,
      response.status,
    );
  }
  return json;
}

/** The email in an ID token, read without verifying: it came straight from Google over TLS. */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(idToken.split(".")[1] ?? ""))) as {
      email?: unknown;
    };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export async function exchangeCode(
  config: GoogleOAuthConfig,
  code: string,
  fetchFn: FetchFn = fetch,
): Promise<{ refreshToken: string; scope: string; email: string | null }> {
  const json = await postToken(
    {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    },
    fetchFn,
  );
  if (!json.refresh_token) {
    throw new GoogleCalendarError("Google did not return a refresh token — remove OurGlass's access in your Google account and connect again.");
  }
  if (!(json.scope ?? "").includes(CALENDAR_SCOPE)) {
    throw new GoogleCalendarError("Calendar access was not granted — tick the calendar permission when connecting.");
  }
  return { refreshToken: json.refresh_token, scope: json.scope ?? "", email: emailFromIdToken(json.id_token) };
}

export async function accessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
  fetchFn: FetchFn = fetch,
): Promise<string> {
  const json = await postToken(
    {
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    },
    fetchFn,
  );
  if (!json.access_token) throw new GoogleCalendarError("Google returned no access token.");
  return json.access_token;
}

/** Best-effort revoke on disconnect; a failure here must not block disconnecting. */
export async function revoke(refreshToken: string, fetchFn: FetchFn = fetch): Promise<void> {
  await fetchFn(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
    method: "POST",
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface NewCalendarEvent {
  readonly title: string;
  /** ISO-8601 instant. */
  readonly startsAt: string;
  /** ISO-8601 instant, or null for DEFAULT_MEETING_MINUTES. */
  readonly endsAt: string | null;
  /** IANA zone, so Google shows the event in the user's own time. */
  readonly timeZone: string;
}

/** Create the event on the primary calendar; returns Google's event id. */
export async function insertEvent(token: string, event: NewCalendarEvent, fetchFn: FetchFn = fetch): Promise<string> {
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + DEFAULT_MEETING_MINUTES * 60_000);
  const response = await fetchFn(EVENTS_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary: event.title,
      start: { dateTime: start.toISOString(), timeZone: event.timeZone },
      end: { dateTime: end.toISOString(), timeZone: event.timeZone },
      // Marks where it came from, so the user can tell in Google Calendar.
      description: "Added by OurGlass.",
    }),
  });
  const json = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!response.ok || !json.id) {
    throw new GoogleCalendarError(
      `Google Calendar refused the event (${response.status}${json.error?.message ? `: ${json.error.message}` : ""}).`,
      response.status,
    );
  }
  return json.id;
}

// ---------------------------------------------------------------------------
// Gmail (send only)
// ---------------------------------------------------------------------------

export function canSendEmail(scope: string): boolean {
  return scope.split(/\s+/).includes(GMAIL_SEND_SCOPE);
}

export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/** RFC 2047 encoded-word for a non-ASCII header; plain ASCII passes through. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${btoa(String.fromCharCode(...encoder.encode(value)))}?=`;
}

/** The RFC 2822 message Gmail's API takes, base64url-encoded. Exported for tests. */
export function rawMessage(email: OutgoingEmail): string {
  // A header line break would let a subject inject a second recipient (Bcc:).
  const subject = email.subject.replace(/[\r\n]+/g, " ").trim();
  // The address too: it is user-editable on the draft card.
  const to = email.to.replace(/[\r\n]+/g, "").trim();
  const message = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    email.body.replace(/\r?\n/g, "\r\n"),
  ].join("\r\n");
  return toBase64Url(encoder.encode(message));
}

/** Send as the connected user; returns Gmail's message id. */
export async function sendEmail(token: string, email: OutgoingEmail, fetchFn: FetchFn = fetch): Promise<string> {
  const response = await fetchFn(GMAIL_SEND_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: rawMessage(email) }),
  });
  const json = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!response.ok || !json.id) {
    throw new GoogleCalendarError(
      response.status === 403
        ? "Gmail sending isn't allowed yet — reconnect Google in Settings and tick the Gmail permission."
        : `Gmail refused the email (${response.status}${json.error?.message ? `: ${json.error.message}` : ""}).`,
      response.status,
    );
  }
  return json.id;
}
