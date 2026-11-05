/**
 * Export and permanent delete, against real Postgres (ROADMAP Stage 0).
 *
 * The definition of done is "a purge leaves no row and no stored object
 * behind", so every purge here is checked by scanning EVERY table, as JSON,
 * for the purged ids — not by counting the rows the code meant to delete.
 *
 * CI only — the suite truncates every table between tests.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool, dataControl, truncateAll, users, withTransaction } from "@ourglass/db";
import type { DatabaseTransaction, DocumentReading } from "@ourglass/shared";
import { seedDemo } from "../demo/seed.js";
import { ingestDocument, type DocumentReader } from "../ingest/ingest.js";
import { MemoryObjectStore, StorageError, type ObjectStore } from "../storage/object-store.js";
import { buildToolRegistry } from "../tools/index.js";
import { deleteDocumentPermanently, deleteEverything, deletePersonPermanently, exportEverything } from "./index.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL && process.env["CI"]) {
  throw new Error("DATABASE_URL is unset in CI — the data-control suite would silently skip.");
}
const suite = DATABASE_URL ? describe : describe.skip;

const NOW = new Date("2026-11-05T09:00:00.000Z");

/** A reader that names Barkha, so the upload is linked to her. */
const reader: DocumentReader = {
  async read() {
    const reading: DocumentReading = {
      title: "Hult poster brief",
      summary: "The brief.",
      people: ["Barkha"],
      organizations: [],
      projects: [],
      events: [],
      deadlines: [],
    };
    return { reading, provider: "claude", trace: { model: "fake", latencyMs: 1, stopReason: null, inputTokens: 1, outputTokens: 1 } };
  },
};

