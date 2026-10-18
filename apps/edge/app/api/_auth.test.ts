/**
 * The access guard, with REAL Web Crypto — nothing mocked.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_TOKEN_LENGTH,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  accessMode,
  authorize,
  clearedSessionCookie,
  createSessionValue,
  sessionCookie,
  tokenMatches,
  verifySessionValue,
} from "./_auth";

const TOKEN = "t".repeat(MIN_TOKEN_LENGTH + 8);
const OTHER = "o".repeat(MIN_TOKEN_LENGTH + 8);
const tokenEnv = { OURGLASS_ACCESS_TOKEN: TOKEN };

const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/commitments", { headers });

describe("accessMode", () => {
  it("is CLOSED with nothing configured — refuse by default", () => {
    expect(accessMode({})).toEqual({ kind: "closed" });
  });

  it("is demo only when explicitly enabled and no token is set", () => {
    expect(accessMode({ ENABLE_DEMO_ENDPOINT: "true" })).toEqual({ kind: "demo" });
    expect(accessMode({ ENABLE_DEMO_ENDPOINT: "1" })).toEqual({ kind: "closed" });
  });

  it("prefers the token over the demo flag — the more restrictive mode wins", () => {
    expect(accessMode({ ...tokenEnv, ENABLE_DEMO_ENDPOINT: "true" }).kind).toBe("token");
  });

  it("treats a short token as a misconfiguration, not as a password", () => {
    expect(accessMode({ OURGLASS_ACCESS_TOKEN: "short" }).kind).toBe("misconfigured");
  });
});

describe("authorize", () => {
  it("404s when closed and 500s when misconfigured", async () => {
    expect((await authorize(request(), {}))?.status).toBe(404);
    expect((await authorize(request(), { OURGLASS_ACCESS_TOKEN: "short" }))?.status).toBe(500);
  });

  it("lets everything through in demo mode", async () => {
    expect(await authorize(request(), { ENABLE_DEMO_ENDPOINT: "true" })).toBeNull();
  });

  it("401s an anonymous request in token mode", async () => {
    expect((await authorize(request(), tokenEnv))?.status).toBe(401);
  });

  it("accepts the right bearer token and refuses a wrong one", async () => {
    expect(await authorize(request({ authorization: `Bearer ${TOKEN}` }), tokenEnv)).toBeNull();
    expect((await authorize(request({ authorization: `Bearer ${OTHER}` }), tokenEnv))?.status).toBe(401);
    // Not a bearer scheme at all.
    expect((await authorize(request({ authorization: TOKEN }), tokenEnv))?.status).toBe(401);
  });

  it("accepts a valid session cookie among others", async () => {
    const value = await createSessionValue(TOKEN);
    const cookie = `theme=dark; ${SESSION_COOKIE}=${value}; other=1`;
    expect(await authorize(request({ cookie }), tokenEnv)).toBeNull();
  });

  it("refuses a session minted under a DIFFERENT token — rotation signs everyone out", async () => {
    const stale = await createSessionValue(OTHER);
    expect(
      (await authorize(request({ cookie: `${SESSION_COOKIE}=${stale}` }), tokenEnv))?.status,
    ).toBe(401);
  });
});

describe("sessions", () => {
  it("verify until they expire, then stop", async () => {
    const now = 1_800_000_000_000;
    const value = await createSessionValue(TOKEN, now);
    expect(await verifySessionValue(TOKEN, value, now + 1000)).toBe(true);
    expect(await verifySessionValue(TOKEN, value, now + SESSION_TTL_MS + 1)).toBe(false);
  });

  it("refuse a tampered expiry — the signature covers it", async () => {
    const now = 1_800_000_000_000;
    const [version, expires, signature] = (await createSessionValue(TOKEN, now)).split(".");
    const extended = `${version}.${Number(expires) + SESSION_TTL_MS}.${signature}`;
    expect(await verifySessionValue(TOKEN, extended, now)).toBe(false);
  });

  it("refuse garbage without throwing", async () => {
    for (const junk of ["", "v1", "v1.abc.def", "v2.9999999999999.x", "a.b.c.d"]) {
      expect(await verifySessionValue(TOKEN, junk)).toBe(false);
    }
  });

  it("set a cookie scripts cannot read and other sites cannot send", () => {
    const cookie = sessionCookie("v");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(clearedSessionCookie()).toContain("Max-Age=0");
  });
});

describe("tokenMatches", () => {
  it("matches only the exact token, including across lengths", async () => {
    expect(await tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(await tokenMatches(TOKEN.slice(1), TOKEN)).toBe(false);
    expect(await tokenMatches(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(await tokenMatches("", TOKEN)).toBe(false);
  });
});
