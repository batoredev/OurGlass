/**
 * GET /api/messages — the conversation, so a reload does not lose it.
 *
 * §29 calls the conversation the primary surface, and until now nothing could
 * read it back: `messages` was written by every turn and never served.
 *
 * READ ONLY, like every other surface. You speak to the assistant through
 * /api/turn; this only shows what was already said. `trace` is deliberately
 * NOT returned — it carries provider names, token counts and stop reasons
 * that belong in the log, not in a browser.
 */
import { NextResponse } from "next/server";
import { messages } from "@ourglass/db";
import { authorize } from "../_auth";
import { read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;

  const asked = Number(new URL(request.url).searchParams.get("limit"));
  const limit =
    Number.isSafeInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;

  const recent = await read((tx) => messages.listRecent(tx, limit));

  return NextResponse.json({
    messages: recent.map((message) => ({
      id: message.id,
      role: message.role,
      body: message.body,
      degraded: message.degraded,
      turn_id: message.turn_id,
      t_created: message.t_created,
    })),
  });
}
