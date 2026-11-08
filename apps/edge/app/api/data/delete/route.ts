/**
 * POST /api/data/delete — PERMANENT delete (ROADMAP Stage 0).
 *
 *   { "scope": "person",     "id": "<uuid>", "confirm": "delete" }
 *   { "scope": "document",   "id": "<uuid>", "confirm": "delete" }
 *   { "scope": "everything",                 "confirm": "delete everything" }
 *
 * Unlike Undo, this cannot be reversed: rows are removed, the action log is
 * scrubbed of them, and a file's bytes leave storage (apps/api/src/data). So
 * the request must carry the confirmation word the page asked the owner to
 * give — a stray or replayed call with the wrong body deletes nothing.
 *
 * Never a tool: no model can reach this. It is the owner's own request,
 * through the access guard and the cross-site check like every write.
 */
import { NextResponse } from "next/server";
import { deleteDocumentPermanently, deleteEverything, deletePersonPermanently } from "@ourglass/api/data";
import { objectStoreFromEnv } from "@ourglass/api/ingest";
import { authorize } from "../../_auth";
import { rejectCrossSite } from "../../_http";
import { db } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REFUSALS: Readonly<Record<string, { status: number; error: string }>> = {
  not_found: { status: 404, error: "There's nothing with that id to delete." },
  self: { status: 400, error: "You can't delete yourself — use \"Delete all my data\" in Settings to start over." },
  storage_unavailable: {
    status: 503,
    error: "File storage isn't set up, so the file's bytes can't be removed. Nothing was deleted.",
  },
  storage_failed: {
    status: 502,
    error: "File storage didn't confirm the delete. Nothing was deleted — try again in a moment.",
  },
};

export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const crossSite = rejectCrossSite(request, { requireJson: true });
  if (crossSite) return crossSite;

  let body: { scope?: unknown; id?: unknown; confirm?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const deps = { db, store: objectStoreFromEnv(process.env) };
  let result;
  if (body.scope === "everything") {
    if (body.confirm !== "delete everything") {
      return NextResponse.json({ error: 'Confirm with "delete everything".' }, { status: 400 });
    }
    result = await deleteEverything(deps);
  } else if (body.scope === "person" || body.scope === "document") {
    if (typeof body.id !== "string" || !UUID_RE.test(body.id)) {
      return NextResponse.json({ error: "id must be a UUID." }, { status: 400 });
    }
    if (body.confirm !== "delete") {
      return NextResponse.json({ error: 'Confirm with "delete".' }, { status: 400 });
    }
    result =
      body.scope === "person"
        ? await deletePersonPermanently(deps, body.id)
        : await deleteDocumentPermanently(deps, body.id);
  } else {
    return NextResponse.json({ error: 'scope must be "person", "document" or "everything".' }, { status: 400 });
  }

  if (!result.ok) {
    const refusal = REFUSALS[result.reason] ?? { status: 500, error: "Nothing was deleted." };
    return NextResponse.json({ error: refusal.error, reason: result.reason }, { status: refusal.status });
  }
  return NextResponse.json({ deleted: true, counts: result.counts, files: result.files });
}
