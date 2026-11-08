/**
 * GET /api/google/inbox — what it answers in each state (ROADMAP Stage 1c).
 * The adapters are tested against recorded responses in apps/api; this pins
 * the route: guarded, honest about what is missing, and triaged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, configMock, accountMock, listInboxMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  configMock: vi.fn(),
  accountMock: vi.fn(),
  listInboxMock: vi.fn(),
}));

vi.mock("./_lib", () => ({ read: (fn: (tx: unknown) => unknown) => fn({}) }));
vi.mock("./_auth", () => ({ authorize: authMock }));
vi.mock("@ourglass/db", () => ({
  googleAccounts: { get: accountMock },
  events: { DEFAULT_EVENT_MINUTES: 30 },
  people: { list: async () => [{ id: "p1", display_name: "Barkha", email: "barkha@example.com" }] },
}));
vi.mock("@ourglass/api/integrations", async () => {
  const real = await vi.importActual<typeof import("@ourglass/api/integrations")>("@ourglass/api/integrations");
  return {
    ...real,
    googleConfigFromEnv: configMock,
    accessToken: async () => "token",
    decryptToken: async () => "refresh",
    listInbox: listInboxMock,
  };
});

const { GET } = await import("./google/inbox/route");
const get = () => GET(new Request("http://localhost/api/google/inbox"));

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(null);
  configMock.mockReturnValue({ clientId: "c", clientSecret: "s", redirectUri: "r" });
  accountMock.mockResolvedValue({ scope: "openid https://www.googleapis.com/auth/gmail.readonly", refresh_token_enc: "x" });
});

describe("GET /api/google/inbox", () => {
  it("is behind the access guard", async () => {
    authMock.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await get()).status).toBe(401);
    expect(listInboxMock).not.toHaveBeenCalled();
  });

  it("says what is missing instead of failing", async () => {
    configMock.mockReturnValue(null);
    expect(await (await get()).json()).toEqual({ state: "not_configured", messages: [] });
    configMock.mockReturnValue({ clientId: "c", clientSecret: "s", redirectUri: "r" });
    accountMock.mockResolvedValue(null);
    expect(await (await get()).json()).toEqual({ state: "not_connected", messages: [] });
    accountMock.mockResolvedValue({ scope: "openid https://www.googleapis.com/auth/gmail.send", refresh_token_enc: "x" });
    expect(await (await get()).json()).toEqual({ state: "needs_read_permission", messages: [] });
    expect(listInboxMock).not.toHaveBeenCalled();
  });

  it("returns the inbox triaged against the people you know", async () => {
    listInboxMock.mockResolvedValue([
      { id: "m1", threadId: "t", fromName: "Barkha", fromAddress: "barkha@example.com", replyTo: null, subject: "Re: the article", snippet: "", unread: true, receivedAt: null },
    ]);
    const body = (await (await get()).json()) as { state: string; messages: { personName: string; needsReply: boolean }[] };
    expect(body.state).toBe("ok");
    expect(body.messages[0]).toMatchObject({ personName: "Barkha", needsReply: true });
  });

  it("degrades honestly when Gmail does not answer", async () => {
    listInboxMock.mockRejectedValue(new Error("network"));
    expect(await (await get()).json()).toEqual({ state: "unavailable", messages: [] });
  });
});
