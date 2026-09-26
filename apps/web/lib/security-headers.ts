/**
 * Response headers for every route — Track P2 of docs/REMAINING-EXECUTION-PLAN.md.
 *
 * A Cloudflare Worker is a public URL the moment it deploys, and until this
 * file `next.config.ts` set no security headers at all. Kept out of
 * next.config.ts so a test can pin them without importing a module that
 * loads `.env` into the process.
 *
 * ┌─ WHAT THIS CSP DOES NOT DO, STATED SO NOBODY ASSUMES IT ────────────────┐
 * │ script-src allows 'unsafe-inline'. Next.js bootstraps hydration with    │
 * │ inline <script> tags; without a per-request nonce, blocking inline      │
 * │ scripts blocks the app. A nonce CSP needs dynamic rendering plus a      │
 * │ proxy that mints the nonce — a real change, recorded as follow-up.      │
 * │ What this policy DOES stop: loading script, style, font, image or       │
 * │ fetch from any other origin; being framed (clickjacking); <base> and    │
 * │ form-action hijacks; plugins. Everything the app uses is same-origin —  │
 * │ fonts are self-hosted by next/font — so nothing legitimate is blocked.  │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

export interface Header {
  readonly key: string;
  readonly value: string;
}

export function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    // Dev only: React Refresh evaluates code, and HMR talks over a websocket.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline style ATTRIBUTES (style={{…}}) need this; they cannot carry code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * The policy for a SERVED UPLOAD (GET /api/documents/:id/file, Phase 6).
 *
 * Opened in a tab, an uploaded file gets no origin (`sandbox`), no scripts
 * and nothing to load but itself. It must be applied as a LATER header rule
 * in next.config.ts than the global one: a route handler's own CSP header is
 * overridden by the config's, which the Phase 6 end-to-end test caught — the
 * route set this policy and the browser never received it.
 */
export const UPLOADED_FILE_CSP = "sandbox; default-src 'none'; img-src 'self'";

export function securityHeaders(dev: boolean): readonly Header[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(dev) },
    // Browsers ignore HSTS received over plain http, so this is inert on
    // localhost and binding on the deployed https origin. No `preload`: that
    // is a one-way submission to browser vendors, and an owner decision.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Legacy twin of frame-ancestors, for browsers that predate CSP level 2.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // microphone=(self): Stage 15's voice input dictates into the composer.
    // Everything else the app never uses is switched off.
    { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)" },
  ];
}
