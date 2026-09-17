/**
 * The orchestrator — one utterance in, one reply out.
 *
 * docs/PHASE-3-DESIGN.md §3. Four stages, and two of the cells in §3.1's
 * table are trust boundaries stated as PROHIBITIONS rather than capabilities:
 *
 *   Interpret  utterance          -> ExtractionResult   NO DB        Sonnet, forced tool
 *   Resolve    extraction + tx    -> ToolCall[] + asks  read only    NO MODEL
 *   Mutate     ToolCall[]         -> ExecuteTurnOutcome one tx       NO MODEL
 *   Respond    plain summary      -> string             NO DB        Haiku, no tools
 *
 * Interpret never receives a database handle (Phase 2's design) and Respond
 * never receives one either (§5). Between them sit Resolve and Mutate, which
 * are entirely deterministic — every UUID in this system is produced by code
 * in those two stages, never by a model.
 */
import { randomUUID } from "node:crypto";
import {
  validateIntentCompleteness,
  type CommittedFact,
  type ExtractedIntent,
  type ExtractionResult,
  type IntentCompletenessIssue,
  type Responder,
  type RespondInput,
  type RespondOutput,
  type ToolCall,
} from "@ourglass/shared";
import {
  commitments,
  entityRecords,
  memories,
  messages,
  people,
  permissions,
  users,
  type CurrentCommitment,
} from "@ourglass/db";
import type { DatabaseTransaction } from "@ourglass/shared";
import { ExtractionError, type Extractor } from "./extract.js";
import {
  decideCompletion,
  detectDuplicate,
  resolvePersonMention,
  type EntityResolution,
} from "./resolve.js";
import { renderInspection, runInspection, type InspectionQuery } from "./inspect.js";
import {
  detectTimeConflicts,
  findNewlyOverdue,
  renderProactiveLine,
  selectProactiveLine,
} from "./proactive.js";
import { templateReply, type RespondTrace } from "./respond.js";
import { resolveTime, timeDirectionForIntent, type ResolvedTime } from "./time.js";
import { executeTurn, type Deps as ExecutorDeps } from "../tools/index.js";
import type { QueryEmbedder } from "../embeddings/backfill.js";
import { gateIntentCalls, loadGrants, type GateDecision } from "../permissions/gate.js";
import { PENDING_ACTION_TTL_SECONDS } from "../permissions/policy.js";

export interface TurnRequest {
  readonly utterance: string;
  /** The users row — supplies BOTH the timezone and the self person id. */
  readonly userId: string;
  /** Injectable clock; defaults to new Date(). Every test pins it. */
  readonly now?: Date;
}

export interface TurnResponse {
  /** NULL when nothing was mutated — see the turn_id note below. */
  readonly turnId: string | null;
  readonly reply: string;
  /** Clarifications raised this turn. */
  readonly asked: readonly string[];
  /** Tool names actually applied. */
  readonly committed: readonly string[];
  /** true when the template fallback produced `reply` (§5.2). */
  readonly degraded: boolean;
}

/**
 * A Responder that also hands back its trace (§8).
 *
 * `Responder` in @ourglass/shared returns only `{ reply, degraded }` — that is
 * the contract Respond is BUILT against, and widening it there would push a
 * persistence concern into the shared trust-boundary file. Widening it HERE
 * instead keeps §5.1 intact: the trace still carries no ids, and the
 * orchestrator is the only layer that has both a trace and a DB handle.
 *
 * `HaikuResponder` already satisfies this (`respondWithTrace`); a bare
 * `TemplateResponder` does not, which is why `respondWithTrace` below falls
 * back to synthesising a trace rather than requiring one.
 */
export interface TracingResponder extends Responder {
  respondWithTrace?(input: RespondInput): Promise<RespondOutput & { trace: RespondTrace }>;
}

export interface OrchestratorDeps extends ExecutorDeps {
  readonly extractor: Extractor;
  readonly responder: TracingResponder;
  /**
   * Semantic half of memory recall (PHASE-4-DESIGN §3). Optional: without it,
   * recall is lexical-only — exactly the behaviour before hybrid retrieval was
   * wired — rather than an error.
   */
  readonly embedder?: QueryEmbedder | undefined;
}

/**
 * A missing user row is a DEPLOYMENT fault, not a conversational one.
 *
 * §3.2.1: timezone flows from `users.timezone` with no process.env, no
 * constant, and no default at the call site. Inventing "Asia/Kolkata" here
 * would hide a half-provisioned database behind plausible-looking replies
 * that are silently an hour or twelve wrong.
 */
export class UnknownUserError extends Error {
  constructor(readonly userId: string) {
    super(`No user row for id ${userId}; run ensureUser before serving turns`);
    this.name = "UnknownUserError";
  }
}

/**
 * One intent, after Resolve has had a go at it.
 *
 * `blocked` is computed in two passes: directly (this intent has an
 * unresolved mention or a blocking completeness issue) and then transitively
 * (this intent depends on one that is blocked). `dependsOn` holds indices
 * into the same array.
 */
interface PlannedIntent {
  readonly index: number;
  readonly intent: ExtractedIntent;
  /** The tool calls this intent contributes, in order. Empty when blocked. */
  readonly calls: readonly ToolCall[];
  /** Indices of intents whose ids this one references. */
  readonly dependsOn: readonly number[];
  /** Why this intent cannot commit. Empty means it can. */
  readonly questions: readonly string[];
  /** Honest declines that are NOT questions and never block anything. */
  readonly declined: readonly string[];
  /** Facts to hand Respond if the calls commit. Parallel to `calls`. */
  readonly facts: readonly CommittedFact[];
  /**
   * Answers to §28 inspection queries — statements of fact read from rows.
   *
   * A SEPARATE CHANNEL from `declined`, deliberately. Both end up in the
   * reply, so routing an answer through `declined` would work — and would
   * label "Barkha owes you the article" as a REFUSAL in the trace, making
   * §8's persisted history lie about what the assistant did. Distinguishing
   * "I answered" from "I could not" is the point of having a trace.
   */
  readonly answers: readonly string[];
}

