/**
 * /api/documents — the route's own refusals, before any file handling.
 *
 * What the pipeline does with a file is tested where it lives
 * (apps/api/src/ingest). This pins what the ROUTE owns: the order of its
 * gates, and that each one refuses without reading the body or touching
 * storage. The access guard's verdict is mocked; _auth.test.ts tests it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, ingestMock, storeFromEnvMock, countMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  ingestMock: vi.fn(),
  storeFromEnvMock: vi.fn(),
  countMock: vi.fn(),
}));

vi.mock("./_lib", () => ({
  db: { withTransaction: vi.fn() },
  read: (fn: (tx: unknown) => unknown) => fn({}),
  bootstrapUserId: async () => "user-1",
}));
vi.mock("./_auth", () => ({ authorize: authMock }));
vi.mock("@ourglass/db", () => ({
  documents: { listRecent: vi.fn(async () => []) },
  messages: { countUserMessagesSince: countMock },
}));
vi.mock("@ourglass/api/ingest", () => ({ ingestDocument: ingestMock, objectStoreFromEnv: storeFromEnvMock }));
vi.mock("@ourglass/api/tools", () => ({ buildToolRegistry: () => ({}) }));
vi.mock("@ourglass/api/ai", () => ({
  NoProviderConfiguredError: class NoProviderConfiguredError extends Error {},
  buildAIRouter: () => ({ read: vi.fn() }),
}));

const { POST } = await import("./documents/route");

function upload(init: { headers?: Record<string, string>; body?: BodyInit } = {}) {
  return new Request("http://localhost/api/documents", { method: "POST", ...init });
}

function multipart(file: File, note?: string): Request {
  const form = new FormData();
  form.append("file", file);
  if (note) form.append("note", note);
  return new Request("http://localhost/api/documents", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(null);
  storeFromEnvMock.mockReturnValue({ put: vi.fn(), get: vi.fn() });
  countMock.mockResolvedValue(0);
  ingestMock.mockResolvedValue({ outcome: "saved", documentId: "d1", turnId: "t1", reply: "Saved." });
});

describe("POST /api/documents", () => {
  it("refuses a foreign page before anything else", async () => {
    const response = await POST(
      upload({ headers: { origin: "https://evil.example", "content-type": "multipart/form-data; boundary=x" } }),
    );
    expect(response.status).toBe(403);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("refuses anything that is not multipart", async () => {
    const response = await POST(upload({ headers: { "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(415);
  });

  it("refuses an oversized body from its declared length, without reading it", async () => {
    const response = await POST(
      upload({ headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(20 * 1024 * 1024) } }),
    );
    expect(response.status).toBe(413);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("says plainly when storage is not configured, instead of a 500", async () => {
    storeFromEnvMock.mockReturnValue(null);
    const response = await POST(multipart(new File(["hello"], "notes.txt")));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toContain("SUPABASE_SECRET_KEY");
  });

  it("counts an upload against the spend cap", async () => {
    countMock.mockResolvedValue(10_000);
    const response = await POST(multipart(new File(["hello"], "notes.txt")));
    expect(response.status).toBe(429);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("hands the bytes, name and note to the pipeline and returns its outcome", async () => {
    const response = await POST(multipart(new File(["hello"], "notes.txt"), "the Hult notes"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "saved", documentId: "d1", turnId: "t1", reply: "Saved." });
    const [request] = ingestMock.mock.calls[0]!;
    expect(request).toMatchObject({ filename: "notes.txt", note: "the Hult notes", userId: "user-1" });
    expect([...(request as { bytes: Uint8Array }).bytes]).toEqual([...new TextEncoder().encode("hello")]);
  });
});
