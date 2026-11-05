/**
 * /api/data/delete and /api/data/export — the routes' own gates.
 *
 * What a purge removes is tested against Postgres where it lives
 * (apps/api/src/data). This pins what the ROUTE owns: nothing is deleted
 * without the access guard, a same-site JSON request, a valid scope and id,
 * and the exact confirmation word.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, person, document, everything, exportMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  person: vi.fn(),
  document: vi.fn(),
  everything: vi.fn(),
  exportMock: vi.fn(),
}));

vi.mock("./_lib", () => ({ db: { withTransaction: vi.fn() } }));
vi.mock("./_auth", () => ({ authorize: authMock }));
vi.mock("@ourglass/api/ingest", () => ({ objectStoreFromEnv: () => null }));
vi.mock("@ourglass/api/data", () => ({
  deletePersonPermanently: person,
  deleteDocumentPermanently: document,
  deleteEverything: everything,
  exportEverything: exportMock,
}));

const { POST } = await import("./data/delete/route");
const { GET } = await import("./data/export/route");

const ID = "6f1fa3cb-3d16-45bf-9105-c16f89c611aa";

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/data/delete", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(null);
  person.mockResolvedValue({ ok: true, counts: { people: 1 }, files: 0 });
  document.mockResolvedValue({ ok: true, counts: { documents: 1 }, files: 1 });
  everything.mockResolvedValue({ ok: true, counts: {}, files: 3 });
});

describe("POST /api/data/delete", () => {
  it("is behind the access guard", async () => {
    authMock.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await POST(post({ scope: "everything", confirm: "delete everything" }))).status).toBe(401);
    expect(everything).not.toHaveBeenCalled();
  });

  it("refuses a foreign page", async () => {
    const response = await POST(post({ scope: "everything", confirm: "delete everything" }, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(everything).not.toHaveBeenCalled();
  });

  it.each([
    [{ scope: "everything" }, "no confirmation"],
    [{ scope: "everything", confirm: "delete" }, "the wrong word"],
    [{ scope: "person", id: ID }, "a person with no confirmation"],
    [{ scope: "person", id: ID, confirm: "yes" }, "a person with the wrong word"],
    [{ scope: "person", id: "barkha", confirm: "delete" }, "an id that is not a UUID"],
    [{ scope: "messages", confirm: "delete" }, "an unknown scope"],
  ] as [Record<string, unknown>, string][])("deletes nothing for %j (%s)", async (body) => {
    expect((await POST(post(body))).status).toBe(400);
    expect(person).not.toHaveBeenCalled();
    expect(document).not.toHaveBeenCalled();
    expect(everything).not.toHaveBeenCalled();
  });

  it("deletes one person, one file, or everything, given the exact word", async () => {
    expect((await POST(post({ scope: "person", id: ID, confirm: "delete" }))).status).toBe(200);
    expect(person).toHaveBeenCalledWith(expect.anything(), ID);
    expect((await POST(post({ scope: "document", id: ID, confirm: "delete" }))).status).toBe(200);
    expect(document).toHaveBeenCalledWith(expect.anything(), ID);
    const response = await POST(post({ scope: "everything", confirm: "delete everything" }));
    expect(await response.json()).toEqual({ deleted: true, counts: {}, files: 3 });
  });

  it("says why when nothing was deleted", async () => {
    person.mockResolvedValue({ ok: false, reason: "self" });
    const self = await POST(post({ scope: "person", id: ID, confirm: "delete" }));
    expect(self.status).toBe(400);
    document.mockResolvedValue({ ok: false, reason: "storage_failed" });
    const storage = await POST(post({ scope: "document", id: ID, confirm: "delete" }));
    expect(storage.status).toBe(502);
    expect(((await storage.json()) as { error: string }).error).toContain("Nothing was deleted");
  });
});

describe("GET /api/data/export", () => {
  it("is behind the access guard", async () => {
    authMock.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await GET(new Request("http://localhost/api/data/export"))).status).toBe(401);
    expect(exportMock).not.toHaveBeenCalled();
  });

  it("downloads as a dated JSON file", async () => {
    exportMock.mockResolvedValue({ format: "ourglass-export", version: 1, tables: {} });
    const response = await GET(new Request("http://localhost/api/data/export"));
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="ourglass-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(await response.json()).toMatchObject({ format: "ourglass-export" });
  });
});