export async function runTurn(req: TurnRequest, deps: OrchestratorDeps): Promise<TurnResponse> {
  const now = req.now ?? new Date();

  // ---- Identity and timezone (§3.2.1, resolving F2 and F3) ----------------
  //
  // getUserWithPerson, NOT getUser(...).person_id. The raw stored person_id
  // still points at the LOSER after a merge; getUserWithPerson runs it
  // through resolve_person and hands back the survivor. Feeding the raw id
  // to the first-person short-circuit would resolve "me" to a person absent
  // from people_current — the packages/db READ SHAPE 1-vs-2 trap, on the
  // single most load-bearing id in the product.
  const account = await deps.db.withTransaction((tx) => users.getUserWithPerson(tx, req.userId));
  if (!account) throw new UnknownUserError(req.userId);
  const timezone = account.user.timezone;
  // null is a SUPPORTED state, not an error: a user row with no linked person
  // is half-built, and the honest outcome is that "me" falls through to
  // similarity scoring, rejects, and becomes a question. Not a crash.
  const selfPersonId = account.self?.id ?? null;

  // ---- Step 1 (§3.2): the user message, BEFORE Interpret ------------------
  //
  // Before, not after, and it is deliberate on two counts. It must survive a
  // FAILED turn - an utterance the model choked on is exactly the one worth
  // reading back - and Phase 4 relationships.source_message_id needs a row
  // to point at. turn_id is NULL here and is filled in at step 5 only if
  // something actually committed.
  const userMessage = await deps.db.withTransaction((tx) =>
    messages.createMessage(tx, { role: "user", body: req.utterance }),
  );

  // ---- Interpret ----------------------------------------------------------
  let interpretation: ExtractionResult;
  try {
    interpretation = await deps.extractor.extract(req.utterance);
  } catch (error: unknown) {
    if (error instanceof ExtractionError) {
      // TEMPLATE, never a Haiku call (§3.4). The model just failed; calling
      // another one to explain the failure adds a second thing that can fail,
      // on a path whose entire job is degrading honestly.
      const reply = replyForExtractionFailure(error);
      // §8.2: "trace is written even when the turn mutates nothing" - and a
      // failed extraction is the single most valuable turn to have a trace
      // for. ExtractionError carries no ExtractionTrace (no usage, no
      // latency: the call may never have returned one), so what is recorded
      // is the failure taxonomy itself, which is what makes a systematic
      // refusal distinguishable from a one-off blip.
      await persistAssistantMessage(deps, {
        turnId: null,
        reply,
        degraded: true,
        trace: {
          stage: "interpret",
          failed: true,
          reason: error.reason,
          stopReason: error.stopReason,
        },
      });
      return {
        turnId: null,
        reply,
        asked: [],
        committed: [],
        degraded: true,
      };
    }
    throw error;
  }

  // ---- Recall queries, embedded OUTSIDE any transaction -------------------
  const queryEmbeddings = await embedRecallQueries(interpretation.extraction.intents, deps.embedder);

  // ---- Resolve (read only; writes nothing) --------------------------------
  const { resolved, grants } = await deps.db.withTransaction(async (tx) => ({
    resolved: await planIntents(interpretation.extraction.intents, {
      tx,
      now,
      timezone,
      selfPersonId,
      queryEmbeddings,
    }),
    grants: await loadGrants(tx),
  }));

  // ---- The §35 permission gate (PHASE-7-PERMISSIONS-DESIGN §4) -------------
  //
  // An intent whose calls need confirmation is HELD: it gets a question, so
  // the partial-commit rule below blocks it — and every intent depending on
  // it — with no second blocking mechanism. Its calls are recorded as a
  // pending action once the blocked set is known.
  const holds = new Map<number, Extract<GateDecision, { decision: "confirm" }>>();
  for (const entry of resolved) {
    if (entry.calls.length === 0 || entry.questions.length > 0) continue;
    const gate = gateIntentCalls(entry.calls, grants);
    if (gate.decision === "confirm") holds.set(entry.index, gate);
  }
  const planned: readonly PlannedIntent[] = resolved.map((entry) => {
    const hold = holds.get(entry.index);
    return hold ? { ...entry, questions: [confirmationQuestion(hold)] } : entry;
  });

  if (holds.size > 0) {
    await deps.db.withTransaction(async (tx) => {
      for (const entry of resolved) {
        const hold = holds.get(entry.index);
        if (!hold) continue;
        await permissions.createPendingAction(tx, {
          calls: entry.calls,
          riskLevel: hold.risk,
          summary: summarizeHeld(entry),
          ttlSeconds: PENDING_ACTION_TTL_SECONDS,
          sourceMessageId: userMessage.id,
        });
      }
    });
  }

  // ---- The partial-commit rule (§3.3) -------------------------------------
  const blocked = blockedIntentIndices(planned);
  const committable = planned.filter((entry) => !blocked.has(entry.index));
  const calls = committable.flatMap((entry) => entry.calls);

  const questions = planned
    .filter((entry) => blocked.has(entry.index))
    .flatMap((entry) => questionsFor(entry));
  const declined = planned.flatMap((entry) => entry.declined);
  // §28 answers, kept OUT of the Respond call on purpose — see below.
  const answers = planned.flatMap((entry) => entry.answers);

  // ---- Mutate -------------------------------------------------------------
  let turnId: string | null = null;
  let committedFacts: readonly CommittedFact[] = [];
  let committedTools: readonly string[] = [];
  const failures: string[] = [];

  // NON-EMPTY GUARD, and it is load-bearing rather than defensive.
  //
  // executeTurn's FIRST line is `const turnId = randomUUID()`, unconditionally
  // (apps/api/src/tools/executor.ts). So executeTurn([]) returns ok:true with
  // a real turnId naming ZERO action_log rows — precisely the state §3.2
  // declines to create when it rejects hoisting id generation into this file,
  // and precisely what migration 004's "NULL for messages that produced no
  // mutation" comment forbids. A turn that mutates nothing has turn_id NULL.
  if (calls.length > 0) {
    const outcome = await executeTurn(calls, deps);
    if (outcome.ok) {
      turnId = outcome.turnId;
      // Facts are reconciled against what the tools ACTUALLY returned, not
      // against what Resolve predicted. Lateness is the concrete reason:
      // §2 derives it inside complete_commitment from two timestamptz
      // columns, so this layer cannot know it before the call runs, and
      // Respond must not be handed a guess. See reconcileFacts.
      committedFacts = reconcileFacts(
        committable.flatMap((entry) => entry.facts),
        outcome.results,
      );
      committedTools = calls.map((call) => call.name);
    } else {
      // Validation failure: the executor's contract is that NOTHING was
      // written. The ToolError messages are already written user-facing with
      // no SQL and no stack, so they are safe to surface verbatim.
      failures.push(...outcome.errors.map((error) => error.message));
    }
  }

  // ---- Step 5 (§3.2): back-fill turn_id on the user message ---------------
  //
  // The cost of NOT hoisting turn_id generation into this file: one extra
  // write, paid once per MUTATING turn. A turn that mutated nothing skips
  // this and correctly keeps turn_id NULL, which is what migration 004 says
  // the column means.
  if (turnId !== null) {
    const committedTurnId = turnId;
    await deps.db.withTransaction((tx) =>
      messages.setTurnId(tx, userMessage.id, committedTurnId),
    );
  }

  // ---- Respond ------------------------------------------------------------
  //
  // ⚠ THE MUTATION HAS ALREADY COMMITTED. Nothing below here may throw in a
  // way that loses it, and this is now ENFORCED rather than assumed.
  //
  // The previous version said "HaikuResponder.respondWithTrace never throws by
  // construction" and relied on it. That is true of HaikuResponder and of the
  // routed adapters — and of nothing else. A TemplateResponder, a test double,
  // or any third-party Responder can throw, and when one did, the error
  // propagated out of runTurn: a durable write became a 500, and the user was
  // invited to retype an utterance that had already succeeded, producing the
  // duplicate §23 exists to prevent.
  //
  // CI's scenario-D integration test caught it. A comment asserting a
  // guarantee is a citation, not a verification.
  const respondInput: RespondInput = {
    committed: committedFacts,
    questions: [...questions, ...failures],
    declined,
  };

  let modelReply: string;
  let degraded: boolean;
  let respondTrace: RespondTrace | { model: null; degraded: boolean };
  try {
    ({ reply: modelReply, degraded, trace: respondTrace } = await respondWithTrace(
      deps.responder,
      respondInput,
    ));
  } catch (error: unknown) {
    // The deterministic template is always correct and always available — it
    // is pure, synchronous, and separately unit-tested precisely because it is
    // the thing that must work when nothing else does.
    modelReply = templateReply(respondInput);
    degraded = true;
    respondTrace = { model: null, degraded: true };
    // Swallowed but NOT silent: "degrade honestly" applies to observability
    // too, and this is the only record that a responder broke its contract.
    console.error("[turn] responder threw; fell back to the template:", error);
  }

  // ---- §28 answers are PREPENDED VERBATIM, never paraphrased --------------
  //
  // An inspection answer is a list of FACTS read from rows. Handing it to
  // Haiku to reword adds a way for the content to come out wrong — a dropped
  // item, a softened "about three things" — while adding nothing, because
  // there is no judgement to make about what the rows say. §31 conciseness is
  // already satisfied by the deterministic renderer.
  //
  // The model still runs for the rest of the turn (a mixed utterance can both
  // ask and commit), so its reply is appended after, not discarded.
  const composed =
    answers.length > 0
      ? [answers.join(" "), modelReply].filter((part) => part.trim() !== "").join(" ")
      : modelReply;

  // ---- §26: at most ONE volunteered line, and only if it earned it --------
  //
  // DETERMINISTIC, never a model call. §26's boundary between good and bad
  // proactivity is exactly the boundary a prompt cannot be tested against;
  // renderProactiveLine has no branch that can produce advice, so the
  // assistant structurally cannot drift into "you should study now".
  //
  // Appended AFTER the model reply rather than handed to Haiku as input,
  // for the same reason §28 answers are prepended verbatim: there is no
  // judgement to make about what the rows say, and rewording them only adds
  // ways to be wrong.
  //
  // The gate itself lives in selectProactiveLine — rule 3 (never alongside a
  // question) is enforced there, by a signature that can only return one
  // candidate.
  const volunteered = await deps.db.withTransaction(async (tx) => {
    const since = await previousAssistantTurnAt(tx, now);
    const candidates = await findNewlyOverdue(tx, since, now);
    return selectProactiveLine(candidates, {
      // `failures` are surfaced through `questions` too, and a turn that just
      // told the user a write was rejected is not one to volunteer on.
      turnAsksQuestion: questions.length > 0 || failures.length > 0,
    });
  });

  const reply =
    volunteered === null
      ? composed
      : [composed, renderProactiveLine(volunteered, (iso) => formatLocal(iso, timezone))]
          .filter((part) => part.trim() !== "")
          .join(" ");

  // ---- Step 7 (§8): the assistant message, with both stages traces --------
  //
  // Wrapped so a persistence failure cannot lose a committed mutation or turn
  // a good reply into a 500. See persistAssistantMessage.
  await persistAssistantMessage(deps, {
    turnId,
    reply,
    degraded,
    trace: {
      stage: "respond",
      interpret: interpretation.trace,
      respond: respondTrace,
    },
  });

  return {
    turnId,
    reply,
    asked: questions,
    committed: committedTools,
    degraded,
  };
}

/**
 * When the user was last spoken to — the left edge of §26's rule-2 window.
 *
 * ⚠ THE WINDOW IS THE WHOLE RULE. "Is overdue" stays true on every turn until
 * the thing is completed, and surfacing that repeatedly is the nagging §26
 * puts in its "bad" column. "JUST became overdue" is true exactly once, and
 * it is true only relative to when we last spoke.
 *
 * Falls back to `now`, which yields an EMPTY window and therefore silence.
 * That is the correct default for a first turn: we cannot tell whether the
 * user already knows, so we say nothing.
 *
 * Reads the last ASSISTANT message. This runs before the current turn's
 * assistant message is persisted, so the newest one is genuinely the previous
 * turn's. `listRecent` returns oldest-first, hence the reversed scan.
 */
