import { describe, expect, it } from "vitest";
import { fakeQueryResult, type DatabaseTransaction, type ToolContext } from "@ourglass/shared";
import { CALENDAR_SCOPE, GMAIL_SEND_SCOPE } from "../integrations/google-calendar.js";
import { createSendEmailTool } from "./email-tools.js";

const config = { clientId: "id", clientSecret: "secret", redirectUri: "https://x/cb" };

/** A transaction whose google_accounts lookup returns an account with `scope`. */
function ctxWithScope(scope: string | null): ToolContext {
  const tx: DatabaseTransaction = {
    query: async (text: string) =>
      fakeQueryResult(text.includes("google_accounts") && scope !== null ? [{ refresh_token_enc: "enc", scope }] : []) as never,
  };
  return { tx, turnId: "t", seq: 0, actorKind: "user_turn" };
}

const draft = { person_id: null, to: "moorthy@example.com", subject: "Meeting moved", body: "Hi Moorthy,\n\nIt moved to 7.\n\nThanks," };

describe("send_email validation", () => {
  it("accepts a complete draft on a connection that may send", async () => {
    const tool = createSendEmailTool(config);
    const result = await tool.validate(draft, ctxWithScope(`${CALENDAR_SCOPE} ${GMAIL_SEND_SCOPE}`));
    expect(result.ok).toBe(true);
  });

  it("asks for an address rather than sending to nobody", async () => {
    const tool = createSendEmailTool(config);
    const result = await tool.validate({ ...draft, to: "" }, ctxWithScope(`${CALENDAR_SCOPE} ${GMAIL_SEND_SCOPE}`));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code)).toContain("invalid_email");
  });

  it("refuses on a connection made before the Gmail permission, saying to reconnect", async () => {
    const tool = createSendEmailTool(config);
    const result = await tool.validate(draft, ctxWithScope(CALENDAR_SCOPE));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.message).join(" ")).toMatch(/reconnect/i);
  });

  it("refuses when Google is not connected or not configured at all", async () => {
    expect((await createSendEmailTool(config).validate(draft, ctxWithScope(null))).ok).toBe(false);
    expect((await createSendEmailTool(null).validate(draft, ctxWithScope(GMAIL_SEND_SCOPE))).ok).toBe(false);
  });
});
