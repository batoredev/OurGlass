/**
 * The §35 control-plane routes refuse before they act.
 *
 * Every assertion that a request was refused is paired with an assertion that
 * the action was NOT reached — a 403 returned after the grant had already been
 * written would pass a status-code check alone. `_http.ts` is REAL here; only
 * the database and the api package are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, executeTurnMock, releaseMock, declineMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  executeTurnMock: vi.fn(),
  releaseMock: vi.fn(),
  declineMock: vi.fn(),
}));

vi.mock("./_lib", () => ({
  getPool: vi.fn(),
  db: { withTransaction: vi.fn() },
  read: vi.fn(),
}));

vi.mock("./_auth", () => ({ authorize: authMock }));

vi.mock("@ourglass/db", () => ({
  permissions: { listCurrentGrants: vi.fn(), listRecentPendingActions: vi.fn() },
}));

vi.mock("@ourglass/api/tools", () => ({
  executeTurn: executeTurnMock,
  buildToolRegistry: () => ({}),
}));

vi.mock("@ourglass/api/permissions", () => ({
  releasePendingAction: releaseMock,
  declinePendingAction: declineMock,
}));

const ORIGIN = "http://localhost:3000";
const params = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) };

function post(path: string, headers: Record<string, string>, body: unknown = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const sameOriginJson = { origin: ORIGIN, "content-type": "application/json" };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(null);
  executeTurnMock.mockResolvedValue({ ok: true, turnId: "t-1", results: [{}] });
  releaseMock.mockResolvedValue({ ok: true, turnId: "t-2", results: [] });
  declineMock.mockResolvedValue({ ok: true, turnId: "t-3" });
});

describe("POST /api/permissions", () => {
  it("refuses when not signed in, and writes no grant", async () => {
    authMock.mockResolvedValueOnce(Response.json({ error: "Not signed in." }, { status: 401 }));
    const { POST } = await import("./permissions/route");
    const response = await POST(post("/api/permissions", sameOriginJson));
    expect(response.status).toBe(401);
    expect(executeTurnMock).not.toHaveBeenCalled();
  });

  it("refuses a cross-site request, and writes no grant", async () => {
    const { POST } = await import("./permissions/route");
    const response = await POST(
      post("/api/permissions", { origin: "https://evil.example", "content-type": "application/json" }),
    );
    expect(response.status).toBe(403);
    expect(executeTurnMock).not.toHaveBeenCalled();
  });

  it("refuses a body not declared JSON — what an HTML form would send", async () => {
    const { POST } = await import("./permissions/route");
    const response = await POST(
      post("/api/permissions", { origin: ORIGIN, "content-type": "text/plain" }),
    );
    expect(response.status).toBe(415);
    expect(executeTurnMock).not.toHaveBeenCalled();
  });

  it("runs set_permission through the tool layer for a same-origin JSON request", async () => {
    const { POST } = await import("./permissions/route");
    const response = await POST(
      post("/api/permissions", sameOriginJson, { action_type: "forget_memory", decision: "confirm" }),
    );
    expect(response.status).toBe(200);
    expect(executeTurnMock).toHaveBeenCalledWith(
      [{ name: "set_permission", input: { action_type: "forget_memory", decision: "confirm" } }],
      expect.anything(),
    );
  });

  it("surfaces tool validation errors as a 400", async () => {
    executeTurnMock.mockResolvedValueOnce({
      ok: false,
      toolName: "set_permission",
      errors: [{ field: "action_type", code: "unknown_action_type", message: "No action." }],
    });
    const { POST } = await import("./permissions/route");
    const response = await POST(post("/api/permissions", sameOriginJson, { action_type: "x" }));
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/permissions", () => {
  it("refuses a cross-site request, and revokes nothing", async () => {
    const { DELETE } = await import("./permissions/route");
    const response = await DELETE(
      new Request(`${ORIGIN}/api/permissions?action_type=forget_memory`, {
        method: "DELETE",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(response.status).toBe(403);
    expect(executeTurnMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/pending-actions/:id/confirm", () => {
  it("refuses a cross-site confirmation, and executes nothing", async () => {
    const { POST } = await import("./pending-actions/[id]/confirm/route");
    const response = await POST(
      post("/api/pending-actions/x/confirm", {
        origin: "https://evil.example",
        "content-type": "application/json",
      }),
      params,
    );
    expect(response.status).toBe(403);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("maps each release outcome to a distinct status", async () => {
    const { POST } = await import("./pending-actions/[id]/confirm/route");
    const cases = [
      [{ ok: true, turnId: "t", results: [] }, 200],
      [{ ok: false, reason: "not_found", errors: [] }, 404],
      [{ ok: false, reason: "not_pending", errors: [] }, 409],
      [{ ok: false, reason: "invalid", errors: [] }, 422],
    ] as const;
    for (const [outcome, status] of cases) {
      releaseMock.mockResolvedValueOnce(outcome);
      const response = await POST(post("/api/pending-actions/x/confirm", sameOriginJson), params);
      expect(response.status, JSON.stringify(outcome)).toBe(status);
    }
  });
});

describe("POST /api/pending-actions/:id/decline", () => {
  it("refuses when not signed in, and declines nothing", async () => {
    authMock.mockResolvedValueOnce(Response.json({ error: "Not signed in." }, { status: 401 }));
    const { POST } = await import("./pending-actions/[id]/decline/route");
    const response = await POST(post("/api/pending-actions/x/decline", sameOriginJson), params);
    expect(response.status).toBe(401);
    expect(declineMock).not.toHaveBeenCalled();
  });
});