suite("export and permanent delete (integration)", () => {
  let pool: pg.Pool;
  let store: MemoryObjectStore;
  let db: { withTransaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> };

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
    db = { withTransaction: (fn) => withTransaction(pool, fn) };
  });

  afterAll(async () => {
    await pool.end();
  });

  async function allTables(): Promise<string[]> {
    const { rows } = await pool.query<{ t: string }>(
      `SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations' ORDER BY 1`,
    );
    return rows.map((row) => row.t);
  }

  /** table -> how many of its rows mention any of these strings anywhere, as JSON. */
  async function mentions(needles: readonly string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const table of await allTables()) {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} t
          WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) AS x(s) WHERE row_to_json(t)::text LIKE '%' || x.s || '%')`,
        [needles],
      );
      if (rows[0]!.n > 0) out[table] = rows[0]!.n;
    }
    return out;
  }

  const count = async (table: string): Promise<number> =>
    (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;

  async function personId(name: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM people WHERE display_name = $1`, [name]);
    return rows[0]!.id;
  }

  let userId: string;
  let documentId: string;

  beforeEach(async () => {
    await truncateAll(pool);
    store = new MemoryObjectStore();
    userId = await withTransaction(pool, async (tx) => (await users.ensureUser(tx, { displayName: "You" })).user.id);
    await seedDemo({ db, registry: buildToolRegistry() }, NOW);
    const bytes = new Uint8Array(
      readFileSync(fileURLToPath(new URL("../../test-fixtures/ingest/brief.pdf", import.meta.url))),
    );
    const upload = await ingestDocument(
      { bytes, filename: "brief.pdf", note: "the brief for Barkha", userId, now: NOW },
      { db, registry: buildToolRegistry(), store, reader },
    );
    expect(upload.outcome).toBe("saved");
    documentId = upload.documentId!;
  });

  it("every table is either exported or deliberately not", async () => {
    expect([...dataControl.EXPORTED_TABLES].sort()).toEqual(await allTables());
  });

  it("exports every table as JSON, without vectors or the Google token", async () => {
    const exported = await exportEverything({ db, store }, NOW);
    expect(exported).toMatchObject({ format: "ourglass-export", version: 1, exportedAt: NOW.toISOString() });
    const names = (exported.tables["people"] ?? []).map((row) => row["display_name"]);
    expect(names).toEqual(expect.arrayContaining(["Barkha", "Dev", "Meera", "Arun"]));
    expect(exported.tables["documents"]).toHaveLength(1);
    expect(exported.tables["commitments"]).toHaveLength(4);
    const json = JSON.stringify(exported);
    expect(json).not.toContain('"embedding"');
    expect(json).not.toContain('"object_embedding"');
    expect(json).not.toContain('"refresh_token_enc"');
    expect(Object.keys(exported.tables).sort()).toEqual(await allTables());
  });

  it("deletes one person and every row that refers to them — and nothing else", async () => {
    const barkha = await personId("Barkha");
    const before = await mentions([barkha]);
    expect(Object.keys(before)).toEqual(expect.arrayContaining(["people", "commitments", "document_links", "action_log"]));

    const result = await deletePersonPermanently({ db, store }, barkha);
    expect(result).toMatchObject({ ok: true });

    // No row anywhere mentions her any more — the log included.
    expect(await mentions([barkha])).toEqual({});
    // Everyone else is untouched.
    expect(await count("people_current")).toBe(4); // you, Dev, Meera, Arun
    expect(await count("commitments")).toBe(3);
    expect(await count("memories")).toBe(2);
    // The file stays (it is not hers); only its link to her went.
    expect(await count("documents")).toBe(1);
    expect(store.objects.size).toBe(1);
  });

  it("refuses to delete your own person", async () => {
    const { rows } = await pool.query<{ person_id: string }>(`SELECT person_id FROM users`);
    expect(await deletePersonPermanently({ db, store }, rows[0]!.person_id)).toEqual({ ok: false, reason: "self" });
    expect(await deletePersonPermanently({ db, store }, "00000000-0000-4000-8000-000000000000")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("deletes one file: its bytes, its row, its links, the upload's messages and its log", async () => {
    const messagesBefore = await count("messages");
    const result = await deleteDocumentPermanently({ db, store }, documentId);
    expect(result).toMatchObject({ ok: true, files: 1 });
    expect(store.objects.size).toBe(0);
    expect(await mentions([documentId])).toEqual({});
    expect(await count("document_links")).toBe(0);
    expect(await count("messages")).toBe(messagesBefore - 2);
    // The text the file held is gone from every row too.
    expect(await mentions(["Hult poster brief"])).toEqual({});
  });

  it("keeps everything when storage refuses, so the delete can be run again", async () => {
    const refusing: ObjectStore = {
      put: (key, bytes, type) => store.put(key, bytes, type),
      get: (key) => store.get(key),
      delete: async () => {
        throw new StorageError("File storage refused the delete", 500);
      },
    };
    expect(await deleteDocumentPermanently({ db, store: refusing }, documentId)).toEqual({
      ok: false,
      reason: "storage_failed",
    });
    expect(await count("documents")).toBe(1);
    expect(store.objects.size).toBe(1);
    // …and run again with storage working, it finishes.
    expect(await deleteDocumentPermanently({ db, store }, documentId)).toMatchObject({ ok: true });
    expect(store.objects.size).toBe(0);
  });

  it("deletes everything but the account and its settings, and the app starts over cleanly", async () => {
    const result = await deleteEverything({ db, store });
    expect(result).toMatchObject({ ok: true, files: 1 });
    expect(store.objects.size).toBe(0);

    const left: Record<string, number> = {};
    for (const table of await allTables()) {
      const n = await count(table);
      if (n > 0) left[table] = n;
    }
    expect(left).toEqual({ users: 1, people: 1 });

    // A fresh start works: the demo seed only fills an empty database.
    await expect(seedDemo({ db, registry: buildToolRegistry() }, NOW)).resolves.toMatchObject({ people: 4 });
    expect(await count("people_current")).toBe(5);
  });
});
