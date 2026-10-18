/**
 * The browser's side of access control, now that the API is a separate origin.
 *
 * ┌─ WHY THE TOKEN IS STORED IN THE BROWSER NOW ───────────────────────────┐
 * │ The site is static (Cloudflare Pages) and the API is a Supabase Edge   │
 * │ Function on another domain. The old HttpOnly session cookie was set by │
 * │ the API for its own origin, and a cross-site cookie is exactly what    │
 * │ browsers now refuse. So the access token is kept here and sent as     │
 * │ `Authorization: Bearer`, which the API has always accepted.            │
 * │                                                                        │
 * │ The trade-off, chosen by the owner: a script running on this origin   │
 * │ could read it. That is why the site's CSP allows scripts from 'self'   │
 * │ only, and why uploaded files are downloaded, never opened inline.      │
 * └────────────────────────────────────────────────────────────────────────┘
 */

const TOKEN_KEY = "og_access_token";

/** Fired after an action so every mounted page reloads its data. */
export const REFRESH_EVENT = "og:refresh";

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable: there is nothing to clear.
  }
}

/**
 * Where the API lives, e.g. `https://<ref>.supabase.co/functions/v1`. Baked in
 * at build time (NEXT_PUBLIC_*), so each Pages deployment names its own API.
 */
export function apiBase(): string {
  return (process.env["NEXT_PUBLIC_API_URL"] ?? "").replace(/\/+$/, "");
}

/** `fetch` against the API, with the access token attached when there is one. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(`${apiBase()}${path}`, { ...init, headers, cache: "no-store" });
}

/** Ask every page on screen to reload its data (replaces `router.refresh()`). */
export function refreshData(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}
