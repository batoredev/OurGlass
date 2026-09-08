/**
 * REGRESSION TESTS FOR THE MERGE / RESOLVE INVARIANT.
 *
 * ================================ READ THIS ================================
 * `resolve_person` (and its organization/project siblings) HAS NO CALLER UNTIL
 * PHASE 5. This file is the only thing keeping it correct across four phases.
 *
 * A function with no caller is exactly what gets quietly deleted as dead code, and a
 * resolver that is subtly wrong fails ONLY for merged people — the rarest path and
 * the last one anyone tests. If this test is weakened, skipped, or deleted, the
 * failure surfaces in Phase 5 as blank names in a UI, four phases downstream of the
 * change that caused it. That is the longest feedback loop in the plan.
 *
 * Do not skip this file to make a red suite green. Fix the resolver.
 * (docs/PHASE-1-DESIGN.md §2.3, docs/DECISIONS.md #3.)
 * ===========================================================================
 *
 * These are INTEGRATION tests: they need a real Postgres 17 + pgvector with
 * migrations applied. They skip themselves when DATABASE_URL is unset so the fast
 * unit lane (`pnpm test`) stays Docker-free — a skip here is expected locally and a
 * FAILURE in CI's integration job, which does set DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createPool,
  withTransaction,
  people,
  organizations,
  projects,
  commitments,
  truncateAll,
} from "../src/index.js";
import type pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

// Skipping is correct locally (fast lane, no Docker) but WRONG in CI: this suite is
// the only thing keeping resolve_person correct until Phase 5, and a suite that
// silently skips is indistinguishable from a suite that passes. CI sets both
// DATABASE_URL and CI=true, so a skip there is a hard failure instead.
if (!DATABASE_URL && process.env.CI) {
  throw new Error(
    "DATABASE_URL is unset in CI. The merge/resolve regression suite would have " +
      "silently skipped — see the header comment in this file for why that is not " +
      "acceptable. Ensure `pnpm db:migrate` ran and DATABASE_URL is exported.",
  );
}

const suite = DATABASE_URL ? describe : describe.skip;

suite("merge and resolution invariants", () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // TRUNCATE, not transaction-rollback — see src/testing/truncate.ts for why.
    await truncateAll(pool);
  });

  it("create two people, merge them, and every LIST path returns exactly one row", async () => {
    const { a, b } = await withTransaction(pool, async (tx) => {
      const a = await people.createPerson(tx, { displayName: "Barkha S." });
      const b = await people.createPerson(tx, { displayName: "Barkha" });
      return { a, b };
    });

    // Before the merge: two distinct people, both listed.
    const before = await people.list(pool);
    expect(before).toHaveLength(2);

    await withTransaction(pool, (tx) => people.mergePerson(tx, b.id, a.id));

    // THE INVARIANT: the People list shows ONE row after a merge, not two.
    const after = await people.list(pool);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(a.id);

    // Same assertion straight against the view, in case a future refactor of
    // `list()` stops going through it.
    const viaView = await pool.query("SELECT * FROM people_current");
    expect(viaView.rowCount).toBe(1);

    // INVALIDATE, NEVER DELETE: the loser's row is still there, carrying the
    // forwarding pointer. Undo has something to reverse against.
    const raw = await pool.query("SELECT * FROM people WHERE id = $1", [b.id]);
    expect(raw.rowCount).toBe(1);
    expect(raw.rows[0].merged_into_id).toBe(a.id);
    expect(raw.rows[0].t_invalid).not.toBeNull();
  });

  it("DEREFERENCE follows the pointer where LIST filters it away", async () => {
    const { a, b } = await withTransaction(pool, async (tx) => {
      const a = await people.createPerson(tx, { displayName: "Winner" });
      const b = await people.createPerson(tx, { displayName: "Loser" });
      await people.mergePerson(tx, b.id, a.id);
      return { a, b };
    });

    // This is the whole point of two read shapes. A stored UUID naming the loser
    // must still dereference to a live person — never a blank cell.
    const resolved = await people.resolvePerson(pool, b.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(a.id);
    expect(resolved!.display_name).toBe("Winner");

    // ...while the LIST view correctly does not contain the loser at all. Using the
    // view for this dereference is the silent bug the pointer exists to prevent.
    const listed = await people.list(pool);
    expect(listed.map((p) => p.id)).not.toContain(b.id);
  });

  it("resolution is TRANSITIVE: A merged into B, B merged into C, A resolves to C", async () => {
    // A single hop returns B — who is themselves merged away, and would render as a
    // person who no longer exists.
    const { a, c } = await withTransaction(pool, async (tx) => {
      const a = await people.createPerson(tx, { displayName: "A" });
      const b = await people.createPerson(tx, { displayName: "B" });
      const c = await people.createPerson(tx, { displayName: "C" });
      await people.mergePerson(tx, a.id, b.id);
      await people.mergePerson(tx, b.id, c.id);
      return { a, c };
    });

    const resolved = await people.resolvePerson(pool, a.id);
    expect(resolved!.id).toBe(c.id);
    expect(resolved!.display_name).toBe("C");
    expect(await people.resolvePersonId(pool, a.id)).toBe(c.id);
  });

  it("an unmerged id resolves to itself", async () => {
    const a = await withTransaction(pool, (tx) =>
      people.createPerson(tx, { displayName: "Solo" }),
    );
    expect(await people.resolvePersonId(pool, a.id)).toBe(a.id);
    expect((await people.resolvePerson(pool, a.id))!.id).toBe(a.id);
  });

  it("an id that never existed resolves to null, not to a phantom row", async () => {
    // The sharp edge: `(resolve_person(x)).*` on a NULL composite expands to ONE
    // all-NULL row rather than zero rows, so a row-count check would report a hit.
    // The repository normalises it; this asserts the normalisation.
    const missing = "00000000-0000-0000-0000-000000000000";
    expect(await people.resolvePerson(pool, missing)).toBeNull();
    expect(await people.resolvePersonId(pool, missing)).toBeNull();
  });

  it("a merge CYCLE raises rather than looping forever", async () => {
    // Merges are undoable and redoable (invertibility='full'), which is precisely how
    // a cycle gets created by accident. Failing loudly beats hanging a request.
    const { a } = await withTransaction(pool, async (tx) => {
      const a = await people.createPerson(tx, { displayName: "A" });
      const b = await people.createPerson(tx, { displayName: "B" });
      await people.mergePerson(tx, a.id, b.id);
      await people.mergePerson(tx, b.id, a.id); // closes the loop
      return { a };
    });

    await expect(people.resolvePerson(pool, a.id)).rejects.toThrow(
      /cycle or chain too deep/,
    );
  });

  it("merge is reversible by resetting two columns — invertibility='full' is honest", async () => {
    const { a, b, merged } = await withTransaction(pool, async (tx) => {
      const a = await people.createPerson(tx, { displayName: "Winner" });
      const b = await people.createPerson(tx, { displayName: "Loser" });
      const merged = await people.mergePerson(tx, b.id, a.id);
      return { a, b, merged };
    });
    expect(await people.list(pool)).toHaveLength(1);

    await withTransaction(pool, (tx) =>
      people.unmergePerson(tx, b.id, merged.previousMergedIntoId, merged.previousTInvalid),
    );

    // Both people are back, and the loser dereferences to themselves again. The
    // lossy alternative (UPDATE ... SET owner_id = winner) could not do this without
    // enumerating every row it had touched.
    expect(await people.list(pool)).toHaveLength(2);
    expect((await people.resolvePerson(pool, b.id))!.id).toBe(b.id);
    void a;
  });

  it("undoing a RE-merge restores the PREVIOUS winner, not NULL", async () => {
    // The lossy-inverse regression. A merged into B, then A merged into C (after a
    // correction or an undo/redo). Undoing the SECOND merge must leave A pointing at
    // B — not un-merged from everything.
    //
    // Getting this wrong is silent: it produces exactly the duplicate-person-in-the
    // -list symptom §2.3 names as the signal that this mitigation has failed. And a
    // tool building its inverse_patch from a merge that discarded the old value would
    // log a WRONG inverse into action_log, which §4.2's last invariant forbids.
    const { a, b, second } = await withTransaction(pool, async (tx) => {
      const a = await people.createPerson(tx, { displayName: "A" });
      const b = await people.createPerson(tx, { displayName: "B" });
      const c = await people.createPerson(tx, { displayName: "C" });
      await people.mergePerson(tx, a.id, b.id);
      const second = await people.mergePerson(tx, a.id, c.id);
      return { a, b, second };
    });

    // mergePerson must have CAPTURED the pre-merge pointer, not the post-merge one.
    expect(second.previousMergedIntoId).toBe(b.id);
    expect(second.previousTInvalid).not.toBeNull();

    await withTransaction(pool, (tx) =>
      people.unmergePerson(
        tx,
        a.id,
        second.previousMergedIntoId,
        second.previousTInvalid,
      ),
    );

    // A points at B again, so it resolves to B — not to itself.
    const resolved = await people.resolvePerson(pool, a.id);
    expect(resolved!.id).toBe(b.id);
    expect(resolved!.display_name).toBe("B");

    // And A is still correctly absent from the list, because the first merge stands.
    expect((await people.list(pool)).map((p) => p.id)).not.toContain(a.id);
  });

  it("re-invalidating does NOT move an already-set t_invalid", async () => {
    // t_invalid means "when the fact stopped being true IN THE WORLD" (§2.1) — it is
    // not a tombstone flag. Overwriting it with now() on a second invalidate loses
    // the real instant.
    //
    // LATENT TODAY: the double-undo unique index stops undo reaching a commitment's
    // inverse twice for one turn. It goes live the first time anything else
    // invalidates before the creating turn is undone (a future update_commitment or
    // complete_commitment). That means no other test will catch a regression here —
    // this one is load-bearing precisely because the bug is currently unreachable.
    const owner = await withTransaction(pool, (tx) =>
      people.createPerson(tx, { displayName: "Owner" }),
    );
    const c = await withTransaction(pool, (tx) =>
      commitments.createCommitment(tx, {
        ownerId: owner.id,
        objectText: "the article",
      }),
    );

    // An earlier, legitimate invalidation at a known instant.
    const realInstant = new Date("2026-01-01T00:00:00Z");
    await withTransaction(pool, (tx) =>
      commitments.invalidateCommitment(tx, c.id, realInstant),
    );

    // A later default-path invalidate (what undo does) must NOT move it.
    await withTransaction(pool, (tx) =>
      commitments.invalidateCommitment(tx, c.id),
    );

    const after = await commitments.getById(pool, c.id);
    expect(after!.t_invalid).not.toBeNull();
    expect(new Date(after!.t_invalid!).toISOString()).toBe(
      realInstant.toISOString(),
    );

    // Same invariant on people, which had the identical defect.
    const p = await withTransaction(pool, (tx) =>
      people.createPerson(tx, { displayName: "Temp" }),
    );
    await withTransaction(pool, (tx) =>
      people.invalidatePerson(tx, p.id, realInstant),
    );
    await withTransaction(pool, (tx) => people.invalidatePerson(tx, p.id));
    const raw = await pool.query("SELECT t_invalid FROM people WHERE id = $1", [
      p.id,
    ]);
    expect(new Date(raw.rows[0].t_invalid).toISOString()).toBe(
      realInstant.toISOString(),
    );
  });

  it("an EXPLICIT timestamp still overwrites — the caller is asserting the instant", async () => {
    const owner = await withTransaction(pool, (tx) =>
      people.createPerson(tx, { displayName: "Owner2" }),
    );
    const c = await withTransaction(pool, (tx) =>
      commitments.createCommitment(tx, { ownerId: owner.id, objectText: "x" }),
    );
    const first = new Date("2026-01-01T00:00:00Z");
    const corrected = new Date("2026-02-02T00:00:00Z");
    await withTransaction(pool, (tx) =>
      commitments.invalidateCommitment(tx, c.id, first),
    );
    await withTransaction(pool, (tx) =>
      commitments.invalidateCommitment(tx, c.id, corrected),
    );
    // Passing a timestamp is how §17-style correction restates when a fact ceased,
    // so it must win over the preserved value.
    const after = await commitments.getById(pool, c.id);
    expect(new Date(after!.t_invalid!).toISOString()).toBe(
      corrected.toISOString(),
    );
  });

  // The same defect one table over. An earlier draft of this decision fixed the
  // resolver on `people` only and silently left these two unresolved.
  it("organizations resolve through the pointer, exactly like people", async () => {
    const { a, b } = await withTransaction(pool, async (tx) => {
      const a = await organizations.createOrganization(tx, { name: "Acme Inc" });
      const b = await organizations.createOrganization(tx, { name: "Acme" });
      await organizations.mergeOrganization(tx, b.id, a.id);
      return { a, b };
    });
    expect(await organizations.list(pool)).toHaveLength(1);
    expect((await organizations.resolveOrganization(pool, b.id))!.id).toBe(a.id);
  });

  it("projects resolve through the pointer, exactly like people", async () => {
    const { a, b } = await withTransaction(pool, async (tx) => {
      const a = await projects.createProject(tx, { name: "Redesign" });
      const b = await projects.createProject(tx, { name: "The Redesign" });
      await projects.mergeProject(tx, b.id, a.id);
      return { a, b };
    });
    expect(await projects.list(pool)).toHaveLength(1);
    expect((await projects.resolveProject(pool, b.id))!.id).toBe(a.id);
  });
});
