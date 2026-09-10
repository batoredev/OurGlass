/**
 * REGRESSION TEST FOR SPEC §11'S "TWO ARUNS" CASE, AGAINST A REAL DATABASE.
 *
 * ================================ READ THIS ================================
 * `resolvePersonMention` is the only place the three-band policy meets actual
 * SQL, and the bug this file exists to prevent was invisible to every unit test
 * in the suite. `resolveMention` was tested directly with both Aruns already in
 * the candidate list, so it passed; `resolvePersonMention` — which BUILDS that
 * list — was untested, and it built the wrong one.
 *
 * `people.findByDisplayName` is exact equality (`lower(display_name) = lower($1)`).
 * The old code took its result as the candidate set whenever it was non-empty,
 * and only fell back to `people.list()` when it was empty. So with "Arun"
 * (Batore) and "Arun Kumar" (MTTN) in the table, a mention of "Arun" returned
 * exactly ONE row, `list()` was never consulted, and the mention auto-resolved
 * to whichever Arun matched exactly — while the TYPO "Aru" correctly asked.
 * The correct name guessed; the misspelling behaved properly.
 *
 * That is the wrong-merge failure mode docs/DECISIONS.md #9 names as the worst
 * in this system, and spec §11 and §12 both require asking here.
 *
 * Only a real DB test can catch this, because the bug lives in the interaction
 * between two repository queries. Do not replace this with a mock.
 * ===========================================================================
 *
 * INTEGRATION: needs a real Postgres 17 + pgvector with migrations applied
 * (`docker compose up -d postgres && pnpm db:migrate`). Skips itself when
 * DATABASE_URL is unset so the fast unit lane stays Docker-free — a skip is
 * expected locally and a hard FAILURE in CI, which does set DATABASE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, people, truncateAll, withTransaction } from "@ourglass/db";
import { resolvePersonMention } from "./resolve.js";

const DATABASE_URL = process.env["DATABASE_URL"];

// A skipped suite and a passing suite look identical in a CI summary line. This
// file holds the ONLY test of the spec §11 disambiguation path against real SQL.
if (!DATABASE_URL && process.env["CI"]) {
  throw new Error(
    "DATABASE_URL is unset in CI — resolvePersonMention's spec §11 regression suite " +
      "would otherwise silently skip instead of running.",
  );
}

const suite = DATABASE_URL ? describe : describe.skip;

suite("resolvePersonMention (integration)", () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await withTransaction(pool, (tx) => truncateAll(tx));
  });

  it("ASKS when two people's names both plausibly match the mention", async () => {
    const resolution = await withTransaction(pool, async (tx) => {
      const batoreArun = await people.createPerson(tx, { displayName: "Arun" });
      const mttnArun = await people.createPerson(tx, { displayName: "Arun Kumar" });
      const result = await resolvePersonMention(tx, { name: "Arun" });
      return { result, batoreArun, mttnArun };
    });

    // The whole point: an EXACT match on "Arun" must not auto-resolve while
    // "Arun Kumar" is also in the table.
    expect(resolution.result.band).toBe("ask");
    if (resolution.result.band !== "ask") throw new Error("unreachable");
    expect(resolution.result.candidates.map((candidate) => candidate.id).sort()).toEqual(
      [resolution.batoreArun.id, resolution.mttnArun.id].sort(),
    );
    expect(resolution.result.candidates.map((candidate) => candidate.displayName).sort())
      .toEqual(["Arun", "Arun Kumar"]);
  });

  it("auto-resolves the same mention once the second Arun is not there", async () => {
    // Confirms the ask above is caused by the SECOND person, not by a blanket
    // refusal to auto-resolve — otherwise the test above would pass for the
    // wrong reason and spec §27's "do not over-ask" would be violated instead.
    const resolution = await withTransaction(pool, async (tx) => {
      const arun = await people.createPerson(tx, { displayName: "Arun" });
      await people.createPerson(tx, { displayName: "Barkha" });
      return { result: await resolvePersonMention(tx, { name: "Arun" }), arun };
    });

    expect(resolution.result).toMatchObject({ band: "auto", id: resolution.arun.id });
  });

  it("consults every current person, not only exact matches", async () => {
    // The old code short-circuited on a non-empty exact result. Here the exact
    // query returns one row and the fuzzy candidate is only reachable via
    // list() — so a pass proves the union actually happens.
    const resolution = await withTransaction(pool, async (tx) => {
      await people.createPerson(tx, { displayName: "Arun" });
      await people.createPerson(tx, { displayName: "Arun Sharma" });
      await people.createPerson(tx, { displayName: "Arun Kumar" });
      return resolvePersonMention(tx, { name: "Arun" });
    });

    expect(resolution.band).toBe("ask");
    if (resolution.band !== "ask") throw new Error("unreachable");
    expect(resolution.candidates).toHaveLength(3);
  });

  it("rejects a mention that matches nobody rather than guessing", async () => {
    const resolution = await withTransaction(pool, async (tx) => {
      await people.createPerson(tx, { displayName: "Barkha" });
      return resolvePersonMention(tx, { name: "Priya" });
    });

    expect(resolution.band).toBe("reject");
  });

  it("is case-insensitive on an unambiguous exact match", async () => {
    const resolution = await withTransaction(pool, async (tx) => {
      const arun = await people.createPerson(tx, { displayName: "Arun" });
      return { result: await resolvePersonMention(tx, { name: "arun" }), arun };
    });

    expect(resolution.result).toMatchObject({ band: "auto", id: resolution.arun.id });
  });
});
