/**
 * The person model against real Postgres (ROADMAP Stage 2): the profile query,
 * the derivation, and a meeting brief, on the seeded demo week.
 * CI only — the suite truncates every table between tests.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool, events, people, personProfile, truncateAll, users, withTransaction } from "@ourglass/db";
import { seedDemo } from "../demo/seed.js";
import { buildToolRegistry } from "../tools/index.js";
import { briefFor, deriveProfile, peopleInMeeting } from "./index.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL && process.env["CI"]) {
  throw new Error("DATABASE_URL is unset in CI — the person-model suite would silently skip.");
}
const suite = DATABASE_URL ? describe : describe.skip;
const NOW = new Date("2026-11-08T09:00:00.000Z");

suite("person model (integration)", () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await truncateAll(pool);
    await withTransaction(pool, (tx) => users.ensureUser(tx, { displayName: "You" }));
    await seedDemo({ db: { withTransaction: (fn) => withTransaction(pool, fn) }, registry: buildToolRegistry() }, NOW);
  });

  async function profileOf(name: string) {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM people WHERE display_name = $1`, [name]);
    const data = await withTransaction(pool, (tx) => personProfile.loadPersonProfile(tx, rows[0]!.id));
    return deriveProfile(data!, new Date(NOW.getTime() + 60_000), "UTC");
  }

  it("reads what each person owes, and what you owe them, by direction", async () => {
    expect((await profileOf("Barkha")).owesYou.value.map((item) => item.what)).toEqual(["the article"]);
    expect((await profileOf("Barkha")).youOwe.value).toEqual([]);
    expect((await profileOf("Dev")).youOwe.value.map((item) => item.what)).toEqual(["the venue quote"]);
    const arun = await profileOf("Arun");
    expect(arun.youOwe.value).toEqual([expect.objectContaining({ what: "feedback on the backend plan", overdue: true })]);
  });

  it("reads memories about the person, with how they were learned", async () => {
    expect((await profileOf("Meera")).preferences.map((fact) => fact.value)).toEqual(["Meera prefers morning meetings"]);
    expect((await profileOf("Arun")).facts.map((fact) => fact.value)).toEqual(["Arun works on the backend"]);
    expect((await profileOf("Meera")).preferences[0]!.source).toMatch(/^you said so on /);
  });

  it("is null for an unknown person", async () => {
    const missing = await withTransaction(pool, (tx) =>
      personProfile.loadPersonProfile(tx, "00000000-0000-4000-8000-000000000000"),
    );
    expect(missing).toBeNull();
  });

  it("briefs the seeded coffee with Meera", async () => {
    const { meeting, everyone, selfId } = await withTransaction(pool, async (tx) => ({
      meeting: (await events.listBetween(tx, NOW, new Date(NOW.getTime() + 7 * 86_400_000))).find((row) =>
        row.title.includes("Meera"),
      )!,
      everyone: await people.list(tx),
      selfId: (await users.currentAccount(tx))?.self?.id ?? null,
    }));
    const named = peopleInMeeting(meeting, everyone, selfId);
    expect(named.map((person) => person.name)).toEqual(["Meera"]);
    const brief = briefFor(await profileOf("Meera"));
    expect(brief.lines[0]).toMatch(/^Owes you: the poster draft \(due /);
    expect(brief.lines.some((line) => line.startsWith("Meera prefers morning meetings"))).toBe(true);
  });
});
