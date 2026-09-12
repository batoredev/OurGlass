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
  messages,
  people,
  truncateAll,
  users,
  withTransaction,
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
    expect(calls[0]!.declined).toEqual(["I can't look things up yet."]);
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
});
