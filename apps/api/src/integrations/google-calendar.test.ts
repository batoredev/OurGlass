import { describe, expect, it } from "vitest";
import {
  CALENDAR_SCOPE,
  DEFAULT_MEETING_MINUTES,
  authorizationUrl,
  decryptToken,
  encryptToken,
  exchangeCode,
  googleConfigFromEnv,
  insertEvent,
  signState,
  verifyState,
  type FetchFn,
} from "./google-calendar.js";

const config = { clientId: "id.apps.googleusercontent.com", clientSecret: "s3cret", redirectUri: "https://x.supabase.co/functions/v1/api/google/callback" };

describe("google config", () => {
  it("is null until all three settings are present", () => {
    expect(googleConfigFromEnv({})).toBeNull();
    expect(googleConfigFromEnv({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toBeNull();
    expect(googleConfigFromEnv({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", GOOGLE_REDIRECT_URI: "c" })).toEqual({
      clientId: "a",
      clientSecret: "b",
      redirectUri: "c",
    });
  });
});

describe("OAuth state", () => {
  it("verifies a state this server signed, within its lifetime", async () => {
    const state = await signState("s3cret");
    expect(await verifyState(state, "s3cret")).toBe(true);
  });

  it("refuses a state signed with another secret, tampered with, or expired", async () => {
    const state = await signState("s3cret");
    expect(await verifyState(state, "other")).toBe(false);
    const [expires, nonce, signature] = state.split(".");
    expect(await verifyState(`${Number(expires) + 1}.${nonce}.${signature}`, "s3cret")).toBe(false);
    expect(await verifyState(state, "s3cret", Date.now() + 11 * 60 * 1000)).toBe(false);
    expect(await verifyState("garbage", "s3cret")).toBe(false);
  });
});

describe("refresh token at rest", () => {
  it("round-trips, and is not readable without the secret", async () => {
    const sealed = await encryptToken("1//refresh-token", "s3cret");
    expect(sealed).not.toContain("refresh-token");
    expect(await decryptToken(sealed, "s3cret")).toBe("1//refresh-token");
    await expect(decryptToken(sealed, "other")).rejects.toBeTruthy();
  });
});

describe("authorizationUrl", () => {
  it("asks for calendar.events offline, with consent, and carries the state", () => {
    const url = new URL(authorizationUrl(config, "STATE"));
    expect(url.searchParams.get("scope")).toContain(CALENDAR_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("STATE");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  });
});

describe("exchangeCode", () => {
  const reply = (body: unknown, status = 200): FetchFn => async () => new Response(JSON.stringify(body), { status });

  it("refuses a grant without calendar access", async () => {
    await expect(
      exchangeCode(config, "code", reply({ refresh_token: "r", scope: "openid email" })),
    ).rejects.toThrow(/calendar permission/i);
  });

  it("explains an expired or revoked grant in terms of what to do", async () => {
    await expect(exchangeCode(config, "code", reply({ error: "invalid_grant" }, 400))).rejects.toThrow(/reconnect/i);
  });
});

describe("insertEvent", () => {
  it("gives a meeting with no end the default length, in the user's zone", async () => {
    let sent: { start: { dateTime: string; timeZone: string }; end: { dateTime: string } } | undefined;
    const fetchFn: FetchFn = async (_url, init) => {
      sent = JSON.parse(String(init?.body)) as typeof sent;
      return new Response(JSON.stringify({ id: "g123" }), { status: 200 });
    };
    const id = await insertEvent(
      "token",
      { title: "Meeting with Moorthy", startsAt: "2026-10-20T12:30:00.000Z", endsAt: null, timeZone: "Asia/Kolkata" },
      fetchFn,
    );
    expect(id).toBe("g123");
    expect(sent?.start.timeZone).toBe("Asia/Kolkata");
    expect(Date.parse(sent!.end.dateTime) - Date.parse(sent!.start.dateTime)).toBe(DEFAULT_MEETING_MINUTES * 60_000);
  });
});
