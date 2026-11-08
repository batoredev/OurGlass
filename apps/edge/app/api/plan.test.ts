/**
 * POST /api/plan/accept — the route's gates (ROADMAP Stage 3). A proposed plan
 * becomes events only for the owner, same-site, for valid blocks later today
 * that clash with nothing — re-checked against the calendar at accept time.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, executeMock, listBetween } = vi.hoisted(() => ({
  authMock: vi.fn(),
  executeMock: vi.fn(),
  listBetween: vi.fn(),
}));

const NOW = new Date("2026-11-09T06:30:00.000Z");
vi.mock("./_lib", () => ({
  db: { withTransaction: vi.fn() },
  read: (fn: (tx: unknown) => unknown) => fn({}),
  userTimeZone: async () => "UTC",
  localDayWindow: () => ({ start: new Date("2026-11-09T00:00:00.000Z"), end: new Date("2026-11-10T00:00:00.000Z") }),
}));
vi.mock("./_auth", () => ({ authorize: authMock }));
vi.mock("@ourglass/db", () => ({ events: { listBetween } }));
vi.mock("@ourglass/api/tools", () => ({ buildToolRegistry: () => ({}), executeTurn: executeMock }));
vi.mock("@ourglass/api/planning", () => ({ PLAN_PREFIX: { task: "Focus", nudge: "Follow up" } }));

const { POST } = await import("./plan/accept/route");

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 9, h, m)).toISOString();
const block = (start: string, end: string, kind = "task", title = "the venue quote") => ({ kind, title, start, end });

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/plan/accept", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  authMock.mockResolvedValue(null);
  listBetween.mockResolvedValue([{ starts_at: new Date(at(10)), ends_at: new Date(at(11)) }]);
  executeMock.mockResolvedValue({ ok: true, turnId: "t1", results: [] });
});

describe("POST /api/plan/accept", () => {
  it("adds the blocks as events through create_event, in one turn", async () => {
    const response = await POST(post({ blocks: [block(at(9), at(9, 30)), block(at(11, 10), at(11, 20), "nudge", "Ask Barkha about the article")] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ turnId: "t1", added: 2 });
    const [calls] = executeMock.mock.calls[0]!;
    expect(calls.map((call: { name: string; input: { title: string } }) => [call.name, call.input.title])).toEqual([
      ["create_event", "Focus: the venue quote"],
      ["create_event", "Follow up: Ask Barkha about the article"],
    ]);
  });

  it("refuses a block that now clashes with the calendar", async () => {
    const response = await POST(post({ blocks: [block(at(10, 15), at(10, 45))] }));
    expect(response.status).toBe(409);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ blocks: [] }, "no blocks"],
    [{ blocks: [block(at(9), at(9, 30), "meeting")] }, "a meeting is not the plan's to add"],
    [{ blocks: [block(at(9, 30), at(9))] }, "an end before the start"],
    [{ blocks: [block(at(5), at(5, 30))] }, "a time already past"],
    [{ blocks: [block(at(12), at(17))] }, "a block over four hours"],
    [{ blocks: [block(at(9), at(9, 30)), block(at(9, 15), at(9, 45))] }, "two blocks that overlap"],
  ])("refuses %j (%s)", async (body) => {
    expect((await POST(post(body))).status).toBeGreaterThanOrEqual(400);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("refuses a foreign page and an unauthorised caller", async () => {
    expect((await POST(post({ blocks: [block(at(9), at(9, 30))] }, { origin: "https://evil.example" }))).status).toBe(403);
    authMock.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await POST(post({ blocks: [block(at(9), at(9, 30))] }))).status).toBe(401);
    expect(executeMock).not.toHaveBeenCalled();
  });
});
