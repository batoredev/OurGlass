/**
 * Demo data for a prototype display: a small, believable week, written
 * through the real tools so it is validated, logged and undoable exactly like
 * what the chat writes.
 *
 * WHY THROUGH executeTurn, NOT INSERTs: the tools are the only write path the
 * rest of the app trusts (spec §37). Seeding around them would produce rows
 * the action log cannot explain and undo cannot reverse.
 *
 * ONE TURN, actor `user_turn`: it stands in for what a person would have told
 * the assistant, and undo walks only user turns — so a single Undo on the
 * Activity page removes the whole demo.
 *
 * The cast is the spec's fictional one (Barkha, Dev, Meera, Arun, Hult). This
 * repository is public; no real person appears in it.
 */
import { randomUUID } from "node:crypto";
import { users } from "@ourglass/db";
import { executeTurn, type Deps } from "../tools/executor.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface SeedResult {
  readonly turnId: string;
  readonly people: number;
  readonly commitments: number;
}

export class DatabaseNotEmptyError extends Error {
  constructor(count: number) {
    super(`The database already holds ${count} people besides you. The demo seed only fills an empty one.`);
    this.name = "DatabaseNotEmptyError";
  }
}

/** Refuses a database that already holds anyone but the user, so it can never mix with real data. */
export async function seedDemo(deps: Deps, now: Date = new Date()): Promise<SeedResult> {
  const self = await deps.db.withTransaction(async (tx) => {
    const account = await users.ensureUser(tx, { displayName: "You" });
    const others = await tx.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM people_current WHERE id <> $1",
      [account.self?.id ?? null],
    );
    const count = Number(others.rows[0]?.count ?? 0);
    if (count > 0) throw new DatabaseNotEmptyError(count);
    if (!account.self) throw new Error("The account has no self person; run the app once first.");
    return account.self.id;
  });

  // On the hour, so the demo's times read as people would say them.
  const base = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
  const at = (offset: number) => new Date(base.getTime() + offset).toISOString();

  const barkha = randomUUID();
  const dev = randomUUID();
  const meera = randomUUID();
  const arun = randomUUID();
  const article = randomUUID();

  const outcome = await executeTurn(
    [
      { name: "create_person", input: { id: barkha, display_name: "Barkha" } },
      { name: "create_person", input: { id: dev, display_name: "Dev" } },
      { name: "create_person", input: { id: meera, display_name: "Meera" } },
      { name: "create_person", input: { id: arun, display_name: "Arun" } },
      // Owed to you, and owed by you — the direction is the point (spec §7).
      { name: "create_commitment", input: { id: article, owner_id: barkha, recipient_id: self, object_text: "the article", expected_at: at(4 * HOUR) } },
      { name: "create_commitment", input: { owner_id: self, recipient_id: dev, object_text: "the venue quote", expected_at: at(DAY + 2 * HOUR) } },
      { name: "create_commitment", input: { owner_id: meera, recipient_id: self, object_text: "the poster draft", expected_at: at(3 * DAY) } },
      { name: "create_commitment", input: { owner_id: self, recipient_id: arun, object_text: "feedback on the backend plan", expected_at: at(-DAY) } },
      { name: "create_reminder", input: { body: "Ask Barkha for the article", commitment_id: article, fire_at: at(3 * HOUR), source_phrase: "an hour before it is due" } },
      // Thirty minutes each and a day apart: the clash check would refuse an overlap.
      { name: "create_event", input: { title: "Hult poster review", starts_at: at(DAY + HOUR), ends_at: at(DAY + HOUR + 0.5 * HOUR) } },
      { name: "create_event", input: { title: "Coffee with Meera", starts_at: at(2 * DAY + 2 * HOUR), ends_at: at(2 * DAY + 2.5 * HOUR) } },
      { name: "create_thought", input: { body: "Plan the Hult launch week", priority: "high" } },
      { name: "create_thought", input: { body: "Draft the year-end note to the team", priority: "mid" } },
      { name: "create_thought", input: { body: "Try the new café on 5th", priority: "low" } },
      { name: "remember", input: { kind: "fact", body: "Arun works on the backend", inference_level: "CONFIRMED", subject_kind: "person", subject_id: arun } },
      { name: "remember", input: { kind: "preference", body: "Meera prefers morning meetings", inference_level: "CONFIRMED", subject_kind: "person", subject_id: meera } },
    ],
    deps,
  );

  if (!outcome.ok) {
    const reasons = outcome.errors.map((error) => `${error.field ?? "-"}: ${error.message}`).join("; ");
    throw new Error(`The demo seed was refused by ${outcome.toolName}: ${reasons}`);
  }
  return { turnId: outcome.turnId, people: 4, commitments: 4 };
}
