/**
 * `runTurn` end to end — docs/PHASE-3-DESIGN.md §3, against a real database.
 *
 * ================================ READ THIS ================================
 * THE ORCHESTRATOR IS THE CENTREPIECE OF PHASE 3 AND NOTHING EXERCISED IT.
 * Every stage it wires had its own unit tests — extract, resolve, time,
 * respond, and each tool — and all of them passed while `runTurn` itself had
 * zero coverage. That is precisely the shape PHASE-1-DESIGN §4.3 warns about
 * and that this repo has now hit repeatedly: the parts are verified, the wire
 * between them is not, and the failure only appears at the seam.
 *
 * THE MODEL CALLS ARE FAKED; EVERYTHING ELSE IS REAL. `Extractor` and
 * `Responder` are injected, so these tests spend NO tokens and are fully
 * deterministic — but the database, the resolver, the tool layer, the
 * executor, `action_log` and `messages` are all the real thing. What is under
 * test here is the WIRING: stage order, the partial-commit rule, turn_id
 * origin, fact reconciliation, and trace persistence.
 *
 * What these tests deliberately do NOT tell you: whether the real model
 * extracts correctly. That is `packages/evals` and the still-unrun
 * `pnpm test:live`. A green run here is evidence about the code, not the model.
 * ===========================================================================
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  commitments,
  createPool,
  entityRecords,
  events,
  memories,
  messages,
  people,
  truncateAll,
  users,
  withTransaction,
  workflows,
} from "@ourglass/db";
import type {
  EntityMention,
  ExtractedIntent,
  ExtractionResult,
  RespondInput,
  RespondOutput,
} from "@ourglass/shared";
import { buildToolRegistry } from "../tools/index.js";
import { ExtractionError, type Extractor } from "./extract.js";
import { runTurn, type OrchestratorDeps } from "./orchestrator.js";

const DATABASE_URL = process.env["DATABASE_URL"];

// A skipped suite and a passing suite look identical in a CI summary line.
// This file holds the ONLY tests of the four-stage wiring — §3.3's
// partial-commit rule, §3.2's turn_id ordering, and §8's trace persistence.
if (!DATABASE_URL && process.env["CI"]) {
  throw new Error(
    "DATABASE_URL is unset in CI — runTurn's orchestrator suite (§3) would " +
      "otherwise silently skip instead of running.",
  );
}

const suite = DATABASE_URL ? describe : describe.skip;

/** An extractor that returns fixed intents. No network, no tokens. */
function fakeExtractor(intents: readonly ExtractedIntent[]): Extractor {
  return {
    extract: async (): Promise<ExtractionResult> => ({
      extraction: { intents },
      trace: {
        model: "claude-sonnet-5",
        latencyMs: 12,
        usage: { inputTokens: 100, outputTokens: 20 },
        stopReason: "tool_use",
      },
    }),
  };
}

/** An extractor that always fails, for the §3.4 path. */
function failingExtractor(reason: "truncated" | "refused"): Extractor {
  return {
    extract: async () => {
      throw new ExtractionError(reason, `extraction ${reason}`, {
        utterance: "whatever",
        stopReason: reason === "truncated" ? "max_tokens" : "refusal",
      });
    },
  };
}

/**
 * A responder that records what it was handed, so a test can assert on what
 * Respond RECEIVED rather than on prose. The real HaikuResponder's own
 * behaviour is respond.test.ts's job.
 */
function recordingResponder() {
  const calls: RespondInput[] = [];
  return {
    calls,
    responder: {
      respond: async (input: RespondInput): Promise<RespondOutput> => {
        calls.push(input);
        return { reply: "ok", degraded: false };
      },
    },
  };
}

function intent(over: Partial<ExtractedIntent> & { kind: ExtractedIntent["kind"] }): ExtractedIntent {
  return { inferenceLevel: "CONFIRMED", sourceText: "…", ...over } as ExtractedIntent;
}

/**
 * A person mention. CONFIRMED throughout: these tests exercise the WIRING,
 * and an UNCERTAIN mention would exercise the resolver's banding instead —
 * which resolve.test.ts and resolve.integration.test.ts already own.
 */
function mention(name: string): EntityMention {
  return { name, kind: "person", inferenceLevel: "CONFIRMED" };
}

