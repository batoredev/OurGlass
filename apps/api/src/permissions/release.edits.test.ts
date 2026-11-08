import { describe, expect, it, vi } from "vitest";

const { executeTurnMock, getPendingMock, recordEditMock } = vi.hoisted(() => ({
  executeTurnMock: vi.fn(),
  getPendingMock: vi.fn(),
  recordEditMock: vi.fn(),
}));
vi.mock("../tools/executor.js", () => ({ executeTurn: executeTurnMock }));
vi.mock("@ourglass/db", () => ({
  permissions: { getPendingAction: getPendingMock, markPendingActionFailed: vi.fn() },
  sentEmails: { recordDraftEdit: recordEditMock },
}));

const PERSON = "11111111-1111-4111-8111-111111111111";
const deps = { db: { withTransaction: (fn: (tx: unknown) => unknown) => fn({}) }, registry: {} } as never;

describe("releasing an email draft with the card's edits", () => {
  it("sends what the user edited, and remembers a newly typed address first", async () => {
    getPendingMock.mockResolvedValue({
      calls: [{ name: "send_email", input: { person_id: PERSON, to: "", subject: "Draft", body: "Draft body" } }],
    });
    executeTurnMock.mockResolvedValue({ ok: true, turnId: "t", results: [null, null, { messageId: "m" }] });
    const { releasePendingAction } = await import("./release.js");

    await releasePendingAction(deps, "p", { to: "moorthy@example.com", subject: "Edited", body: "Edited body" });

    const calls = executeTurnMock.mock.calls[0]![0] as { name: string; input: Record<string, unknown> }[];
    expect(calls.map((c) => c.name)).toEqual(["release_pending_action", "set_person_email", "send_email"]);
    expect(calls[1]!.input).toEqual({ person_id: PERSON, email: "moorthy@example.com" });
    expect(calls[2]!.input).toMatchObject({ to: "moorthy@example.com", subject: "Edited", body: "Edited body" });
  });

  it("keeps a failed draft pending, so a mistyped address can be fixed and sent again", async () => {
    getPendingMock.mockResolvedValue({ calls: [{ name: "send_email", input: { to: "" } }] });
    executeTurnMock.mockResolvedValue({ ok: false, toolName: "send_email", errors: [{ code: "invalid_email", message: "x" }] });
    const db = await import("@ourglass/db");
    const { releasePendingAction } = await import("./release.js");

    const outcome = await releasePendingAction(deps, "p", { to: "nope" });
    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
    expect(db.permissions.markPendingActionFailed).not.toHaveBeenCalled();
  });

  it("records how many words were changed before sending — Stage 4's measure", async () => {
    getPendingMock.mockResolvedValue({
      calls: [{ name: "send_email", input: { person_id: PERSON, to: "b@example.com", subject: "s", body: "Hi Barkha, the meeting moved to 4" } }],
    });
    executeTurnMock.mockResolvedValue({ ok: true, turnId: "t", results: [null, { messageId: "gmail-1" }] });
    const { releasePendingAction } = await import("./release.js");

    await releasePendingAction(deps, "p", { body: "Hi Barkha, the call moved to 5" });
    expect(recordEditMock).toHaveBeenCalledWith({}, "gmail-1", { distance: 2, draftWords: 7 });

    recordEditMock.mockClear();
    await releasePendingAction(deps, "p");
    expect(recordEditMock).toHaveBeenCalledWith({}, "gmail-1", { distance: 0, draftWords: 7 });
  });

  it("never fails a send because the measure could not be recorded", async () => {
    getPendingMock.mockResolvedValue({ calls: [{ name: "send_email", input: { to: "b@example.com", subject: "s", body: "x" } }] });
    executeTurnMock.mockResolvedValue({ ok: true, turnId: "t", results: [null, { messageId: "gmail-2" }] });
    recordEditMock.mockRejectedValueOnce(new Error("database went away"));
    const { releasePendingAction } = await import("./release.js");
    await expect(releasePendingAction(deps, "p")).resolves.toMatchObject({ ok: true });
  });
});
