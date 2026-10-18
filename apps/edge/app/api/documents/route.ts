/**
 * /api/documents — Phase 6 ingestion (docs/PHASE-6-DESIGN.md).
 *
 *   GET   the Files surface: saved documents, newest first, with their links.
 *   POST  one upload (multipart/form-data: `file`, optional `note`).
 *
 * A thin adapter, like /api/turn: authorise, refuse cross-site, bound the
 * body, check the spend cap, then hand the bytes to `ingestDocument`. Every
 * decision about the FILE — what it is, whether it is safe, what it says —
 * is made there, where it is tested.
 */
import { NextResponse } from "next/server";
import { documents, messages } from "@ourglass/db";
import { MAX_UPLOAD_BYTES } from "@ourglass/shared";
import { NoProviderConfiguredError, buildAIRouter } from "@ourglass/api/ai";
import { ingestDocument, objectStoreFromEnv } from "@ourglass/api/ingest";
import { buildToolRegistry } from "@ourglass/api/tools";
import { authorize } from "../_auth";
import { rejectCrossSite } from "../_http";
import { rejectOverLimit, turnLimits } from "../_rate-limit";
import { bootstrapUserId, db, read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Room for the multipart envelope and the note around a maximum-size file. */
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  return NextResponse.json({ documents: await read((tx) => documents.listRecent(tx, 100)) });
}

export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  // Origin check only: a multipart form is exactly what an HTML form CAN
  // send, so the JSON rule the other routes use would refuse the legitimate
  // upload. The Origin check is what refuses a foreign page (see _http.ts).
  const crossSite = rejectCrossSite(request, { requireJson: false });
  if (crossSite) return crossSite;

  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "Send the file as multipart/form-data." }, { status: 415 });
  }
  // Refused BEFORE the body is read, when the client says how big it is.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "That file is over 10 MB — too large for me to take." }, { status: 413 });
  }

  // Uploads are optional infrastructure: without storage the rest of the app
  // works, and this says why this one thing does not.
  const store = objectStoreFromEnv(process.env);
  if (!store) {
    return NextResponse.json(
      { error: "File uploads aren't set up yet (SUPABASE_URL and SUPABASE_SECRET_KEY)." },
      { status: 503 },
    );
  }

  // The same budget as a message: reading a file spends model tokens too.
  const limited = await rejectOverLimit(
    (since) => read((tx) => messages.countUserMessagesSince(tx, since)),
    turnLimits(process.env),
  );
  if (limited) return limited;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "The upload could not be read." }, { status: 400 });
  }
  const file = form.get("file");
  if (typeof file !== "object" || file === null || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ error: "No file in the upload." }, { status: 400 });
  }
  // Checked again on the real size: Content-Length is the client's claim.
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That file is over 10 MB — too large for me to take." }, { status: 413 });
  }
  const note = form.get("note");

  // No model configured is a STATE: the file is still saved, and the reply
  // says it could not be read.
  let reader: ReturnType<typeof buildAIRouter> | null;
  try {
    reader = buildAIRouter(process.env, {
      // One line per attempt, no content — the same record /api/turn logs.
      onLog: (record) => console.log(JSON.stringify({ event: "ai_request", ...record })),
    });
  } catch (error: unknown) {
    if (!(error instanceof NoProviderConfiguredError)) throw error;
    reader = null;
  }

  const result = await ingestDocument(
    {
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      note: typeof note === "string" ? note : "",
      userId: await bootstrapUserId(),
    },
    { db, registry: buildToolRegistry(), store, reader },
  );
  // 200 for every OUTCOME, refusals included: the reply is conversational and
  // the conversation shows it. Only infrastructure failures are HTTP errors.
  return NextResponse.json(result);
}