suite("runTurn (integration)", () => {
  let pool: pg.Pool;
  let userId: string;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
    const account = await withTransaction(pool, (tx) =>
      users.ensureUser(tx, { displayName: "You", timezone: "Asia/Kolkata" }),
    );
    userId = account.user.id;
  });

  function deps(extractor: Extractor, responder: OrchestratorDeps["responder"]): OrchestratorDeps {
    return {
      db: { withTransaction: (fn) => withTransaction(pool, fn) },
      registry: buildToolRegistry(),
      extractor,
      responder,
    };
  }

  async function seedBarkha() {
    return withTransaction(pool, (tx) => people.createPerson(tx, { displayName: "Barkha" }));
  }

  // -------------------------------------------------------------------------
  // §3.2 — turn_id origin and message ordering
  // -------------------------------------------------------------------------

  it("mints a turn_id, back-fills the user message, and traces both stages", async () => {
    await seedBarkha();
    const { responder, calls } = recordingResponder();

    const result = await runTurn(
      { utterance: "Barkha needs to give me the article.", userId },
      deps(
        fakeExtractor([
          intent({
            kind: "information",
            owner: mention("Barkha"),
            objectText: "the article",
          }),
        ]),
        responder,
      ),
    );

    expect(result.turnId).not.toBeNull();
    expect(result.committed).toEqual(["create_commitment"]);
    expect(calls).toHaveLength(1);

    const all = await withTransaction(pool, (tx) => messages.listRecent(tx, 10));
    expect(all).toHaveLength(2);

    const user = all.find((m) => m.role === "user")!;
    const assistant = all.find((m) => m.role === "assistant")!;

    // §3.2 step 5: the user message is inserted BEFORE the turn exists, then
    // back-filled. Both must name the same turn.
    expect(user.turn_id).toBe(result.turnId);
    expect(assistant.turn_id).toBe(result.turnId);
    expect(user.body).toBe("Barkha needs to give me the article.");

    // §8: the user message carries no trace; the assistant message carries
    // both stages'. Without the trace, an LLM failure is unfixable.
    expect(user.trace).toBeNull();
    const trace = assistant.trace as { interpret?: { model?: string }; respond?: unknown };
    expect(trace.interpret?.model).toBe("claude-sonnet-5");
    expect(trace.respond).toBeDefined();
    expect(assistant.degraded).toBe(false);
  });

  it("a turn that mutates NOTHING has turn_id NULL on both messages", async () => {
    // Migration 004 says turn_id is "NULL for messages that produced no
    // mutation", and §3.2 rejected hoisting id generation into the
    // orchestrator precisely so this stays honest. A turn_id naming zero
    // action_log rows would make lookups return empty for ids the messages
    // table swears are real.
    const { responder } = recordingResponder();

    const result = await runTurn(
      { utterance: "What am I waiting on?", userId },
      deps(fakeExtractor([intent({ kind: "question" })]), responder),
    );

    expect(result.turnId).toBeNull();
    expect(result.committed).toEqual([]);

    const all = await withTransaction(pool, (tx) => messages.listRecent(tx, 10));
    expect(all).toHaveLength(2);
    expect(all.every((m) => m.turn_id === null)).toBe(true);

    const log = await pool.query(`SELECT 1 FROM action_log`);
    expect(log.rows).toHaveLength(0);
  });

  it("declines a question honestly rather than pretending to answer", async () => {
    const { responder, calls } = recordingResponder();
    await runTurn(
      { utterance: "What does Barkha owe me?", userId },
      deps(fakeExtractor([intent({ kind: "question" })]), responder),
    );
    // §3.4: classified, then declined. A `question` is a `declined`, never a
    // `question` — it must not block mutating intents in the same utterance.
    //
    // Phase 4 narrowed what reaches here: "what does Barkha owe me" is now an
    // `inspection` and IS answered. What remains is genuinely open-ended,
    // hence "that" rather than "things" — the assistant can look plenty up.
    expect(calls[0]!.declined).toEqual(["I can't look that up yet."]);
    expect(calls[0]!.questions).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // §3.3 — the partial-commit rule
  // -------------------------------------------------------------------------

  it("asks about an unknown person and writes NOTHING for that intent", async () => {
    const { responder, calls } = recordingResponder();

    const result = await runTurn(
      { utterance: "Priya needs to send the deck.", userId },
      deps(
        fakeExtractor([
          intent({
            kind: "information",
            owner: mention("Priya"),
            objectText: "the deck",
          }),
        ]),
        responder,
      ),
    );

    expect(result.turnId).toBeNull();
    expect(result.asked.length).toBeGreaterThan(0);
    expect(calls[0]!.committed).toEqual([]);

    const rows = await pool.query(`SELECT 1 FROM commitments`);
    expect(rows.rows).toHaveLength(0);
  });

  it("commits the resolvable intent and asks about the blocked one, in one turn", async () => {
    // §3.3's whole point: a partial commit is SAFE only if it is VISIBLE.
    // Barkha resolves and commits; Priya does not and is asked about.
    await seedBarkha();
    const { responder, calls } = recordingResponder();

    const result = await runTurn(
      {
        utterance: "Barkha needs to give me the article. Priya needs to send the deck.",
        userId,
      },
      deps(
        fakeExtractor([
          intent({
            kind: "information",
            owner: mention("Barkha"),
            objectText: "the article",
          }),
          intent({
            kind: "information",
            owner: mention("Priya"),
            objectText: "the deck",
          }),
        ]),
        responder,
      ),
    );

    expect(result.turnId).not.toBeNull();
    expect(result.committed).toEqual(["create_commitment"]);
    expect(result.asked.length).toBeGreaterThan(0);

    // Exactly ONE commitment — not two, and not zero.
    const rows = await pool.query<{ object_text: string }>(`SELECT object_text FROM commitments`);
    expect(rows.rows.map((r) => r.object_text)).toEqual(["the article"]);

    // Respond is told BOTH halves, so the user can say "undo that".
    expect(calls[0]!.committed).toHaveLength(1);
    expect(calls[0]!.questions.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // §2 / reconcileFacts — lateness comes from the TOOL, never from this layer
  // -------------------------------------------------------------------------

  it("reports a late completion's real lateness, derived by the tool", async () => {
    // THE PHASE DEMO'S CORE ASSERTION. Resolve cannot know lateness — it is
    // derived inside complete_commitment from two timestamptz columns — so
    // `reconcileFacts` must overlay the tool's real value onto the predicted
    // fact. Without that overlay the ROW is correct and the SENTENCE is
    // wrong, which is invisible.
    //
    // The stored object_text is "the article" and the utterance says "the
    // article", so the content-token sets are identical and this DOES
    // auto-match (§10's table, row 1). A non-verbatim phrasing would ask
    // instead, which is the documented behaviour, not a bug — so the
    // assertion below branches rather than pretending only one path is legal.
    const barkha = await seedBarkha();
    await withTransaction(pool, (tx) =>
      commitments.createCommitment(tx, {
        ownerId: barkha.id,
        objectText: "the article",
        expectedAt: new Date("2026-09-11T18:00:00+05:30"),
      }),
    );

    const { responder, calls } = recordingResponder();
    await runTurn(
      {
        utterance: "Barkha gave the article at 11.",
        userId,
        now: new Date("2026-09-12T09:00:00+05:30"),
      },
      deps(
        fakeExtractor([
          intent({
            kind: "completion_update",
            owner: mention("Barkha"),
            objectText: "the article",
            time: { kind: "deterministic", sourcePhrase: "2026-09-11T23:00:00+05:30" },
          }),
        ]),
        responder,
      ),
    );

    const fact = calls[0]!.committed[0];
    if (fact && fact.kind === "commitment_completed") {
      // Five hours late, in milliseconds — spec §20's own example.
      expect(fact.latenessMs).toBe(5 * 3_600_000);
    } else {
      // It asked instead of guessing, which §27 requires when the match is
      // not certain. That is a pass, not a miss — but it must have ASKED,
      // not silently done nothing.
      expect(calls[0]!.questions.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // §3.4 — Interpret failure
  // -------------------------------------------------------------------------

  it("degrades honestly on a failed extraction, and still records the trace", async () => {
    const { responder, calls } = recordingResponder();

    const result = await runTurn(
      { utterance: "…", userId },
      deps(failingExtractor("truncated"), responder),
    );

    expect(result.degraded).toBe(true);
    expect(result.turnId).toBeNull();
    expect(result.reply).toMatch(/cut off/i);
    // TEMPLATE, never a Haiku call: the model just failed, and calling another
    // one to explain the failure adds a second thing that can fail on the one
    // path whose whole job is degrading honestly.
    expect(calls).toHaveLength(0);

    // §8.2: the trace is written even though nothing mutated. A failed
    // extraction is the single most valuable turn to have a trace for.
    const all = await withTransaction(pool, (tx) => messages.listRecent(tx, 10));
    const assistant = all.find((m) => m.role === "assistant")!;
    const trace = assistant.trace as { failed?: boolean; reason?: string };
    expect(trace.failed).toBe(true);
    expect(trace.reason).toBe("truncated");
    expect(assistant.degraded).toBe(true);
  });

  it("gives a DISTINCT honest reply per failure reason", async () => {
    // Phase 2 built the failure taxonomy specifically so this could exist.
    // Collapsing them would tell a user whose message was truncated the same
    // thing as one whose message was refused.
    const { responder } = recordingResponder();
    const truncated = await runTurn(
      { utterance: "…", userId },
      deps(failingExtractor("truncated"), responder),
    );
    const refused = await runTurn(
      { utterance: "…", userId },
      deps(failingExtractor("refused"), responder),
    );
    expect(truncated.reply).not.toBe(refused.reply);
  });

  // -------------------------------------------------------------------------
  // §3.2.1 — identity and timezone
  // -------------------------------------------------------------------------

  it("throws UnknownUserError rather than inventing a timezone", async () => {
    // A missing user row is a DEPLOYMENT fault, not a conversational one.
    // Defaulting to "Asia/Kolkata" here would hide a half-provisioned
    // database behind replies that are silently an hour or twelve wrong.
    const { responder } = recordingResponder();
    await expect(
      runTurn(
        { utterance: "hello", userId: "11111111-1111-1111-1111-111111111111" },
        deps(fakeExtractor([]), responder),
      ),
    ).rejects.toThrow(/No user row/);
  });

  // -------------------------------------------------------------------------
  // The six branches that made the stranded tools reachable
  // (docs/PLANNER-WIRING-DESIGN.md task 4).
  //
  // registry.coverage.test.ts proves each tool NAME appears in the
  // orchestrator's source. That is a scan, and the file says so itself — it
  // cannot tell a live branch from a dead literal. These tests are the other
  // half: each drives runTurn and asserts the row that came out the far end.
  // -------------------------------------------------------------------------

  /** A commitment owed to the user, created the way a real turn would. */
  async function commitmentOwedByBarkha(objectText: string) {
    const { responder } = recordingResponder();
    await runTurn(
      { utterance: `Barkha needs to give me ${objectText}.`, userId },
      deps(
        fakeExtractor([
          intent({
            kind: "information",
            owner: mention("Barkha"),
            recipient: mention("me"),
            objectText,
          }),
        ]),
        responder,
      ),
    );
  }

  it("a stated status UPDATES the existing commitment instead of duplicating it", async () => {
    // §22, and the reason planStatusUpdate exists at all. Before this branch
    // the same utterance created a SECOND commitment, which is the duplicate
    // §23 forbids and which quietly doubles everything the user waits on.
    await seedBarkha();
    await commitmentOwedByBarkha("the article");

    const { responder } = recordingResponder();
    const result = await runTurn(
      { utterance: "The article is blocked.", userId },
      deps(
        fakeExtractor([
          intent({
            kind: "information",
            owner: mention("Barkha"),
            recipient: mention("me"),
            objectText: "the article",
            newStatus: "blocked",
          }),
        ]),
        responder,
      ),
    );

    expect(result.committed).toEqual(["update_commitment"]);

    const open = await withTransaction(pool, (tx) => commitments.listCurrent(tx));
    expect(open).toHaveLength(1);
    expect(open[0]?.status).toBe("blocked");
  });

  it("a status for a commitment we have never heard of CREATES it", async () => {
    // Deliberate: "the article is blocked" about something unknown is still
    // news, and refusing it would lose what the user just said.
    await seedBarkha();
    const { responder } = recordingResponder();

    const result = await runTurn(
      { utterance: "The article is blocked.", userId },
      deps(
        fakeExtractor([
          intent({
            kind: "information",
            owner: mention("Barkha"),
            recipient: mention("me"),
            objectText: "the article",
            newStatus: "blocked",
          }),
        ]),
        responder,
      ),
    );

    expect(result.committed).toEqual(["create_commitment"]);
  });

  it("a durable fact is stored AND linked to its subject", async () => {
    // The linkage is the half that would rot silently: an unattached memory
    // still appears in the Memory table, so nothing looks wrong until
    // "what do you know about Barkha" comes back empty.
    const barkha = await seedBarkha();
    const { responder } = recordingResponder();

    const result = await runTurn(
      { utterance: "Barkha prefers WhatsApp over email.", userId },
      deps(
        fakeExtractor([
          intent({
            kind: "context",
            relatedEntity: mention("Barkha"),
            memoryBody: "Barkha prefers WhatsApp over email",
          }),
        ]),
        responder,
      ),
    );

    expect(result.committed).toEqual(["remember"]);

    const stored = await withTransaction(pool, (tx) =>
      memories.listBySubject(tx, "person", barkha.id),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.body).toBe("Barkha prefers WhatsApp over email");
  });

  it("a correction forgets the old fact and stores the new one, in ONE turn", async () => {
    // A correction is a forget plus a remember. Doing both in one turn means
    // one transaction and one undo — "no, Karthik handles it" must not be
    // half-undoable, leaving neither fact or both.
    const { responder: first } = recordingResponder();
    await runTurn(
      { utterance: "Arun handles the backend.", userId },
      deps(
        fakeExtractor([intent({ kind: "context", memoryBody: "Arun handles the backend" })]),
        first,
      ),
    );

    const { responder: second } = recordingResponder();
    const result = await runTurn(
      { utterance: "No, Karthik handles the backend now.", userId },
      deps(
        fakeExtractor([
          intent({
            kind: "context",
            correctionTarget: "Arun handles the backend",
            memoryBody: "Karthik handles the backend",
          }),
        ]),
        second,
      ),
    );

    expect(result.committed).toEqual(["forget_memory", "remember"]);

    // INVALIDATE, NEVER DELETE. listAll reads the current view, so the
    // superseded fact is gone from it while its row survives with t_invalid
    // set — which is what makes undoing this turn possible at all.
    const current = await withTransaction(pool, (tx) => memories.listAll(tx));
    expect(current.map((row) => row.body)).toEqual(["Karthik handles the backend"]);
  });

  it("a correction with nothing on record DECLINES rather than asking", async () => {
    const { responder, calls } = recordingResponder();
    const result = await runTurn(
      { utterance: "Forget that Arun works on backend.", userId },
      deps(
        fakeExtractor([intent({ kind: "context", correctionTarget: "Arun works on backend" })]),
        responder,
      ),
    );

    expect(result.committed).toEqual([]);
    // Declined, not asked: no question would help, and §27 forbids
    // interrogating the user over something we simply never held.
    expect(calls[0]?.questions).toEqual([]);
    expect(calls[0]?.declined.length).toBeGreaterThan(0);
  });

  it("a conditional becomes a workflow pinned to the commitment it watches", async () => {
    await seedBarkha();
    await commitmentOwedByBarkha("the schema");

    const { responder } = recordingResponder();
    const result = await runTurn(
      { utterance: "If Barkha hasn't sent the schema in 3 days, remind me.", userId },
      deps(
        fakeExtractor([
          intent({
            kind: "action",
            relatedEntity: mention("Barkha"),
            condition: {
              subjectText: "the schema",
              deadlinePhrase: "in 3 days",
              action: "remind",
              actionBody: "chase Barkha about the schema",
            },
          }),
        ]),
        responder,
      ),
    );

    expect(result.committed).toEqual(["create_workflow"]);

    const open = await withTransaction(pool, (tx) => commitments.listCurrent(tx));
    const rules = await withTransaction(pool, (tx) => workflows.listBySubject(tx, open[0]!.id));
    expect(rules).toHaveLength(1);
    expect(rules[0]?.action_kind).toBe("remind");
    // The enum value is unchecked by tsc at the call site — the tool's input
    // is Record<string, unknown> — so a typo would surface only as a runtime
    // validation failure. It did, once. Asserted, therefore.
    expect(rules[0]?.condition_kind).toBe("commitment_not_completed");
  });

  it("a conditional with no commitment to watch DECLINES instead of writing a dead rule", async () => {
    await seedBarkha();
    const { responder } = recordingResponder();

    const result = await runTurn(
      { utterance: "If Barkha hasn't sent the schema in 3 days, remind me.", userId },
      deps(
        fakeExtractor([
          intent({
            kind: "action",
            relatedEntity: mention("Barkha"),
            condition: {
              subjectText: "the schema",
              deadlinePhrase: "in 3 days",
              action: "remind",
              actionBody: "chase Barkha",
            },
          }),
        ]),
        responder,
      ),
    );

    // A rule pointing at nothing evaluates false forever and never fires —
    // worse than a refusal, because it looks like it worked.
    expect(result.committed).toEqual([]);
  });

  it("defines a new entity type from an utterance — the no-deploy requirement", async () => {
    const { responder } = recordingResponder();
    const result = await runTurn(
      { utterance: "Track my gym sessions with a date and a note.", userId },
      deps(
        fakeExtractor([
          intent({
            kind: "action",
            entityTypeDefinition: {
              typeKey: "gym_session",
              displayName: "Gym Sessions",
              fields: [
                { fieldKey: "session_date", fieldKind: "date", label: "Date", required: false },
                { fieldKey: "note", fieldKind: "text", label: "Note", required: false },
              ],
            },
          }),
        ]),
        responder,
      ),
    );

    expect(result.committed).toEqual(["define_entity_type"]);

    // The registry is what the frontend reads; a type absent from it renders
    // nowhere, which is the whole requirement failing quietly.
    const type = await withTransaction(pool, (tx) => entityRecords.getTypeByKey(tx, "gym_session"));
    expect(type?.display_name).toBe("Gym Sessions");
    expect(type?.fields.map((field) => field.field_key).sort()).toEqual(["note", "session_date"]);
  });

  it("ASKS for enum options rather than inventing them", async () => {
    const { responder, calls } = recordingResponder();
    const result = await runTurn(
      { utterance: "Track my gym sessions with a status.", userId },
      deps(
        fakeExtractor([
          intent({
            kind: "action",
            entityTypeDefinition: {
              typeKey: "gym_session",
              displayName: "Gym Sessions",
              fields: [{ fieldKey: "status", fieldKind: "enum", label: "Status", required: false }],
            },
          }),
        ]),
        responder,
      ),
    );

    // Every future record is validated against the option list, so guessing
    // it is the guess §27 carves out of its own don't-over-ask rule.
    expect(result.committed).toEqual([]);
    expect(calls[0]?.questions.length).toBeGreaterThan(0);
  });

  it("logs one record against an existing type", async () => {
    const { responder: definition } = recordingResponder();
    await runTurn(
      { utterance: "Track my gym sessions with a note.", userId },
      deps(
        fakeExtractor([
          intent({
            kind: "action",
            entityTypeDefinition: {
              typeKey: "gym_session",
              displayName: "Gym Sessions",
              fields: [{ fieldKey: "note", fieldKind: "text", label: "Note", required: false }],
            },
          }),
        ]),
        definition,
      ),
    );

    const { responder } = recordingResponder();
    const result = await runTurn(
      { utterance: "Log a 45 minute gym session.", userId },
      deps(
        fakeExtractor([
          intent({
            kind: "action",
            entityRecord: { typeKey: "gym_session", values: { note: "45 minutes" } },
          }),
        ]),
        responder,
      ),
    );

    expect(result.committed).toEqual(["create_entity_record"]);

    const rows = await withTransaction(pool, (tx) => entityRecords.listRecords(tx, "gym_session"));
    expect(rows).toHaveLength(1);
    expect((rows[0]?.payload as { note?: string }).note).toBe("45 minutes");
  });

  it("DECLINES a record for a type it does not track, rather than inventing a schema", async () => {
    const { responder, calls } = recordingResponder();
    const result = await runTurn(
      { utterance: "Log a 45 minute gym session.", userId },
      deps(
        fakeExtractor([
          intent({
            kind: "action",
            entityRecord: { typeKey: "gym_session", values: { note: "45 minutes" } },
          }),
        ]),
        responder,
      ),
    );

    // Inferring a schema from one record is how the registry fills with junk
    // types nobody asked for (PLANNER-WIRING-DESIGN §2).
    expect(result.committed).toEqual([]);
    expect(calls[0]?.declined.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // §24 scheduling and conflict, and the §26 gate — Phase 4's unfinished half.
  //
  // proactive.ts was written, unit-tested and correct, and runTurn NEVER
  // IMPORTED IT. detectTimeConflicts read a table nothing could write to, so
  // the Phase 4 demo could not fire even in principle.
  // -------------------------------------------------------------------------

  function scheduleIntent(title: string, phrase: string) {
    return intent({
      kind: "action",
      eventTitle: title,
      time: { kind: "deterministic", sourcePhrase: phrase },
    });
  }

  it("schedules an event when nothing collides", async () => {
    const { responder } = recordingResponder();
    const result = await runTurn(
      { utterance: "Schedule the Hult review at 5 tomorrow.", userId },
      deps(fakeExtractor([scheduleIntent("Hult review", "at 5 tomorrow")]), responder),
    );

    expect(result.committed).toEqual(["create_event"]);

    const upcoming = await withTransaction(pool, (tx) => events.listUpcoming(tx, new Date(), 10));
    expect(upcoming.map((row) => row.title)).toEqual(["Hult review"]);
  });

  it("THE PHASE 4 DEMO: a colliding time asks instead of choosing", async () => {
    // "Schedule Arun at 5 tomorrow" surfaces the Hult conflict and asks.
    const { responder: first } = recordingResponder();
    await runTurn(
      { utterance: "Schedule the Hult review at 5 tomorrow.", userId },
      deps(fakeExtractor([scheduleIntent("Hult review", "at 5 tomorrow")]), first),
    );

    const { responder, calls } = recordingResponder();
    const result = await runTurn(
      { utterance: "Schedule Arun at 5 tomorrow.", userId },
      deps(fakeExtractor([scheduleIntent("Arun", "at 5 tomorrow")]), responder),
    );

    // §24: "Do not automatically choose." Nothing is written, and the
    // question names BOTH sides so the user can act on it.
    expect(result.committed).toEqual([]);
    expect(result.asked).toHaveLength(1);
    expect(result.asked[0]).toContain("Hult review");
    expect(calls[0]?.questions[0]).toContain("Move it or keep both?");

    // The second event must NOT exist. A conflict that still books is worse
    // than no detection at all.
    const upcoming = await withTransaction(pool, (tx) => events.listUpcoming(tx, new Date(), 10));
    expect(upcoming.map((row) => row.title)).toEqual(["Hult review"]);
  });

  it("volunteers a newly-overdue commitment, once", async () => {
    // RULE 2 is the whole point: "is overdue" stays true forever and nagging
    // about it is §26's own "bad" column. "JUST became overdue" is true once.
    const barkha = await seedBarkha();
    const deadline = new Date(Date.now() - 60 * 60 * 1000);

    // A prior assistant turn, so the rule-2 window has a left edge. Without
    // one the window is empty and silence is correct.
    const { responder: priming } = recordingResponder();
    await runTurn(
      { utterance: "Hello.", userId },
      deps(fakeExtractor([intent({ kind: "context" })]), priming),
    );

    await withTransaction(pool, (tx) =>
      commitments.createCommitment(tx, {
        ownerId: barkha.id,
        recipientId: null,
        objectText: "the article",
        expectedAt: deadline,
        status: "pending",
        projectId: null,
      }),
    );

    const { responder } = recordingResponder();
    const result = await runTurn(
      { utterance: "Thanks.", userId },
      deps(fakeExtractor([intent({ kind: "context" })]), responder),
    );

    // Appended deterministically, never through the model — the fake
    // responder returns "ok", so anything beyond it came from the gate.
    expect(result.reply).toContain("the article");
    expect(result.reply).toContain("overdue");
  });

  it("stays silent when the turn already asks a question", async () => {
    // RULE 3. The user is already being asked for one thing; a second line is
    // the confirmation fatigue §27 forbids.
    const barkha = await seedBarkha();

    const { responder: priming } = recordingResponder();
    await runTurn(
      { utterance: "Hello.", userId },
      deps(fakeExtractor([intent({ kind: "context" })]), priming),
    );

    await withTransaction(pool, (tx) =>
      commitments.createCommitment(tx, {
        ownerId: barkha.id,
        recipientId: null,
        objectText: "the article",
        expectedAt: new Date(Date.now() - 60 * 60 * 1000),
        status: "pending",
        projectId: null,
      }),
    );

    const { responder } = recordingResponder();
    const result = await runTurn(
      // An information intent with no objectText asks a blocking question.
      { utterance: "Barkha needs to give me something.", userId },
      deps(fakeExtractor([intent({ kind: "information", owner: mention("Barkha") })]), responder),
    );

    expect(result.asked.length).toBeGreaterThan(0);
    expect(result.reply).not.toContain("overdue");
  });
});
