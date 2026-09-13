/**
 * relationships — §15 graph, §16 provenance, §17 correction (F9).
 *
 * ================================ READ THIS ================================
 * THE TESTS THAT MATTER HERE ARE THE SUPERSEDE ONES, and specifically the one
 * asserting `t_invalid(old) === t_valid(new)`.
 *
 * Spec §17: "Arun handles the backend." -> "No, Karthik handles it now."
 * The system must update the current relationship AND preserve the history.
 * Two failure modes are both easy and both silent:
 *
 *   1. UPDATE the row in place. Current state looks right; the history §17
 *      demands is gone, and "who handled backend in September?" is
 *      unanswerable forever.
 *   2. Close the old edge at `now()` instead of at the new edge's validity
 *      start. Looks right whenever the correction is about the present, and
 *      silently invents a fact whenever it is not ("Karthik took over last
 *      month" would claim Arun held the role until the user mentioned it).
 *
 * Neither produces an error. Both are asserted against below.
 * ===========================================================================
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, people, relationships, truncateAll, withTransaction } from "../src/index.js";

const DATABASE_URL = process.env["DATABASE_URL"];

// A skipped suite and a passing suite look identical in a CI summary line.
// This file holds the ONLY tests of §17 correction semantics.
if (!DATABASE_URL && process.env["CI"]) {
  throw new Error(
    "DATABASE_URL is unset in CI — the relationships/§17 suite would otherwise " +
      "silently skip instead of running.",
  );
}

const suite = DATABASE_URL ? describe : describe.skip;

suite("relationships (integration)", () => {
  let pool: pg.Pool;
  let arun: string;
  let karthik: string;
  // A project id. `object_id` is polymorphic with no FK, so any uuid is legal
  // at the database level — using a real project keeps the fixture honest.
  let backend: string;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
    const seeded = await withTransaction(pool, async (tx) => {
      const a = await people.createPerson(tx, { displayName: "Arun" });
      const k = await people.createPerson(tx, { displayName: "Karthik" });
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO projects (name) VALUES ('Backend') RETURNING id`,
      );
      return { a: a.id, k: k.id, p: rows[0]!.id };
    });
    arun = seeded.a;
    karthik = seeded.k;
    backend = seeded.p;
  });

  function edge(subjectId: string, validFrom?: Date) {
    return {
      subjectId,
      relType: "handles",
      objectKind: "project" as const,
      objectId: backend,
      inferenceLevel: "CONFIRMED" as const,
      ...(validFrom ? { validFrom } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // §15 / §16 — the graph and its provenance
  // -------------------------------------------------------------------------

  it("stores an edge with provenance and traverses it in both directions", async () => {
    // §15 lists both read paths — "what does Arun work on" and "who works on
    // backend" — which is why migration 004 indexes both sides.
    const message = await withTransaction(pool, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO messages (role, body) VALUES ('user', 'Arun handles the backend') RETURNING id`,
      );
      return rows[0]!.id;
    });

    await withTransaction(pool, (tx) =>
      relationships.createRelationship(tx, { ...edge(arun), sourceMessageId: message }),
    );

    const outbound = await withTransaction(pool, (tx) => relationships.listBySubject(tx, arun));
    const inbound = await withTransaction(pool, (tx) =>
      relationships.listByObject(tx, "project", backend),
    );

    expect(outbound).toHaveLength(1);
    expect(inbound).toHaveLength(1);
    // §16: the edge knows WHICH message asserted it. Without this, §17
    // correction is possible but not auditable.
    expect(outbound[0]!.source_message_id).toBe(message);
    expect(outbound[0]!.inference_level).toBe("CONFIRMED");
  });

  // -------------------------------------------------------------------------
  // §17 — correction
  // -------------------------------------------------------------------------

  describe("§17 correction is a supersede", () => {
    it("leaves exactly ONE current edge and KEEPS the old row", async () => {
      const original = await withTransaction(pool, (tx) =>
        relationships.createRelationship(tx, edge(arun)),
      );

      await withTransaction(pool, (tx) =>
        relationships.supersedeRelationship(tx, original.id, edge(karthik)),
      );

      const current = await withTransaction(pool, (tx) =>
        relationships.listByObject(tx, "project", backend),
      );
      expect(current).toHaveLength(1);
      expect(current[0]!.subject_id).toBe(karthik);

      // The old row is still THERE — invalidated, not deleted. An UPDATE in
      // place would make this assertion impossible to write.
      const history = await withTransaction(pool, (tx) =>
        relationships.listHistory(tx, "project", backend, "handles"),
      );
      expect(history).toHaveLength(2);
      expect(history.map((r) => r.subject_id)).toContain(arun);
    });

    it("closes the old edge AT THE NEW EDGE'S VALIDITY START, not at now()", async () => {
      // ⚠ THE ASSERTION THIS FILE EXISTS FOR.
      //
      // The correction describes a change that happened in the PAST. Using
      // now() here would claim Arun held the role until the moment the user
      // mentioned it — inventing a fact, silently, with no error and a
      // correct-looking current state.
      const lastMonth = new Date("2026-08-15T10:00:00+05:30");

      const original = await withTransaction(pool, (tx) =>
        relationships.createRelationship(tx, edge(arun, new Date("2026-07-01T10:00:00+05:30"))),
      );

      const result = await withTransaction(pool, (tx) =>
        relationships.supersedeRelationship(tx, original.id, edge(karthik, lastMonth)),
      );

      // No gap and no overlap: the instant one edge ends is the instant the
      // next begins.
      expect(result.superseded.t_invalid!.toISOString()).toBe(
        result.replacement.t_valid.toISOString(),
      );
      expect(result.superseded.t_invalid!.toISOString()).toBe(lastMonth.toISOString());
    });

    it("answers 'who handled this in July?' from the preserved history", async () => {
      // The whole point of preserving history rather than updating in place.
      // If this cannot be answered, §17 was implemented in name only.
      const july = new Date("2026-07-01T10:00:00+05:30");
      const august = new Date("2026-08-15T10:00:00+05:30");

      const original = await withTransaction(pool, (tx) =>
        relationships.createRelationship(tx, edge(arun, july)),
      );
      await withTransaction(pool, (tx) =>
        relationships.supersedeRelationship(tx, original.id, edge(karthik, august)),
      );

      const asOfJuly = await withTransaction(pool, (tx) =>
        tx.query<{ subject_id: string }>(
          `SELECT subject_id FROM relationships
            WHERE object_id = $1 AND rel_type = 'handles'
              AND t_valid <= $2 AND (t_invalid IS NULL OR t_invalid > $2)`,
          [backend, new Date("2026-07-20T10:00:00+05:30")],
        ),
      );

      expect(asOfJuly.rows).toHaveLength(1);
      expect(asOfJuly.rows[0]!.subject_id).toBe(arun);
    });

    it("is reversible — unsupersede restores the prior state exactly", async () => {
      const original = await withTransaction(pool, (tx) =>
        relationships.createRelationship(tx, edge(arun)),
      );
      const result = await withTransaction(pool, (tx) =>
        relationships.supersedeRelationship(tx, original.id, edge(karthik)),
      );

      // previousInvalidAt was NULL — the old edge was open. Undo must restore
      // exactly that, not assume it.
      expect(result.previousInvalidAt).toBeNull();

      await withTransaction(pool, (tx) =>
        relationships.unsupersedeRelationship(
          tx,
          original.id,
          result.replacement.id,
          result.previousInvalidAt,
        ),
      );

      const current = await withTransaction(pool, (tx) =>
        relationships.listByObject(tx, "project", backend),
      );
      expect(current).toHaveLength(1);
      expect(current[0]!.subject_id).toBe(arun);
    });

    it("refuses to supersede an edge that does not exist", async () => {
      await expect(
        withTransaction(pool, (tx) =>
          relationships.supersedeRelationship(
            tx,
            "33333333-3333-3333-3333-333333333333",
            edge(karthik),
          ),
        ),
      ).rejects.toThrow(/no relationship with id/);
    });
  });

  // -------------------------------------------------------------------------
  // §28 — "Forget that Arun works on backend"
  // -------------------------------------------------------------------------

  it("invalidates rather than deletes, idempotently, and revalidate restores", async () => {
    const created = await withTransaction(pool, (tx) =>
      relationships.createRelationship(tx, edge(arun)),
    );

    await withTransaction(pool, (tx) => relationships.invalidateRelationship(tx, created.id));
    const first = await withTransaction(pool, (tx) => relationships.getById(tx, created.id));

    // Idempotent: t_invalid records when the edge stopped being true in the
    // world, so a second call must not move it.
    await withTransaction(pool, (tx) => relationships.invalidateRelationship(tx, created.id));
    const second = await withTransaction(pool, (tx) => relationships.getById(tx, created.id));
    expect(second!.t_invalid!.toISOString()).toBe(first!.t_invalid!.toISOString());

    // Gone from the current view, still present in the table.
    const current = await withTransaction(pool, (tx) => relationships.listBySubject(tx, arun));
    expect(current).toHaveLength(0);
    expect(second).not.toBeNull();

    await withTransaction(pool, (tx) => relationships.revalidateRelationship(tx, created.id, null));
    const back = await withTransaction(pool, (tx) => relationships.listBySubject(tx, arun));
    expect(back).toHaveLength(1);
  });
});
