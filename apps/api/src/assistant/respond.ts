/**
 * Respond — one constrained Haiku call, with a MANDATORY template fallback.
 *
 * docs/PHASE-3-DESIGN.md §5. Two properties define this file, and both are
 * prohibitions rather than capabilities:
 *
 * 1. NO DB HANDLE, NO TOOLS. `HaikuResponder`'s constructor takes an Anthropic
 *    client and nothing else — no pool, no transaction, nothing built from
 *    ToolContext. The request sends `tools: []` and no `tool_choice`. That is
 *    the guarantee this stage exists to make: a hallucination here produces a
 *    wrong SENTENCE, never a wrong ROW. Everything Respond needs, Mutate
 *    already knows and passes in as plain data.
 *
 * 2. THE MUTATION HAS ALREADY COMMITTED when this runs. So a cosmetic model
 *    failure must not 500, must not roll anything back, and must not retry
 *    into a paid loop. The fallback is not optional and not a nicety — it is
 *    the reason it is safe to put a model on this path at all.
 *
 * Haiku, not Sonnet: spec §22 means EVERY message hits this path, so this is
 * the highest-volume model call in the product. Sonnet and Haiku only, no
 * Opus, anywhere (owner decision, docs/DECISIONS.md open question 2).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Model } from "@anthropic-ai/sdk/resources/messages";
import {
  RESPOND_MODEL,
  type CommittedFact,
  type Responder,
  type RespondInput,
  type RespondOutput,
} from "@ourglass/shared";

/**
 * Trace for the Respond stage, persisted alongside the extraction trace
 * (§8). `ai-systems.md`: an LLM failure with no trace is unfixable, and a
 * 200 OK can still be a wrong answer — ordinary APM cannot see this.
 *
 * `fallbackReason` is the field that makes a Haiku outage visible. Without
 * it, `degraded: true` says the template fired but not why, and a network
 * blip looks identical to a systematic refusal.
 */
export type RespondFallbackReason =
  | "sdk_error"
  | "timeout"
  | "refusal"
  | "max_tokens"
  | "empty_text"
  | "too_long";