async function previousAssistantTurnAt(tx: DatabaseTransaction, now: Date): Promise<Date> {
  const recent = await messages.listRecent(tx, 20);
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    if (message?.role === "assistant") return message.t_created;
  }
  return now;
}

/**
 * Call the responder, obtaining a trace whether or not it can produce one.
 *
 * A `TemplateResponder` (or any test double satisfying the plain `Responder`
 * contract) has no `respondWithTrace`. Rather than force every implementation
 * to carry trace machinery it has no model call to describe, synthesise the
 * honest minimum: it is a template, so `degraded` is whatever it reported and
 * there is no model, latency, or token usage to record. `model: null` is the
 * signal that NO MODEL WAS CALLED — distinct from a model that was called
 * and failed, which carries a `fallbackReason`.
 */
async function respondWithTrace(
  responder: TracingResponder,
  input: RespondInput,
): Promise<RespondOutput & { trace: RespondTrace | { model: null; degraded: boolean } }> {
  if (typeof responder.respondWithTrace === "function") {
    return await responder.respondWithTrace(input);
  }
  const output = await responder.respond(input);
  return { ...output, trace: { model: null, degraded: output.degraded } };
}

/**
 * Persist the assistant message and its trace — and NEVER let that failure
 * propagate.
 *
 * By the time this runs the mutation is durable and the user has a correct
 * reply. Throwing here would turn a successful turn into a 500 and invite the
 * user to retry an utterance that ALREADY committed, producing a duplicate —
 * the exact wrong-merge-adjacent damage DECISIONS.md #9 ranks worst.
 *
 * It is swallowed but NOT silent: .claude/rules/ai-systems.md "degrade
 * honestly" applies to observability too, so the failure is logged with the
 * turn id, which is enough to reconstruct the turn from action_log even
 * though its message row is missing.
 */
async function persistAssistantMessage(
  deps: OrchestratorDeps,
  entry: { turnId: string | null; reply: string; degraded: boolean; trace: unknown },
): Promise<void> {
  try {
    await deps.db.withTransaction((tx) =>
      messages.createMessage(tx, {
        role: "assistant",
        body: entry.reply,
        turnId: entry.turnId,
        trace: entry.trace,
        degraded: entry.degraded,
      }),
    );
  } catch (error: unknown) {
    // console, not the API pino logger: that logger is request-scoped and is
    // not threaded through OrchestratorDeps. Losing this entirely would make
    // a systematically failing trace write invisible, which is the one thing
    // a swallowed error must never be. Replace with the request logger when
    // the server wiring grows one.
    console.error(
      `failed to persist assistant message for turn ${entry.turnId ?? "(none)"}:`,
      error,
    );
  }
}

/**
 * Overlay real tool output onto the predicted facts, positionally.
 *
 * `facts` and `results` are parallel: one fact per tool call, in call order,
 * built by the same loop that built the calls. Only fields the TOOL owns are
 * overlaid — currently `latenessMs`, which §2 derives inside
 * complete_commitment from `expected_at` and `completed_at` and which this
 * layer therefore cannot know before the call runs.
 *
 * Why it matters rather than being tidiness: without this, a five-hour-late
 * completion reports as "marked complete" with no lateness, and spec §20 —
 * the entire point of the completion path — is silently unreachable. The
 * failure would be invisible, because the row IS correct; only the sentence
 * is wrong.
 *
 * Defensive on shape because a tool's output type is not enforced at this
 * boundary: a missing or malformed field leaves the predicted value rather
 * than throwing, since the mutation has already committed and a cosmetic
 * mismatch must never cost the write.
 */
export function reconcileFacts(
  facts: readonly CommittedFact[],
  results: readonly unknown[],
): readonly CommittedFact[] {
  return facts.map((fact, index) => {
    if (fact.kind !== "commitment_completed") return fact;
    const result = results[index];
    if (typeof result !== "object" || result === null) return fact;
    const lateness = (result as { latenessMs?: unknown }).latenessMs;
    if (typeof lateness !== "number" && lateness !== null) return fact;
    return { ...fact, latenessMs: lateness };
  });
}

// ---------------------------------------------------------------------------
// §3.3 — the partial-commit rule.
// ---------------------------------------------------------------------------

/**
 * Intents that must not commit: those with an open question of their own,
 * plus the TRANSITIVE CLOSURE of everything depending on them.
 *
 * ============================ READ BEFORE EDITING ==========================
 * THE TRANSITIVE CLOSURE IS THE ENTIRE SAFETY PROPERTY. It is not an
 * optimisation and it is not defensive depth.
 *
 * The design document's original pseudocode had a fourth line —
 *   `if (blocked ∩ dependencyRootsOf(committable)) is non-empty → abort`
 * — presented as the guard that makes worked example 2 ("two Barkhas exist")
 * abort the whole turn. That line is DEAD CODE: this closure already
 * guarantees `committable` contains nothing depending on anything blocked, so
 * the intersection is necessarily empty and the branch can never fire. The
 * abort behaviour the design wants is produced HERE, by this closure, plus
 * runTurn's non-empty guard on `calls`.
 *
 * The trap that leaves: someone "simplifying" this to a single-hop check —
 * reasonably, because the deleted line LOOKED like the real backstop — gets
 * an ORPHAN REMINDER committed against a commitment that was never created.
 * That is the exact failure §3.3 exists to prevent. There is no other guard.
 * See orchestrator.test.ts's orphan-reminder test.
 * ===========================================================================
 */
export function blockedIntentIndices(planned: readonly PlannedIntent[]): ReadonlySet<number> {
  const blocked = new Set<number>();
  for (const entry of planned) {
    if (entry.questions.length > 0) blocked.add(entry.index);
  }

  // Fixed-point iteration rather than one pass: A blocked, B depends on A, C
  // depends on B. A single pass over `planned` in index order would catch B
  // and C only if they happen to be ordered after A, which is true for
  // utterance-ordered intents today and is not a property worth relying on.
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of planned) {
      if (blocked.has(entry.index)) continue;
      if (entry.dependsOn.some((dependency) => blocked.has(dependency))) {
        blocked.add(entry.index);
        grew = true;
      }
    }
  }
  return blocked;
}

/**
 * What to ask about a blocked intent.
 *
 * An intent blocked only TRANSITIVELY (its own `questions` is empty — it was
 * blocked because something it depends on is a question) contributes no
 * question of its own. Asking "who is Barkha?" and "what should the reminder
 * say?" for one two-intent utterance is the confirmation fatigue §27 forbids;
 * the user answers the first and the second resolves itself.
 */
function questionsFor(entry: PlannedIntent): readonly string[] {
  // Takes only the entry: the suppression above is already STRUCTURAL, not
  // something this function computes. `blockedIntentIndices` adds an intent
  // directly only when its OWN `questions` is non-empty, and adds every
  // transitive dependent separately; a transitively-blocked entry therefore
  // arrives here with an empty array and contributes nothing on its own.
  // Passing `planned` and `blocked` in to re-derive that was dead weight and
  // read as though a second rule lived here.
  return entry.questions;
}

// ---------------------------------------------------------------------------
// Resolve — extraction to tool calls.
// ---------------------------------------------------------------------------

interface PlanContext {
  readonly tx: DatabaseTransaction;
  readonly now: Date;
  readonly timezone: string;
  readonly selfPersonId: string | null;
  /**
   * Query embeddings computed BEFORE the Resolve transaction opened, keyed by
   * the exact text embedded. Planning runs inside a transaction and must never
   * make a network call — see `embedRecallQueries`.
   */
  readonly queryEmbeddings: ReadonlyMap<string, readonly number[]>;
}

async function planIntents(
  intents: readonly ExtractedIntent[],
  ctx: PlanContext,
): Promise<readonly PlannedIntent[]> {
  const issues = validateIntentCompleteness({ intents });
  const planned: PlannedIntent[] = [];
  // Intent index -> the commitment UUID it creates. This is what the
  // dependency graph is built from, and the ids are MINTED here rather than
  // read back from executeTurn — see mintedCommitmentId below.
  const commitmentIdByIntent = new Map<number, string>();

  for (const [index, intent] of intents.entries()) {
    planned.push(
      await planOneIntent(intent, index, ctx, issues, commitmentIdByIntent),
    );
  }
  return planned;
}

