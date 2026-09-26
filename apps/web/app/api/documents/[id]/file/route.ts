/**
 * GET /api/documents/:id/file — a saved file's bytes, through the access guard.
 *
 * The bucket is private and the storage key never leaves the server, so this
 * route is the ONLY way back to a file. It serves what WE sniffed, never what
 * the uploader declared, and it treats every file as hostile content:
 *
 *   - `nosniff` + our own content type: a "PNG" cannot be run as script.
 *   - `sandbox` CSP: opened in a tab, the file gets no origin, no scripts and
 *     no access to this app's session. Set in next.config.ts, NOT here: a
 *     route's own CSP is overridden by the global rule, so writing it here
 *     looked like protection and delivered none (caught end to end).
 *   - Only images display inline; everything else downloads.
 */
import { NextResponse } from "next/server";
import { documents } from "@ourglass/db";
import { objectStoreFromEnv } from "@ourglass/api/ingest";
import { contentDisposition } from "../../../../../lib/content-disposition";
import { authorize } from "../../../_auth";
import { read } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await authorize(request);
  if (denied) return denied;

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "No such file." }, { status: 404 });

  const doc = await read((tx) => documents.getById(tx, id));
  // An undone upload is gone from the surface, so its bytes are too.
  if (!doc || doc.t_invalid !== null) return NextResponse.json({ error: "No such file." }, { status: 404 });

  const store = objectStoreFromEnv(process.env);
  if (!store) return NextResponse.json({ error: "File storage isn't set up." }, { status: 503 });
  const object = await store.get(doc.storage_key);
  if (!object) return NextResponse.json({ error: "The file is missing from storage." }, { status: 404 });

  return new Response(object.bytes, {
    headers: {
      "content-type": doc.content_type,
      "content-disposition": contentDisposition(doc.kind, doc.filename),
      "content-length": String(object.bytes.length),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