export interface RespondTrace {
  readonly model: string;
  readonly latencyMs: number;
  readonly degraded: boolean;
  readonly fallbackReason?: RespondFallbackReason;
  readonly stopReason?: string | null;
  readonly requestId?: string;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

export interface RespondResult extends RespondOutput {
  readonly trace: RespondTrace;
}

/**
 * Hard character cap on the reply (§5.2).
 *
 * `max_tokens: 200` already makes brevity structural, but a token cap and a
 * character cap fail differently: max_tokens TRUNCATES mid-sentence (caught
 * separately as `stop_reason === "max_tokens"`), while this catches a reply
 * that finished cleanly and is still a wall of text. Spec §31 says be
 * concise; a paragraph is a failure of the one thing this call is for.
 */
const MAX_REPLY_CHARS = 600;

/**
 * 3 seconds, and this is not a nicety.
 *
 * Without it, an SDK hang makes a turn that ALREADY COMMITTED appear to fail.
 * The user then says it again, producing exactly the duplicate the spec §23
 * machinery has to catch. The write is durable; the user is waiting on
 * cosmetics. Bound the cosmetic stage.
 */
const RESPOND_TIMEOUT_MS = 3_000;

const MAX_RESPOND_TOKENS = 200;

/**
 * The system prompt carries spec §30's examples VERBATIM.
 *
 * §30/§31 are unusually specific about voice, and the examples are the
 * specification — paraphrasing them into guidelines ("be concise and
 * natural") is how the voice drifts back to assistant-ese. Spec §4 forbids
 * unsolicited life-coaching and §27 forbids confirmation fatigue, so both are
 * stated as prohibitions here rather than left implicit.
 *
 * The "state only what you are given" clause is a guardrail, not style: this
 * model receives a summary of mutations that ALREADY HAPPENED, so any detail
 * it adds is fabricated by construction. It cannot be caught downstream —
 * there is no validator on prose.
 */
export const RESPOND_SYSTEM_PROMPT = `You write the assistant's single reply after its bookkeeping has already been done.

Voice:
- Be brief and natural. "Got it — Hult poster marked complete." NOT "I've successfully analyzed and recorded the completion of the Hult poster task."
- Ask short questions. "Karthik from Hult?" NOT "Please clarify which Karthik entity you are referring to."
- One or two sentences. Never a paragraph, never a list, never a preamble.

Rules:
- State ONLY what the provided facts say. Never add a detail, a name, a time, or a number that is not in them.
- Do not make judgmental statements. Report what happened; never evaluate the user's behaviour, never offer advice, encouragement, or life-coaching.
- Do not offer to do things. Do not ask whether the user wants anything else.
- If something committed AND something needs asking, say both, in that order, in one short reply.
- If a question is provided, ask it as written or more briefly. Never expand it.`;

/**
 * The deterministic fallback (§5.2). Pure, synchronous, no model, no clock.
 *
 * Exported and unit-tested independently because it is the thing that must
 * work when everything else does not.
 */
export function templateReply(input: RespondInput): string {
  const parts: string[] = [];
  for (const fact of input.committed) {
    parts.push(describeFact(fact));
  }
  parts.push(...input.questions, ...input.declined);
  // "Done." rather than an empty string: a turn that committed nothing and
  // asked nothing still owes the user a reply. An empty reply reads as a
  // crash.
  return parts.join(" ").trim() || "Done.";
}

function describeFact(fact: CommittedFact): string {
  // Exhaustive switch on the discriminant. If packages/shared adds a fifth
  // CommittedFact variant, `assertNever` makes `tsc` fail here rather than
  // letting the template silently emit nothing for it — silence about a write
  // is exactly the state spec §28 exists to prevent.
  switch (fact.kind) {
    case "commitment_created": {
      const due = fact.expectedAtLocal ? `, due ${fact.expectedAtLocal}` : "";
      const recipient = fact.recipientName ? ` → ${fact.recipientName}` : "";
      return `Noted: ${fact.ownerName}${recipient} — ${fact.objectText}${due}.`;
    }
    case "reminder_created":
      return `Reminder set for ${fact.fireAtLocal}.`;
    case "commitment_completed":
      return fact.latenessMs != null && fact.latenessMs > 0
        ? `Got it — ${fact.objectText} marked complete, ${formatDuration(fact.latenessMs)} late.`
        : `Got it — ${fact.objectText} marked complete.`;
    case "commitment_updated":
      return `Updated: ${fact.objectText}${fact.status ? ` — ${fact.status}` : ""}.`;
    default:
      return assertNever(fact);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled CommittedFact kind: ${JSON.stringify(value)}`);
}

const UNITS_IN_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve",
] as const;

/**
 * Duration in words, deterministic and unit-tested.
 *
 * `5 * 3600_000` -> "five hours", which is spec §20's own wording verbatim.
 * Rounds to the nearest hour above 90 minutes and to minutes below, because
 * "five hours and three minutes late" is the kind of precision that reads as
 * pedantic rather than accurate — and the exact instant is recorded in
 * `completed_at` regardless. Words up to twelve, then digits: "five hours"
 * reads naturally, "thirty-seven hours" does not.
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  if (totalMinutes < 1) return "less than a minute";
  if (totalMinutes <= 90) return `${inWords(totalMinutes)} ${plural(totalMinutes, "minute")}`;
  const hours = Math.round(totalMinutes / 60);
  if (hours < 48) return `${inWords(hours)} ${plural(hours, "hour")}`;
  const days = Math.round(hours / 24);
  return `${inWords(days)} ${plural(days, "day")}`;
}

function inWords(value: number): string {
  return value < UNITS_IN_WORDS.length ? UNITS_IN_WORDS[value]! : String(value);
}

function plural(value: number, noun: string): string {
  return value === 1 ? noun : `${noun}s`;
}

/**
 * The template responder. No model at all.
 *
 * Used by tests, and available as a deployment fallback when no API key is
 * configured. `degraded: true` always — it is honest about never having
 * called a model.
 */
export class TemplateResponder implements Responder {
  async respond(input: RespondInput): Promise<RespondOutput> {
    return { reply: templateReply(input), degraded: true };
  }
}

export interface HaikuResponderOptions {
  readonly apiKey: string;
  readonly model?: Model;
  readonly client?: Anthropic;
  readonly timeoutMs?: number;
}

export class HaikuResponder implements Responder {
  private readonly client: Anthropic;
  private readonly model: Model;
  private readonly timeoutMs: number;

  constructor(options: HaikuResponderOptions) {
    if (!options.apiKey) throw new Error("ANTHROPIC_API_KEY is required for the Respond stage");
    // An Anthropic client and NOTHING ELSE. No pool, no transaction, no
    // ToolContext. This constructor's signature IS the trust boundary (§5.1)
    // — if it ever grows a DB parameter, the guarantee in this file's header
    // is gone.
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey });
    // The literal lives in @ourglass/shared for the same anti-drift reason
    // EXTRACTION_MODEL does: it previously appeared in two files and drifted
    // twice in one session. Import it; do not retype it.
    this.model = options.model ?? RESPOND_MODEL;
    this.timeoutMs = options.timeoutMs ?? RESPOND_TIMEOUT_MS;
  }

  async respond(input: RespondInput): Promise<RespondOutput> {
    const { reply, degraded } = await this.respondWithTrace(input);
    return { reply, degraded };
  }

  /**
   * The full path, including the trace the orchestrator persists (§8).
   *
   * NEVER THROWS. Every failure mode falls back to the template, because the
   * mutation is already durable and the caller has nothing useful to do with
   * an exception here.
   */
  async respondWithTrace(input: RespondInput): Promise<RespondResult> {
    const started = performance.now();
    const fallback = (reason: RespondFallbackReason, extra?: Partial<RespondTrace>): RespondResult => ({
      reply: templateReply(input),
      degraded: true,
      trace: {
        model: this.model,
        latencyMs: performance.now() - started,
        degraded: true,
        fallbackReason: reason,
        ...extra,
      },
    });

    // AbortController, not just the SDK's own timeout option: a hang before
    // the request is even dispatched (DNS, socket) must also be bounded.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: MAX_RESPOND_TOKENS,
          system: RESPOND_SYSTEM_PROMPT,
          messages: [{ role: "user", content: renderFacts(input) }],
          // NO TOOLS. Not an empty allowlist that could be widened by a
          // config change — the field is absent, and there is no tool_choice.
          // The Responder holds no DB handle, so even a fabricated tool call
          // would have nothing to execute against.
        },
        { signal: controller.signal },
      );
    } catch (error: unknown) {
      // ONE attempt, NO RETRY, for every error class — network, 429, 5xx,
      // abort. A retry loop on a paid endpoint is the most expensive failure
      // mode available to an agent (.claude/rules/wat.md §3), it doubles
      // worst-case latency on a stage the user is already waiting through,
      // and the template is right there and always correct.
      return fallback(isAbort(error, controller) ? "timeout" : "sdk_error");
    } finally {
      clearTimeout(timer);
    }

    const stopReason = response.stop_reason ?? null;
    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
    // `_request_id` is attached by the SDK at runtime but is not on the
    // declared `Message` type (it is on the APIPromise's response wrapper).
    // It is the only handle for a support conversation with the vendor (§8.2),
    // so it is read defensively rather than dropped.
    const requestId = (response as { _request_id?: string | null })._request_id;
    const common: Partial<RespondTrace> = {
      stopReason,
      usage,
      ...(requestId ? { requestId } : {}),
    };

    // Retrying a refusal produces another refusal.
    if (stopReason === "refusal") return fallback("refusal", common);
    // A truncated sentence is worse than a template one.
    if (stopReason === "max_tokens") return fallback("max_tokens", common);

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (text.length === 0) return fallback("empty_text", common);
    if (text.length > MAX_REPLY_CHARS) return fallback("too_long", common);

    return {
      reply: text,
      degraded: false,
      trace: {
        model: response.model,
        latencyMs: performance.now() - started,
        degraded: false,
        ...common,
      },
    };
  }
}

function isAbort(error: unknown, controller: AbortController): boolean {
  if (controller.signal.aborted) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * The user-turn content sent to Haiku.
 *
 * Deliberately a rendered text block rather than JSON: JSON invites the model
 * to echo field names and structure, and this stage's whole job is prose. It
 * contains no UUIDs — `RespondInput` has no field that can hold one — so
 * there is nothing here the model could return that would be mistaken for a
 * resolved identifier.
 */
export function renderFacts(input: RespondInput): string {
  const lines: string[] = [];
  if (input.committed.length > 0) {
    lines.push("Already recorded (state these as done):");
    for (const fact of input.committed) lines.push(`- ${describeFact(fact)}`);
  }
  if (input.questions.length > 0) {
    lines.push("Still need to ask:");
    for (const question of input.questions) lines.push(`- ${question}`);
  }
  if (input.declined.length > 0) {
    lines.push("Cannot do (say so plainly):");
    for (const declined of input.declined) lines.push(`- ${declined}`);
  }
  if (lines.length === 0) lines.push("Nothing was recorded and nothing needs asking.");
  lines.push("", "Write the reply.");
  return lines.join("\n");
}