async function planOneIntent(
  intent: ExtractedIntent,
  index: number,
  ctx: PlanContext,
  issues: readonly IntentCompletenessIssue[],
  commitmentIdByIntent: Map<number, string>,
): Promise<PlannedIntent> {
  const questions: string[] = [];
  const declined: string[] = [];
  const answers: string[] = [];
  const calls: ToolCall[] = [];
  const facts: CommittedFact[] = [];
  const dependsOn: number[] = [];

  // BLOCKING issues become questions; ADVISORY ones never do.
  //
  // assistant-contract.ts's COMMITMENT_BEARING_NOTE is explicit that advisory
  // means "do not create a commitment from this intent", NOT "interrogate the
  // user". Treating an advisory missing owner as a question makes the
  // assistant ask "who owns 'the Hult meeting is cancelled'?" — nonsense, and
  // exactly the over-asking spec §27 exists to prevent.
  const own = issues.filter((issue) => issue.intentIndex === index);
  for (const issue of own.filter((candidate) => candidate.severity === "blocking")) {
    questions.push(questionForMissingField(issue));
  }
  const hasAdvisoryOwnerGap = own.some(
    (issue) => issue.severity === "advisory" && issue.missingField === "owner",
  );

  switch (intent.kind) {
    case "question":
      // Anything the assistant cannot answer from structured state. Phase 4
      // narrowed this considerably: what used to fall here now mostly routes
      // to `inspection` below. What remains — "what happened with the
      // article?" — is genuinely open-ended, and declining is honest.
      declined.push("I can't look that up yet.");
      break;

    case "inspection": {
      // §28. A READ: no tool call, no turn_id, no action_log row. The answer
      // is a fact from a WHERE clause, never an approximate index (§5, F11).
      const plan = await planInspection(intent, ctx);
      questions.push(...plan.questions);
      declined.push(...(plan.declined ?? []));
      answers.push(...(plan.answers ?? []));
      break;
    }

    case "execution":
      // Spec §5: a request for an external action is not permission to carry
      // it out, and Phase 3 has no external side effects at all. Declining is
      // the whole behaviour.
      declined.push("I can't do things outside this conversation yet.");
      break;

    case "context": {
      // THREE DIFFERENT ACTS wear the `context` label, and the extractor tells
      // them apart by WHICH FIELD IT FILLED — never by re-reading the
      // sentence here:
      //
      //   correctionTarget -> something on record is wrong (§17)
      //   memoryBody       -> a durable fact worth keeping (§16)
      //   neither          -> a note about a commitment (§20)
      //
      // Order matters: a CORRECTION also carries memoryBody (the
      // replacement), so it must be tested first or every correction would be
      // stored as a new fact with the wrong one left standing.
      const plan = intent.correctionTarget
        ? await planCorrection(intent, ctx)
        : intent.memoryBody
          ? await planRemember(intent, ctx)
          : await planContext(intent, ctx);
      questions.push(...plan.questions);
      calls.push(...plan.calls);
      facts.push(...plan.facts);
      declined.push(...(plan.declined ?? []));
      break;
    }

    case "completion_update": {
      const plan = await planCompletion(intent, ctx);
      questions.push(...plan.questions);
      calls.push(...plan.calls);
      facts.push(...plan.facts);
      break;
    }

    case "information": {
      if (hasAdvisoryOwnerGap) {
        // An ownerless statement of fact ("the Hult meeting is cancelled").
        // Not a commitment, so nothing to write — and per the note above,
        // nothing to ask either.
        break;
      }
      // §22: "Arun still hasn't sent the schema" must UPDATE the existing
      // commitment, not create a second one. planStatusUpdate returns null
      // when nothing matched, and then creating it is right — the user is
      // telling us about a commitment we have not heard of.
      const statusPlan = intent.newStatus ? await planStatusUpdate(intent, ctx) : null;
      const plan = statusPlan ?? (await planCommitment(intent, ctx));
      questions.push(...plan.questions);
      calls.push(...plan.calls);
      facts.push(...plan.facts);
      declined.push(...(plan.declined ?? []));
      if (plan.commitmentId) commitmentIdByIntent.set(index, plan.commitmentId);
      break;
    }

    case "action": {
      // An `action` is something to do INSIDE the assistant, and four fields
      // can carry what that is. Each feeds a DIFFERENT tool, which is why
      // assistant-contract.ts lets any of them satisfy the body requirement:
      // create_workflow never reads reminderBody, and set_reminder never
      // reads condition.
      const plan = intent.condition
        ? await planWorkflow(intent, ctx)
        : intent.entityTypeDefinition
          ? planDefineEntityType(intent)
          : intent.entityRecord
            ? await planCreateEntityRecord(intent, ctx)
            : intent.eventTitle
              ? await planEvent(intent, ctx)
              : planReminder(intent, ctx, commitmentIdByIntent);
      questions.push(...plan.questions);
      calls.push(...plan.calls);
      facts.push(...plan.facts);
      declined.push(...(plan.declined ?? []));
      dependsOn.push(...(plan.dependsOn ?? []));
      break;
    }

    default:
      break;
  }

  // A blocked intent contributes NO tool calls. Belt and braces: runTurn
  // filters blocked intents out of `calls` anyway, but an intent that both
  // asks a question and emits a call is a contradiction, and leaving the
  // calls in would make the filter the only thing preventing a write.
  return {
    index,
    intent,
    calls: questions.length > 0 ? [] : calls,
    dependsOn,
    questions,
    declined,
    answers,
    facts: questions.length > 0 ? [] : facts,
  };
}

interface IntentPlan {
  /**
   * Honest declines this plan produced. Only `context` uses it today: an
   * unattachable note is NOT a question (asking "which commitment?" about a
   * passing remark is the over-asking §27 forbids) and NOT a silent drop
   * either — the user said something and deserves to know it did not land.
   */
  readonly declined?: readonly string[];
  /** §28 answers — see PlannedIntent.answers for why this is not `declined`. */
  readonly answers?: readonly string[];
  readonly calls: readonly ToolCall[];
  readonly facts: readonly CommittedFact[];
  readonly questions: readonly string[];
  readonly dependsOn?: readonly number[];
  readonly commitmentId?: string;
}

/** An `information` intent that bears a commitment: "Barkha needs to give me the article by 6." */
async function planCommitment(intent: ExtractedIntent, ctx: PlanContext): Promise<IntentPlan> {
  const questions: string[] = [];

  const owner = await resolveParty(intent.owner, ctx);
  const recipient = await resolveParty(intent.recipient, ctx);
  if (owner.question) questions.push(owner.question);
  if (recipient.question) questions.push(recipient.question);
  if (!intent.objectText) questions.push(`What is it ${describeMention(intent.owner)} owes?`);
  if (questions.length > 0 || !owner.id || !intent.objectText) {
    return { calls: [], facts: [], questions };
  }

  const time = resolveIntentTime(intent, ctx);
  if (time?.tier === "unresolved") {
    questions.push(`When is "${time.sourcePhrase}"?`);
    return { calls: [], facts: [], questions };
  }
  const expectedAt = time?.tier === "deterministic" ? time.at : null;

  // ┌─ §23: DO NOT CREATE THE SAME COMMITMENT TWICE ─────────────────────────┐
  // │ detectDuplicate has existed since Phase 2, with its hard vetoes and    │
  // │ three-band policy, and nothing called it. Saying the same thing twice  │
  // │ produced two rows — and a duplicate is not cosmetic here: it doubles   │
  // │ what the user believes they are waiting on, which is the one number    │
  // │ this product exists to get right.                                      │
  // │                                                                        │
  // │ The bands are NOT symmetric, and DECISIONS.md #9 is why. A wrong MERGE │
  // │ silently destroys a commitment; a wrong SPLIT leaves a visible         │
  // │ duplicate the user can correct by saying so. So the auto band is       │
  // │ deliberately near-unreachable (0.92 on content-token overlap), the     │
  // │ ambiguous band ASKS, and everything else creates.                      │
  // └────────────────────────────────────────────────────────────────────────┘
  const open = await commitments.listOpenForOwner(ctx.tx, owner.id, recipient.id);
  const duplicate = detectDuplicate(
    {
      ownerId: owner.id,
      recipientId: recipient.id,
      objectText: intent.objectText,
      status: "pending",
    },
    open,
  );

  if (duplicate.kind === "ask") {
    const candidate = open.find((row) => row.id === duplicate.commitmentIds[0]);
    return {
      calls: [],
      facts: [],
      questions: [
        candidate
          ? `Is that the same as "${candidate.object_text}", or something new?`
          : "Is that the same thing you mentioned before, or something new?",
      ],
    };
  }

  if (duplicate.kind === "auto_match") {
    const existing = open.find((row) => row.id === duplicate.commitmentId);
    const priorExpectedAt = existing?.expected_at?.toISOString() ?? null;

    // A RESTATEMENT WITH A NEW DEADLINE IS AN UPDATE, not a no-op: "the
    // article by 6" then "the article by 8" is §22's conversational update,
    // and treating it as a duplicate would silently keep the stale time.
    if (expectedAt !== null && expectedAt !== priorExpectedAt) {
      return {
        questions: [],
        calls: [
          {
            name: "update_commitment",
            input: { commitment_id: duplicate.commitmentId, expected_at: expectedAt },
          },
        ],
        facts: [{ kind: "commitment_updated", objectText: intent.objectText, status: null }],
      };
    }

    // Nothing changed. `declined` rather than silence: the user said
    // something and deserves to know it did not land as a new row — the same
    // reasoning planContext uses for an unattachable note.
    return {
      calls: [],
      facts: [],
      questions: [],
      declined: [`Already tracking ${intent.objectText}.`],
    };
  }

  // THE ID IS MINTED HERE, not read back from executeTurn.
  //
  // create_reminder.commitment_id must point at a commitment created by
  // ANOTHER call in the SAME turn, whose UUID does not exist until that call
  // runs — and executeTurn passes call.input through verbatim with no
  // substitution step. Generating the UUID client-side and stamping it into
  // both calls closes that gap with no change to Phase-1-owned executor code.
  // Postgres does not care whether a uuid PK arrives from gen_random_uuid()
  // or from the client.
  const commitmentId = randomUUID();

  return {
    commitmentId,
    questions: [],
    calls: [
      {
        name: "create_commitment",
        input: {
          id: commitmentId,
          owner_id: owner.id,
          recipient_id: recipient.id,
          object_text: intent.objectText,
          expected_at: expectedAt,
          project_id: null,
        },
      },
    ],
    facts: [
      {
        kind: "commitment_created",
        ownerName: owner.displayName ?? describeMention(intent.owner),
        recipientName: recipient.displayName,
        objectText: intent.objectText,
        expectedAtLocal: expectedAt ? formatLocal(expectedAt, ctx.timezone) : null,
      },
    ],
  };
}

