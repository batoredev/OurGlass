/**
 * POST /api/plan/accept — put accepted plan blocks on the calendar (ROADMAP Stage 3).
 *
 *   { "blocks": [{ "kind": "task" | "nudge", "title": "...", "start": ISO, "end": ISO }] }
 *
 * A plan is a proposal; accepting it is the owner's own act, so the blocks
 * become events through `create_event` — one turn, logged, undoable from the
 * chat or Activity, never chosen by a model. The calendar is re-read HERE:
 * a block that now clashes with a meeting (or another block) is refused, so
 * an accepted plan can never double-book even if the page was stale.
 */
import { NextResponse } from "next/server";
import { cleanText } from "@ourglass/shared";
import { events } from "@ourglass/db";
import { buildToolRegistry, executeTurn } from "@ourglass/api/tools";
import { PLAN_PREFIX } from "@ourglass/api/planning";
import { authorize } from "../../_auth";
import { rejectCrossSite } from "../../_http";
import { db, localDayWindow, read, userTimeZone } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BLOCKS = 20;

interface Block {
  readonly kind: string;
  readonly title: string;
  readonly start: Date;
  readonly end: Date;
}

function parse(body: unknown): Block[] | string {
  const blocks = (body as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return "blocks must be a non-empty list.";
  if (blocks.length > MAX_BLOCKS) return `At most ${MAX_BLOCKS} blocks at once.`;
  const out: Block[] = [];
  for (const raw of blocks as Record<string, unknown>[]) {
    const kind = raw?.["kind"];
    const title = typeof raw?.["title"] === "string" ? cleanText(raw["title"] as string, 160) : "";
    const start = new Date(String(raw?.["start"]));
    const end = new Date(String(raw?.["end"]));
    if (kind !== "task" && kind !== "nudge") return "Only planned work and nudges can be accepted.";
    if (title === "") return "Every block needs a title.";
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return "Every block needs a start before its end.";
    if (end.getTime() - start.getTime() > 4 * 3_600_000) return "A block is at most four hours.";
    out.push({ kind, title, start, end });
  }
  return out;
}

const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start < b.end && b.start < a.end;

export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const crossSite = rejectCrossSite(request, { requireJson: true });
  if (crossSite) return crossSite;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const blocks = parse(body);
  if (typeof blocks === "string") return NextResponse.json({ error: blocks }, { status: 400 });

  const timeZone = await userTimeZone();
  const now = new Date();
  const { start, end } = localDayWindow(now, timeZone);
  if (blocks.some((block) => block.start < new Date(now.getTime() - 10 * 60_000) || block.end > end || block.start < start)) {
    return NextResponse.json({ error: "Blocks must be later today." }, { status: 400 });
  }
  if (blocks.some((block, i) => blocks.some((other, j) => i < j && overlaps(block, other)))) {
    return NextResponse.json({ error: "Two of those blocks overlap." }, { status: 409 });
  }
  const booked = await read((tx) => events.listBetween(tx, start, end));
  const clash = blocks.find((block) =>
    booked.some((row) => row.starts_at !== null && overlaps(block, { start: row.starts_at, end: row.ends_at ?? new Date(row.starts_at.getTime() + 30 * 60_000) })),
  );
  if (clash) {
    return NextResponse.json({ error: `"${clash.title}" now clashes with your calendar — refresh the plan.` }, { status: 409 });
  }

  const outcome = await executeTurn(
    blocks.map((block) => ({
      name: "create_event",
      input: {
        id: crypto.randomUUID(),
        title: `${PLAN_PREFIX[block.kind as "task" | "nudge"]}: ${block.title}`,
        starts_at: block.start.toISOString(),
        ends_at: block.end.toISOString(),
        notes: "From your day plan",
      },
    })),
    { db, registry: buildToolRegistry() },
  );
  if (!outcome.ok) {
    return NextResponse.json({ error: "The calendar refused those blocks.", details: outcome.errors.map((e) => e.code) }, { status: 409 });
  }
  return NextResponse.json({ turnId: outcome.turnId, added: blocks.length });
}
