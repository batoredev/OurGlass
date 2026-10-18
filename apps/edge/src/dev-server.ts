/**
 * Local development only: serves the same router the `api` Edge Function
 * runs, on http://localhost:8787, under Node (`pnpm dev`).
 *
 * Production never runs this file. It exists so `pnpm dev` works without the
 * Supabase CLI or Docker; the deployed path is supabase/functions/api.
 * Point the web app at it with NEXT_PUBLIC_API_URL=http://localhost:8787.
 */
import { createServer, type IncomingMessage } from "node:http";
import { handle } from "./router";

const PORT = Number(process.env["EDGE_DEV_PORT"] ?? 8787);
// The dev web app runs on :3000; allow it unless told otherwise.
process.env["ALLOWED_ORIGINS"] ??= "http://localhost:3000";

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }
  const method = req.method ?? "GET";
  return new Request(`http://localhost:${PORT}${req.url ?? "/"}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
}

createServer((req, res) => {
  void (async () => {
    try {
      const response = await handle(await toRequest(req));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error: unknown) {
      console.error("[edge-dev]", error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error." }));
    }
  })();
  // LOOPBACK ONLY. `.env` may point at the real database; binding every
  // interface would serve it to the whole network.
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[edge-dev] API on http://localhost:${PORT}/api/...`);
});