/** A `completion_update` intent: "Barkha gave the article at 11." */
async function planCompletion(intent: ExtractedIntent, ctx: PlanContext): Promise<IntentPlan> {
  const questions: string[] = [];
  const owner = await resolveParty(intent.owner, ctx);
  const recipient = await resolveParty(intent.recipient, ctx);
  if (owner.question) questions.push(owner.question);
  if (recipient.question) questions.push(recipient.question);
  if (!intent.objectText) questions.push("What was completed?");
  if (questions.length > 0 || !owner.id || !intent.objectText) {
    return { calls: [], facts: [], questions };
  }

  // §2.2: direction is MANDATORY and load-bearing. `timeDirectionForIntent`
  // maps completion_update -> "past" through a table we control. A literal
  // "forward" here typechecks perfectly and silently resolves "Barkha gave
  // the article at 11" to TOMORROW at 11 — which then reports the commitment
  // as nineteen hours EARLY. That was one of Phase 2's three confirmed
  // blockers. Never a literal, never a default.
  const time = resolveIntentTime(intent, ctx);
  if (time?.tier === "unresolved") {
    questions.push(`When did that happen — "${time.sourcePhrase}"?`);
    return { calls: [], facts: [], questions };
  }
  const completedAt = time?.tier === "deterministic" ? time.at : ctx.now.toISOString();

  const open = await commitments.listOpenForOwner(ctx.tx, owner.id, recipient.id);
  const match = decideCompletion(
    { ownerId: owner.id, recipientId: recipient.id, objectText: intent.objectText },
    open,
  );

  if (match.kind === "ask") {
    questions.push(questionForCompletionMiss(match, intent, open));
    return { calls: [], facts: [], questions };
  }

  return {
    questions: [],
    calls: [
      {
        name: "complete_commitment",
        input: { commitment_id: match.commitmentId, completed_at: completedAt },
      },
    ],
    facts: [
      {
        kind: "commitment_completed",
        objectText: intent.objectText,
        // Placeholder. Lateness is derived IN THE TOOL from two timestamptz
        // columns (§2), never here and never from model output, so it is not
        // knowable until the call runs. `reconcileFacts` overlays the real
        // value from the tool's output before Respond sees this. `null` is
        // the honest placeholder — it formats as "marked complete" with no
        // lateness CLAIM, so a reconciliation failure under-reports rather
        // than inventing a duration.
        latenessMs: null,
      },
    ],
  };
}

/**
 * A `context` intent: "She had a family emergency." (§20, finding F4.)
 *
 * Attaches the user's words VERBATIM to the commitment they are about. The
 * matching reuses `decideCompletion` — the same owner/recipient/object
 * scorer the completion path uses — rather than a second, subtly different
 * matcher. One scorer means one set of thresholds to reason about, and it
 * inherits the hard vetoes (DECISIONS.md #6) for free.
 *
 * AN UNMATCHED NOTE DECLINES; IT DOES NOT ASK. Context arrives as an aside
 * ("she had a family emergency") far more often than as a command, so
 * interrogating the user about which commitment a passing remark belongs to
 * is exactly the confirmation fatigue §27 forbids. But it is not dropped
 * silently either: the user said something, and the reply says plainly that
 * it was not attached.
 *
 * Contrast with `planCompletion`, which DOES ask on a miss — and correctly,
 * because a completion is a WRITE to an existing commitment's status. Getting
 * that wrong silently stops something appearing in "what am I waiting on".
 * A note that failed to attach costs nothing but the note.
 */
async function planContext(intent: ExtractedIntent, ctx: PlanContext): Promise<IntentPlan> {
  if (!intent.objectText) {
    // Nothing to match on. The note text itself lives in sourceText, but
    // without an object there is no commitment to hang it from.
    return {
      calls: [],
      facts: [],
      questions: [],
      declined: ["I noted that, but I'm not sure which commitment it's about."],
    };
  }

  const owner = await resolveParty(intent.owner, ctx);
  const recipient = await resolveParty(intent.recipient, ctx);
  if (!owner.id) {
    return {
      calls: [],
      facts: [],
      questions: [],
      declined: ["I noted that, but I'm not sure who it's about."],
    };
  }

  const open = await commitments.listOpenForOwner(ctx.tx, owner.id, recipient.id);
  const match = decideCompletion(
    { ownerId: owner.id, recipientId: recipient.id, objectText: intent.objectText },
    open,
  );

  if (match.kind === "ask") {
    return {
      calls: [],
      facts: [],
      questions: [],
      declined: ["I noted that, but I'm not sure which commitment it's about."],
    };
  }

  return {
    questions: [],
    calls: [
      {
        name: "attach_context",
        input: {
          commitment_id: match.commitmentId,
          // sourceText, NOT objectText: §3 says a content field is stored
          // verbatim. The user's own sentence is the note; objectText is only
          // what we matched ON.
          body: intent.sourceText,
          // Provenance is filled in by the orchestrator, which is the only
          // layer holding the message id. Null here rather than a fabricated
          // id — provenance that cannot be followed is worse than none.
          source_message_id: null,
        },
      },
    ],
    // No CommittedFact kind exists for a note, and inventing one would put a
    // second sentence in every reply about context ("Noted: she had a family
    // emergency") — §31 says be concise, and the user just said that
    // sentence themselves. The attachment is silent by design; it surfaces on
    // the commitment, not in the reply.
    facts: [],
  };
}

/**
 * An `information` intent carrying a STATUS: §22.
 *
 * Returns null when no existing commitment matched, which the caller reads as
 * "create it instead". That is deliberate: "the Hult poster is blocked" about
 * something we have never heard of is still news, and refusing it would lose
 * information the user just gave us.
 *
 * AMBIGUITY ASKS rather than guessing. Updating the wrong commitment's status
 * is silent — it does not look like an error, it looks like the other
 * commitment moved — so this follows the three-band policy the entity layer
 * uses (DECISIONS.md #6) rather than taking the top match.
 */
async function planStatusUpdate(intent: ExtractedIntent, ctx: PlanContext): Promise<IntentPlan | null> {
  if (!intent.newStatus || !intent.objectText) return null;

  const owner = await resolveParty(intent.owner, ctx);
  const recipient = await resolveParty(intent.recipient, ctx);
  if (!owner.id) return null;

  const open = await commitments.listOpenForOwner(ctx.tx, owner.id, recipient.id);
  const match = decideCompletion(
    { ownerId: owner.id, recipientId: recipient.id, objectText: intent.objectText },
    open,
  );

  if (match.kind !== "matched") {
    // ┌─ THE REASON MATTERS HERE, AND ONLY HERE ───────────────────────────┐
    // │ decideCompletion COLLAPSES "nothing matched" into `ask`, on         │
    // │ purpose: for a COMPLETION, inventing a retroactive already-done     │
    // │ commitment would hide the real open one (resolve.ts, THE           │
    // │ INVERSION). A STATUS UPDATE is the opposite case — "the article is  │
    // │ blocked" about something unrecorded is news worth keeping, and     │
    // │ asking "which one?" when the answer is "none" is the over-asking   │
    // │ §27 forbids.                                                       │
    // │                                                                    │
    // │ So only genuine AMBIGUITY asks. Everything else falls through to    │
    // │ create. This is what `reason` is for, and reading `kind` alone is   │
    // │ what made a status for an unknown commitment silently do nothing.   │
    // └────────────────────────────────────────────────────────────────────┘
    if (match.reason === "ambiguous") {
      return {
        calls: [],
        facts: [],
        questions: [`Which one do you mean — I have more than one "${intent.objectText}"?`],
      };
    }
    return null;
  }

  return {
    questions: [],
    calls: [
      {
        name: "update_commitment",
        input: { commitment_id: match.commitmentId, status: intent.newStatus },
      },
    ],
    facts: [{ kind: "commitment_updated", objectText: intent.objectText, status: intent.newStatus }],
  };
}

/**
 * A `context` intent carrying a durable fact: §16's `remember`.
 *
 * ┌─ THE MEMORY KIND IS NOT EXTRACTED, AND THAT IS A STATED LIMIT ──────────┐
 * │ `memory_kind` is a closed three-value enum (fact/preference/pattern)    │
 * │ and the contract carries no hint for it, so everything stored from a    │
 * │ conversation is a `fact`.                                              │
 * │                                                                        │
 * │ That is the honest default rather than a guess. `pattern` must be an    │
 * │ OBSERVABLE COUNT per §13 — "postponed this three times" — which a       │
 * │ single utterance almost never establishes, and a regex for "I prefer"   │
 * │ would be a heuristic dressed as extraction. THE FIX IF IT MATTERS IS A  │
 * │ memoryKind HINT IN THE CONTRACT, not cleverness here.                  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * THE SUBJECT IS LINKED WHEN THE EXTRACTOR NAMED ONE. Without it every
 * memory is unattached, `memories.listBySubject` returns nothing forever, and
 * "what do you know about Barkha" cannot reach a fact the user stated about
 * her one turn earlier — the subject column would exist with nothing ever
 * writing to it. An unresolvable mention stores the memory UNATTACHED rather
 * than asking: the fact is still worth keeping, and §27 forbids interrogating
 * the user over a passing remark.
 */
