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
import { commitments, messages, people, users, type CurrentCommitment } from "@ourglass/db";
import type { DatabaseTransaction } from "@ourglass/shared";
import { ExtractionError, type Extractor } from "./extract.js";
import { decideCompletion, resolvePersonMention, type EntityResolution } from "./resolve.js";
import type { RespondTrace } from "./respond.js";
import { resolveTime, timeDirectionForIntent, type ResolvedTime } from "./time.js";
import { executeTurn, type Deps as ExecutorDeps } from "../tools/index.js";

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

  // ---- Resolve (read only; writes nothing) --------------------------------
  const planned = await deps.db.withTransaction((tx) =>
    planIntents(interpretation.extraction.intents, {
      tx,
      now,
      timezone,
      selfPersonId,
    }),
  );

  // ---- The partial-commit rule (§3.3) -------------------------------------
  const blocked = blockedIntentIndices(planned);
  const committable = planned.filter((entry) => !blocked.has(entry.index));
  const calls = committable.flatMap((entry) => entry.calls);

  const questions = planned
    .filter((entry) => blocked.has(entry.index))
    .flatMap((entry) => questionsFor(entry));
  const declined = planned.flatMap((entry) => entry.declined);

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
  // The mutation has already committed. Nothing below here may throw in a way
  // that loses it — HaikuResponder.respondWithTrace never throws by
  // construction, and a template reply is always available.
  const respondInput: RespondInput = {
    committed: committedFacts,
    questions: [...questions, ...failures],
    declined,
  };
  const { reply, degraded, trace: respondTrace } = await respondWithTrace(
    deps.responder,
    respondInput,
  );

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
      // §3.4: classified, then declined honestly. Building lexical retrieval
      // that Phase 4 throws away is worse than an honest gap. A question
      // intent NEVER blocks the mutating intents in the same utterance —
      // which is why this is a `declined`, not a `question`.
      declined.push("I can't look things up yet.");
      break;

    case "execution":
      // Spec §5: a request for an external action is not permission to carry
      // it out, and Phase 3 has no external side effects at all. Declining is
      // the whole behaviour.
      declined.push("I can't do things outside this conversation yet.");
      break;

    case "context":
      // F4 (commitment_notes / attach_context) is api3's tool and is not
      // wired here yet. Declining honestly beats silently dropping it.
      declined.push("I've noted that, but I can't attach context to a commitment yet.");
      break;

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
      const plan = await planCommitment(intent, ctx);
      questions.push(...plan.questions);
      calls.push(...plan.calls);
      facts.push(...plan.facts);
      if (plan.commitmentId) commitmentIdByIntent.set(index, plan.commitmentId);
      break;
    }

    case "action": {
      const plan = planReminder(intent, ctx, commitmentIdByIntent);
      questions.push(...plan.questions);
      calls.push(...plan.calls);
      facts.push(...plan.facts);
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
    facts: questions.length > 0 ? [] : facts,
  };
}

interface IntentPlan {
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
    default:
      return "Something went wrong interpreting that — nothing was saved.";
  }
}