async function planRemember(intent: ExtractedIntent, ctx: PlanContext): Promise<IntentPlan> {
  const body = intent.memoryBody?.trim();
  if (!body) return { calls: [], facts: [], questions: [] };

  const subject = await resolveParty(intent.relatedEntity, ctx);

  return {
    questions: [],
    calls: [
      {
        name: "remember",
        input: {
          kind: "fact",
          body,
          // The extractor's own confidence, passed through unchanged. A
          // memory stored from an UNCERTAIN reading must not claim to be
          // confirmed — §12's levels exist so provenance survives the write.
          inference_level: intent.inferenceLevel,
          // Both or neither — migration 010's CHECK, restated by the tool.
          subject_kind: subject.id ? "person" : null,
          subject_id: subject.id,
          source_message_id: null,
        },
      },
    ],
    facts: [{ kind: "memory_stored", body }],
  };
}

/**
 * A `context` intent that says something on record is WRONG: §17.
 *
 * ┌─ WHY THIS USES THE MEMORY TOOLS AND NOT correct_relationship ───────────┐
 * │ `correct_relationship` takes a typed edge: oldRelationshipId,           │
 * │ subjectId, relType, objectKind, objectId. The extraction contract       │
 * │ carries ONE entity mention and two text blobs, so there is no way to    │
 * │ produce a typed object id from "Karthik handles backend now, not Arun"  │
 * │ -- "backend" is not a person, organization, or project row.             │
 * │                                                                        │
 * │ So corrections route through MEMORIES, where the same bitemporal        │
 * │ property holds: invalidate the old, store the new, nothing deleted.     │
 * │ `correct_relationship` stays registered and unreachable from a          │
 * │ conversation, and registry.coverage.test.ts DECLARES that rather than   │
 * │ leaving it to be discovered.                                            │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * A forget and a correction differ ONLY in whether a replacement was stated,
 * which is why both live here: a correction is a forget plus a remember, in
 * one turn and therefore one transaction and one undo.
 *
 * LEXICAL SEARCH, not hybrid. `remember` deliberately stores no embedding
 * (the backfill adds it later), so a fact stored a minute ago has no vector
 * and semantic search would miss precisely the memory a user is most likely
 * to correct.
 */
async function planCorrection(intent: ExtractedIntent, ctx: PlanContext): Promise<IntentPlan> {
  const target = intent.correctionTarget?.trim();
  if (!target) return { calls: [], facts: [], questions: [] };

  // HYBRID recall (PHASE-4-DESIGN §3). The user rarely repeats a memory
  // word for word: "Forget that Arun works on backend" against a stored
  // "Arun handles the backend" shares no `works`, and lexical search requires
  // every term — so lexical-only recall DECLINED the design's own demo.
  //
  // With no embedding (no provider, or it failed) this is lexical-only, the
  // behaviour before hybrid was wired. The limit is generous because the
  // lexical hits are filtered out of a FUSED list below.
  const embedding = ctx.queryEmbeddings.get(target) ?? null;
  const results = await memories.searchHybrid(ctx.tx, target, embedding, {}, 20);

  // ⚠ ONLY A LEXICAL HIT MAY BE FORGOTTEN WITHOUT ASKING.
  //
  // A semantic search ALWAYS returns neighbours — the nearest memory to
  // "Arun likes tea" exists even when it is "Arun handles the backend". No
  // distance threshold has been measured for this corpus, so similarity alone
  // is evidence of nothing, and forgetting on it would silently drop a true
  // fact. A semantic-only match can therefore only become a QUESTION.
  const found = results.filter((result) => result.matchedLexical).map((result) => result.memory);

  if (found.length === 0) {
    const nearest = results[0]?.memory;
    if (nearest) {
      return {
        calls: [],
        facts: [],
        questions: [
          `I don't have "${target}" on record. Did you mean "${nearest.body}"? If so, say that and I'll drop it.`,
        ],
      };
    }
    // An honest decline, not a question. The user corrected something we
    // never held; asking "which memory?" when the answer is "none" is the
    // over-asking §27 forbids, and silence would imply we had acted.
    return {
      calls: [],
      facts: [],
      questions: [],
      declined: [`I don't have anything on record about "${target}".`],
    };
  }

  if (found.length > 1) {
    // Forgetting is invalidate-not-delete and undoable, but the user may
    // never notice the wrong one went — so ambiguity asks (DECISIONS.md #6).
    // Fused order, so a hit the semantic half also found is offered first.
    return {
      calls: [],
      facts: [],
      questions: [`Which should I drop — "${found[0]?.body}" or "${found[1]?.body}"?`],
    };
  }

  const stale = found[0]!;
  const calls: ToolCall[] = [{ name: "forget_memory", input: { memory_id: stale.id } }];
  const facts: CommittedFact[] = [{ kind: "memory_forgotten", body: stale.body }];

  const replacement = intent.memoryBody?.trim();
  if (replacement) {
    const subject = await resolveParty(intent.relatedEntity, ctx);
    calls.push({
      name: "remember",
      input: {
        kind: "fact",
        body: replacement,
        inference_level: intent.inferenceLevel,
        subject_kind: subject.id ? "person" : null,
        subject_id: subject.id,
        source_message_id: null,
      },
    });
    facts.push({ kind: "memory_stored", body: replacement });
  }

  return { questions: [], calls, facts };
}

/**
 * What the user is told about a held intent. Says WHY, because "waiting for
 * approval" with no reason reads as the assistant being obstructive.
 */
function confirmationQuestion(hold: Extract<GateDecision, { decision: "confirm" }>): string {
  return hold.reason === "user_requires_confirmation"
    ? "You asked me to check before doing that, so it's waiting for your approval on the Permissions page."
    : "That acts outside OurGlass, so it's waiting for your approval on the Permissions page.";
}

/**
 * The held action in words, from the PLANNER's facts — never from model
 * output. Falls back to tool names for an intent with no describable fact.
 */
function summarizeHeld(entry: PlannedIntent): string {
  if (entry.facts.length === 0) return entry.calls.map((call) => call.name).join(", ");
  return templateReply({ committed: entry.facts, questions: [], declined: [] });
}

/**
 * Embed every recall query this turn needs, BEFORE Resolve opens its
 * transaction.
 *
 * Planning runs inside `withTransaction`, and a network call there holds a
 * pooled connection for as long as the vendor takes (PHASE-4-DESIGN §2.2,
 * "Rejected"). So the queries are known from the extraction, embedded here,
 * and handed to the planners as data.
 *
 * NEVER THROWS. A failed embedding degrades that recall to lexical-only — the
 * pre-hybrid behaviour — and a turn must not fail because an optional
 * enhancement did. Most turns carry no correction and make no call at all.
 */
async function embedRecallQueries(
  intents: readonly ExtractedIntent[],
  embedder: QueryEmbedder | undefined,
): Promise<ReadonlyMap<string, readonly number[]>> {
  const embeddings = new Map<string, readonly number[]>();
  if (!embedder) return embeddings;

  const queries = new Set(
    intents
      .map((intent) => intent.correctionTarget?.trim())
      .filter((target): target is string => Boolean(target)),
  );

  for (const query of queries) {
    try {
      const result = await embedder.embedQuery(query);
      const vector = result.embeddings[0];
      if (vector) embeddings.set(query, vector);
    } catch (error: unknown) {
      console.warn("[turn] query embedding failed; recall is lexical-only:", error);
    }
  }
  return embeddings;
}

/**
 * An `action` intent carrying a conditional: §25's `create_workflow`.
 *
 * Needs a SUBJECT COMMITMENT, because a rule evaluates against one row. "If
 * Arun hasn't sent the schema by Friday" is a condition about the commitment
 * Arun owes; with no such commitment there is nothing to evaluate, and
 * create_workflow rejects an unknown id rather than writing a rule that
 * silently never fires.
 *
 * The deadline is resolved by chrono-node from the VERBATIM phrase, exactly
 * as every other time in this system (DECISIONS.md #4). `source_phrase`
 * keeps the user's words so the resolution stays auditable.
 */
async function planWorkflow(intent: ExtractedIntent, ctx: PlanContext): Promise<IntentPlan> {
  const condition = intent.condition;
  if (!condition) return { calls: [], facts: [], questions: [] };

  const deadline = resolveTime(
    { kind: "deterministic", sourcePhrase: condition.deadlinePhrase },
    ctx.now,
    ctx.timezone,
    "forward",
  );
  if (deadline.tier !== "deterministic") {
    return {
      calls: [],
      facts: [],
      questions: [`When should I check — "${condition.deadlinePhrase}"?`],
    };
  }

  // The person the condition is ABOUT owes the thing; the user receives it.
  // "If Arun hasn't sent the schema" is Arun -> me, which is the same
  // ownership direction §7 makes structural everywhere else.
  const owner = await resolveParty(intent.relatedEntity, ctx);
  if (!owner.id) {
    return {
      calls: [],
      facts: [],
      questions: [owner.question ?? "Who is that about?"],
    };
  }

  const open = await commitments.listOpenForOwner(ctx.tx, owner.id, ctx.selfPersonId);
  const match = decideCompletion(
    { ownerId: owner.id, recipientId: ctx.selfPersonId, objectText: condition.subjectText },
    open,
  );
  if (match.kind !== "matched") {
    return {
      calls: [],
      facts: [],
      questions: [],
      declined: [`I don't have a commitment for "${condition.subjectText}" to watch.`],
    };
  }

  return {
    questions: [],
    calls: [
      {
        name: "create_workflow",
        input: {
          // "commitment_not_completed", not "...not_updated": "hasn't SENT"
          // is about delivery, not about the row going quiet. The two are a
          // closed enum in workflow-tools.ts and an invalid value is caught
          // only at validate() — the wire input is Record<string, unknown>,
          // so tsc cannot see a typo here.
          condition_kind: "commitment_not_completed",
          subject_commitment_id: match.commitmentId,
          evaluate_at: deadline.at,
          action_kind: condition.action,
          action_body: condition.actionBody,
          source_phrase: intent.sourceText,
        },
      },
    ],
    facts: [
      {
        kind: "workflow_created",
        actionBody: condition.actionBody,
        evaluateAtLocal: formatLocal(deadline.at, ctx.timezone),
      },
    ],
  };
}

/**
 * An `action` intent defining a new kind of thing: §36's `define_entity_type`.
 *
 * THE USER'S HEADLINE REQUIREMENT runs through here: a type invented
 * mid-conversation must appear in the UI with no deploy. That works because
 * the frontend holds no hardcoded list — it reads the registry and renders
 * from `field_kind` — so this branch is the only thing standing between the
 * utterance and a working table.
 *
 * Field shape is remapped camelCase -> snake_case because the contract speaks
 * TypeScript and the tool boundary speaks the wire format. No validation here
 * beyond presence: `define_entity_type` owns the closed `field_kind` enum,
 * the reserved-name check and the field cap, and duplicating any of that
 * would give two answers to one question.
 */
function planDefineEntityType(intent: ExtractedIntent): IntentPlan {
  const definition = intent.entityTypeDefinition;
  if (!definition || definition.fields.length === 0) {
    return {
      calls: [],
      facts: [],
      questions: ["What should I track about those?"],
    };
  }

  // An enum with no options is the one gap worth ASKING about. Every record
  // of this type is validated against the option list forever, so inventing
  // one is a guess that causes a meaningful mistake — the case §27 carves out
  // of its own don't-over-ask rule.
  const optionless = definition.fields.filter(
    (field) => field.fieldKind === "enum" && (field.enumOptions ?? []).length === 0,
  );
  if (optionless.length > 0) {
    return {
      calls: [],
      facts: [],
      questions: [
        `What are the possible values for ${optionless.map((field) => field.label).join(" and ")}?`,
      ],
    };
  }

  return {
    questions: [],
    calls: [
      {
        name: "define_entity_type",
        input: {
          type_key: definition.typeKey,
          display_name: definition.displayName,
          fields: definition.fields.map((field) => ({
            field_key: field.fieldKey,
            field_kind: field.fieldKind,
            label: field.label,
            required: field.required,
            // The tool wants [{value,label}]; the contract carries bare
            // strings because the user says "planned or done", not a pair.
            // Omitted entirely for non-enum kinds, which reject the key.
            ...(field.fieldKind === "enum"
              ? {
                  enum_options: (field.enumOptions ?? []).map((option) => ({
                    value: option,
                    label: option,
                  })),
                }
              : {}),
          })),
        },
      },
    ],
    facts: [
      {
        kind: "entity_type_defined",
        displayName: definition.displayName,
        fieldCount: definition.fields.length,
      },
    ],
  };
}

/**
 * An `action` intent scheduling something: §24, and the Phase 4 demo.
 *
 * ┌─ THE CONFLICT IS CHECKED BEFORE THE WRITE, AND IT ASKS ─────────────────┐
 * │ §24 is explicit: "Do not automatically choose." So a collision produces │
 * │ a QUESTION naming both sides and NO tool call — planOneIntent drops the │
 * │ calls of any intent that asks, so the event is simply not created and   │
 * │ the user decides.                                                      │
 * │                                                                        │
 * │ Checking first also keeps the reply honest. Creating the event and then │
 * │ mentioning the clash would say "Scheduled." and "that conflicts" in one │
 * │ breath, which reads as a warning about something already done.         │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Only a DETERMINISTIC time will do. `findOverlapping` compares instants, so
 * a relational or event-triggered time has nothing to compare and would
 * create an event that silently collides with everything or nothing.
 */
async function planEvent(intent: ExtractedIntent, ctx: PlanContext): Promise<IntentPlan> {
  const title = intent.eventTitle?.trim();
  if (!title) return { calls: [], facts: [], questions: [] };

  const time = resolveIntentTime(intent, ctx);
  if (!time || time.tier !== "deterministic") {
    return {
      calls: [],
      facts: [],
      questions: [
        time && time.tier !== "unresolved"
          ? `I can only schedule a specific time yet — when is "${time.sourcePhrase}"?`
          : `When should I schedule ${title}?`,
      ],
    };
  }

  const startsAt = new Date(time.at);
  const conflicts = await detectTimeConflicts(ctx.tx, startsAt, null, null);
  const clash = conflicts[0];
  if (clash) {
    return {
      calls: [],
      facts: [],
      // Rendered by the same function the proactive gate uses, so the two
      // surfaces cannot drift into describing a conflict differently.
      questions: [
        renderProactiveLine({ kind: "conflict", rowId: clash.existingEventId, conflict: clash }, (iso) =>
          formatLocal(iso, ctx.timezone),
        ),
      ],
    };
  }

  return {
    questions: [],
    calls: [
      {
        name: "create_event",
        input: { title, starts_at: time.at, ends_at: null, location: null, notes: null },
      },
    ],
    facts: [{ kind: "event_scheduled", title, startsAtLocal: formatLocal(time.at, ctx.timezone) }],
  };
}

/**
 * An `action` intent logging one instance: §36's `create_entity_record`.
 *
 * DECLINES rather than defining the type on the fly. Inferring a schema from
 * one record is how a registry fills with junk types that cannot be told from
 * real ones, and PLANNER-WIRING-DESIGN §2 names a cluttered registry as this
 * tool family's actual risk. Asking is also wrong here — the honest answer is
 * "I am not tracking that", which the user can act on.
 */
async function planCreateEntityRecord(intent: ExtractedIntent, ctx: PlanContext): Promise<IntentPlan> {
  const record = intent.entityRecord;
  if (!record) return { calls: [], facts: [], questions: [] };

  const type = await entityRecords.getTypeByKey(ctx.tx, record.typeKey);
  if (!type) {
    return {
      calls: [],
      facts: [],
      questions: [],
      declined: [`I'm not tracking ${record.typeKey} yet — tell me what to track about it first.`],
    };
  }

  return {
    questions: [],
    calls: [
      {
        name: "create_entity_record",
        input: { type_key: record.typeKey, payload: { ...record.values } },
      },
    ],
    facts: [{ kind: "entity_record_created", displayName: type.display_name }],
  };
}

/**
 * An `inspection` intent: §28's "What am I waiting on?".
 *
 * Maps the utterance onto ONE of `InspectionQuery`'s five closed shapes and
 * runs it. Read-only — nothing here emits a ToolCall, so an inspection turn
 * mints no turn_id and writes no action_log row.
 *
 * SHAPE SELECTION IS STRUCTURAL, from the resolved owner/recipient the
 * extractor already produced, not from re-reading the sentence. "What does
 * Barkha owe me" has owner=Barkha and recipient=me; "what do I owe Hult" has
 * the reverse. Those two columns ARE the question (spec §7), which is why the
 * two-column schema exists — a keyword match on "owe" would have to guess the
 * direction, and guessing it wrong returns a confidently incorrect list.
 *
 * An unresolvable subject DECLINES rather than asking. An inspection that
 * cannot be run costs the user nothing to retry, and interrogating them about
 * a question they asked is the over-asking §27 forbids.
 */
async function planInspection(intent: ExtractedIntent, ctx: PlanContext): Promise<IntentPlan> {
  const empty = { calls: [], facts: [], questions: [] } as const;

  if (!ctx.selfPersonId) {
    // F3's half-provisioned state: no linked person, so "me" cannot resolve
    // and every §28 query is about "me". Honest rather than empty-and-wrong.
    return { ...empty, declined: ["I can't tell who you are yet."] };
  }
  const self = ctx.selfPersonId;

  const owner = await resolveParty(intent.owner, ctx);
  const recipient = await resolveParty(intent.recipient, ctx);
  const about = await resolveParty(intent.relatedEntity, ctx);

  const query = ((): InspectionQuery | null => {
    // "What do you know about Arun?" — a named subject with no direction.
    if (about.id && !owner.id && !recipient.id) {
      return { kind: "about_entity", subjectKind: "person", subjectId: about.id };
    }
    // "What does Barkha owe me?" — someone else owes me.
    if (owner.id && owner.id !== self) {
      return { kind: "owed_to_me", personId: owner.id, selfPersonId: self };
    }
    // "What do I owe Hult?" — I owe someone else.
    if (owner.id === self && recipient.id && recipient.id !== self) {
      return { kind: "i_owe", personId: recipient.id, selfPersonId: self };
    }
    // "What am I waiting on?" — the default read, and the most common §28
    // question. Reached when nothing more specific was named.
    if (!owner.id) {
      return { kind: "waiting_on", selfPersonId: self };
    }
    // owner === self with no recipient: "what do I need to do today". Still a
    // waiting_on read from the other side — everything I owe anyone.
    return { kind: "i_owe", personId: self, selfPersonId: self };
  })();

  if (!query) {
    return { ...empty, declined: ["I'm not sure what to look up."] };
  }

  const result = await runInspection(ctx.tx, query);
  return {
    ...empty,
    answers: [renderInspection(result, (iso) => formatLocal(iso, ctx.timezone))],
  };
}

/** An `action` intent: "Remind me at 5 to ask her." */
function planReminder(
  intent: ExtractedIntent,
  ctx: PlanContext,
  commitmentIdByIntent: Map<number, string>,
): IntentPlan {
  const questions: string[] = [];
  if (!intent.reminderBody) {
    questions.push("What should the reminder say?");
    return { calls: [], facts: [], questions };
  }

  const time = resolveIntentTime(intent, ctx);
  if (!time || time.tier === "unresolved") {
    questions.push(
      time ? `When should I remind you — "${time.sourcePhrase}"?` : "When should I remind you?",
    );
    return { calls: [], facts: [], questions };
  }
  if (time.tier !== "deterministic") {
    // Relational ("before the meeting") and event-trigger ("after Arun
    // replies") reminders belong to the rule engine, not the poller, and
    // DECISIONS.md #3 keeps them separate. Phase 3's poller filters on
    // `fire_at IS NOT NULL`, so storing one with no timestamp would create a
    // reminder that can never fire. Decline rather than write a dead row.
    questions.push(`I can only set reminders for a specific time yet — when should I remind you about "${intent.reminderBody}"?`);
    return { calls: [], facts: [], questions };
  }

  // ============ THE STRUCTURAL DEPENDENCY EDGE — AND ITS LIMIT ============
  //
  // §3.3 requires dependence to be STRUCTURAL AND COMPUTED, not judged. This
  // is as structural as the current contract permits, and that is worth
  // naming precisely because it is the soft spot in an otherwise deterministic
  // rule:
  //
  // `ExtractedIntent` HAS NO INTENT-TO-INTENT REFERENCE FIELD. Nothing in the
  // extraction contract lets the model say "this reminder is about THAT
  // commitment". So the edge is INFERRED: a reminder in the same utterance as
  // a commitment-bearing intent is taken to refer to it, most recent first.
  //
  // WHAT WOULD BREAK IT: an utterance carrying a commitment and a genuinely
  // UNRELATED reminder ("Barkha owes me the article by 6. Also remind me at 5
  // to call the plumber.") links the reminder to the commitment when it
  // should not — making it block if the commitment blocks, which over-asks
  // (§27) but never writes anything wrong. The inverse error, a reminder that
  // SHOULD be linked and is not, would commit an orphan; that cannot happen
  // here because an unlinked reminder simply has commitment_id null.
  //
  // So the inference fails SAFE in the direction that matters. It is still a
  // heuristic under a rule the design says must be structural, and it is
  // DOUBLY UNVERIFIED: the live eval lane has never run, so nobody knows how
  // the real model segments these utterances either.
  //
  // THE FIX IF IT PROVES WRONG IS AN EXPLICIT REFERENCE FIELD IN THE
  // EXTRACTION CONTRACT — not a cleverer heuristic here.
  // =======================================================================
  const dependsOn: number[] = [];
  let commitmentId: string | null = null;
  const linked = [...commitmentIdByIntent.entries()].at(-1);
  if (linked) {
    dependsOn.push(linked[0]);
    commitmentId = linked[1];
  }

  return {
    questions: [],
    dependsOn,
    calls: [
      {
        name: "create_reminder",
        input: {
          commitment_id: commitmentId,
          body: intent.reminderBody,
          fire_at: time.at,
          source_phrase: intent.time?.sourcePhrase ?? null,
        },
      },
    ],
    facts: [{ kind: "reminder_created", fireAtLocal: formatLocal(time.at, ctx.timezone) }],
  };
}

// ---------------------------------------------------------------------------
// Mention resolution.
// ---------------------------------------------------------------------------

interface ResolvedParty {
  readonly id: string | null;
  readonly displayName: string | null;
  readonly question: string | null;
}

async function resolveParty(
  mention: ExtractedIntent["owner"],
  ctx: PlanContext,
): Promise<ResolvedParty> {
  if (!mention) return { id: null, displayName: null, question: null };

  const resolution = await resolvePersonMention(ctx.tx, mention, ctx.selfPersonId);
  if (resolution.band === "auto") {
    // resolvePerson, not a raw SELECT by id: it follows the merge-forwarding
    // pointer, so a person merged away between Resolve and here still yields
    // the survivor's display name rather than null. Same READ SHAPE 1-vs-2
    // reasoning as getUserWithPerson above.
    const person = await people.resolvePerson(ctx.tx, resolution.id);
    return {
      id: person?.id ?? resolution.id,
      displayName: person?.display_name ?? mention.name,
      question: null,
    };
  }
  return {
    id: null,
    displayName: null,
    question: questionForMention(mention.name, resolution),
  };
}

/**
 * Spec §30: "Karthik from Hult?", not "Please clarify which Karthik entity
 * you are referring to." Short, and it names the actual candidates.
 */
function questionForMention(name: string, resolution: EntityResolution): string {
  if (resolution.band === "ask") {
    const names = resolution.candidates.map((candidate) => candidate.displayName);
    if (names.length === 2) return `${names[0]} or ${names[1]}?`;
    if (names.length > 2) return `Which ${name} — ${names.join(", ")}?`;
  }
  return `Who's ${name}?`;
}

function questionForCompletionMiss(
  match: { readonly reason: string; readonly candidateIds: readonly string[] },
  intent: ExtractedIntent,
  open: readonly CurrentCommitment[],
): string {
  if (match.reason === "ambiguous") {
    const texts = open
      .filter((candidate) => match.candidateIds.includes(candidate.id))
      .map((candidate) => candidate.object_text);
    if (texts.length >= 2) return `Which one — ${texts.join(" or ")}?`;
  }
  // §4.2: zero matches ASKS, it never creates a retroactive completed
  // commitment. The question is honest about the gap rather than pretending
  // to have understood.
  const who = intent.owner ? `from ${intent.owner.name} ` : "";
  return `I don't have anything ${who}about ${intent.objectText} — want me to record it as done anyway?`;
}

function questionForMissingField(issue: IntentCompletenessIssue): string {
  switch (issue.missingField) {
    case "objectText":
      return "What exactly needs doing?";
    case "reminderBody":
      return "What should the reminder say?";
    case "time":
      return "When?";
    case "owner":
      return "Who do you mean?";
    default:
      return "Can you say a bit more about that?";
  }
}

function describeMention(mention: ExtractedIntent["owner"]): string {
  return mention?.name ?? "they";
}

// ---------------------------------------------------------------------------
// Time and formatting.
// ---------------------------------------------------------------------------

function resolveIntentTime(intent: ExtractedIntent, ctx: PlanContext): ResolvedTime | null {
  if (!intent.time) return null;
  // NEVER a literal direction. See §2.2 and the comment in planCompletion.
  return resolveTime(intent.time, ctx.now, ctx.timezone, timeDirectionForIntent(intent.kind));
}

/**
 * An ISO instant as a short local string for the reply.
 *
 * Respond has no DB handle and cannot read users.timezone, so every time it
 * sees is pre-formatted here (§5.1). Short by §31: "6 PM", "Fri 6 PM" — never
 * a full ISO timestamp, which reads as machine output.
 */
export function formatLocal(iso: string, timezone: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

/**
 * §3.4: each ExtractionError reason maps to a DISTINCT honest reply. Phase 2
 * built the taxonomy specifically so this function could exist — collapsing
 * them into one string would throw that away and tell a user whose message
 * was truncated the same thing as one whose message was refused.
 */
export function replyForExtractionFailure(error: ExtractionError): string {
  switch (error.reason) {
    case "truncated":
      return "That got cut off — can you say it more briefly?";
    case "refused":
      return "I can't help with that one.";
    case "context_window_exceeded":
      return "That was too long for me to read — can you shorten it?";
    case "provider_error":
      // Not "something went wrong interpreting that": nothing was interpreted.
      // Saying so tells the user a retry is reasonable, which it is.
      return "I couldn't process that just now — nothing was saved. Try again in a moment.";
    default:
      return "Something went wrong interpreting that — nothing was saved.";
  }
}
