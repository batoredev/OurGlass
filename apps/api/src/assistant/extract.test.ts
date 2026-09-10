import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import {
  EXTRACTION_MODEL,
  EXTRACTION_TOOL_NAME,
  isExtraction,
  validateIntentCompleteness,
  type Extraction,
} from "@ourglass/shared";
import { AnthropicExtractor, EXTRACTION_TOOL, ExtractionError } from "./extract.js";

describe("extraction boundary", () => {
  it("uses one strict, forced-output schema with no write-ready IDs or timestamps", () => {
    expect(EXTRACTION_TOOL.strict).toBe(true);
    expect(JSON.stringify(EXTRACTION_TOOL.input_schema)).not.toContain("expected_at");
    expect(JSON.stringify(EXTRACTION_TOOL.input_schema)).not.toContain("owner_id");
  });

  it("accepts a valid multi-intent payload and rejects malformed model output", () => {
    expect(isExtraction({ intents: [{
      kind: "information", inferenceLevel: "CONFIRMED", sourceText: "Barkha owes me the article by 6",
      owner: { name: "Barkha", kind: "person", inferenceLevel: "CONFIRMED" },
      time: { kind: "deterministic", sourcePhrase: "by 6" },
    }] })).toBe(true);
    expect(isExtraction({ intents: [{ kind: "information", inferenceLevel: "certain", sourceText: "x" }] })).toBe(false);
  });

  it("pins the model to the shared constant so the API and eval lanes cannot drift", () => {
    // The literal previously lived here AND in the live eval lane, and drifted
    // twice in one session. Owner decision: Sonnet and Haiku only, never Opus.
    expect(EXTRACTION_MODEL).toBe("claude-sonnet-5");
    expect(EXTRACTION_MODEL).not.toContain("opus");
  });
});

/**
 * REGRESSION — `isExtraction` was materially weaker than the JSON Schema it
 * mirrors. The schema sets `additionalProperties: false` at every level; the
 * guard enforced none of it, so an injected key rode an otherwise-valid payload
 * straight through the trust boundary (PHASE-1-DESIGN.md §3). It also accepted
 * `intents: []`, which is a failure to interpret, not an interpretation.
 */
describe("isExtraction enforces the schema it mirrors", () => {
  const validIntent = { kind: "information", inferenceLevel: "CONFIRMED", sourceText: "x" } as const;

  it("rejects an empty intents array", () => {
    expect(isExtraction({ intents: [] })).toBe(false);
  });

  it("rejects an injected key that looks like a resolved database identifier", () => {
    expect(isExtraction({ intents: [{ ...validIntent, ownerId: "11111111-1111-1111-1111-111111111111" }] })).toBe(false);
  });

  it("rejects extra keys at every level of the contract", () => {
    expect(isExtraction({ intents: [validIntent], sql: "DROP TABLE people" })).toBe(false);
    expect(isExtraction({ intents: [{ ...validIntent,
      owner: { name: "B", kind: "person", inferenceLevel: "CONFIRMED", id: "deadbeef" } }] })).toBe(false);
    expect(isExtraction({ intents: [{ ...validIntent,
      time: { kind: "deterministic", sourcePhrase: "by 6", at: "2026-01-01T00:00:00Z" } }] })).toBe(false);
  });

  it("still accepts every legitimate optional field", () => {
    expect(isExtraction({ intents: [{
      kind: "action", inferenceLevel: "CONFIRMED", sourceText: "Remind me at 5 to ask Barkha",
      owner: { name: "me", kind: "person", inferenceLevel: "CONFIRMED" },
      recipient: { name: "Barkha", kind: "person", inferenceLevel: "CONFIRMED" },
      relatedEntity: { name: "Hult", kind: "organization", inferenceLevel: "INFERRED" },
      objectText: "the poster", reminderBody: "ask Barkha",
      time: { kind: "deterministic", sourcePhrase: "at 5" },
    }] })).toBe(true);
  });
});

/**
 * REGRESSION — intent completeness had no enforcement anywhere. An
 * `information` intent with no objectText passed the guard, then failed at the
 * Phase 1 tool boundary against a NOT NULL column: one layer too late, and
 * unable to distinguish "the model omitted it" from "the user never said it".
 */
describe("validateIntentCompleteness", () => {
  it("reports a structured, askable reason rather than throwing", () => {
    const issues = validateIntentCompleteness({ intents: [
      { kind: "action", inferenceLevel: "CONFIRMED", sourceText: "Remind me at 5" },
    ] } as Extraction);
    expect(issues).toEqual([{
      intentIndex: 0, kind: "action", missingField: "reminderBody",
      sourceText: "Remind me at 5", severity: "blocking",
    }]);
  });

  it("returns nothing for a complete intent", () => {
    expect(validateIntentCompleteness({ intents: [{
      kind: "completion_update", inferenceLevel: "CONFIRMED",
      sourceText: "Barkha gave the article at 11", objectText: "the article",
    }] } as Extraction)).toEqual([]);
  });

  /**
   * An ownerless statement of fact is NOT a question to ask. Requiring an owner
   * on every `information` intent would make the assistant ask "who owns 'the
   * Hult meeting is cancelled'?" — spec §27's over-asking, and it would push the
   * model to invent a person. Found by the eval harness across four correctly
   * labelled fixtures.
   */
  it("treats a missing owner on an ownerless fact as advisory, never blocking", () => {
    const issues = validateIntentCompleteness({ intents: [{
      kind: "information", inferenceLevel: "CONFIRMED",
      sourceText: "The Hult meeting is cancelled", objectText: "the Hult meeting",
    }] } as Extraction);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ missingField: "owner", severity: "advisory" });
    expect(issues.filter((issue) => issue.severity === "blocking")).toEqual([]);
  });

  it("indexes issues so a caller can ask about the right intent", () => {
    const issues = validateIntentCompleteness({ intents: [
      { kind: "completion_update", inferenceLevel: "CONFIRMED", sourceText: "done", objectText: "the article" },
      { kind: "action", inferenceLevel: "CONFIRMED", sourceText: "Remind me at 5" },
    ] } as Extraction);
    expect(issues.map((issue) => issue.intentIndex)).toEqual([1]);
  });
});

/**
 * REGRESSION — `stop_reason` was never checked. A max_tokens-truncated tool call
 * can still parse and still pass `isExtraction`, with only SOME of the intents.
 * The Phase 2 demo utterance produces two (a commitment and a reminder), so a
 * truncation silently dropped the reminder and the result looked complete.
 * There is no way to detect this from the payload: a one-intent extraction is
 * perfectly valid for a one-intent utterance.
 */
describe("AnthropicExtractor stop_reason handling", () => {
  const oneIntent = { intents: [{ kind: "information", inferenceLevel: "CONFIRMED", sourceText: "Barkha owes me the article", objectText: "the article" }] };

  const extractorReturning = (overrides: Partial<Anthropic.Message>) => {
    const response = {
      model: EXTRACTION_MODEL,
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: EXTRACTION_TOOL_NAME, id: "toolu_1", input: oneIntent }],
      usage: { input_tokens: 210, output_tokens: 95 },
      ...overrides,
    } as unknown as Anthropic.Message;
    const client = { messages: { create: async () => response } } as unknown as Anthropic;
    return new AnthropicExtractor({ apiKey: "test-key", client });
  };

  it("throws a distinguishable error when the tool call was truncated", async () => {
    // The payload here is VALID and parses — truncation is invisible in it.
    await expect(extractorReturning({ stop_reason: "max_tokens" }).extract("x"))
      .rejects.toMatchObject({ name: "ExtractionError", reason: "truncated" });
  });

  it("distinguishes a refusal from a truncation and from garbage", async () => {
    await expect(extractorReturning({ stop_reason: "refusal" }).extract("x"))
      .rejects.toMatchObject({ reason: "refused" });
    await expect(extractorReturning({ stop_reason: "model_context_window_exceeded" }).extract("x"))
      .rejects.toMatchObject({ reason: "context_window_exceeded" });
    await expect(extractorReturning({ content: [] }).extract("x"))
      .rejects.toMatchObject({ reason: "no_tool_call" });
    await expect(extractorReturning({
      content: [{ type: "tool_use", name: EXTRACTION_TOOL_NAME, id: "t", input: { intents: [] } }],
    } as unknown as Partial<Anthropic.Message>).extract("x"))
      .rejects.toMatchObject({ reason: "invalid_payload" });
  });

  it("carries the utterance and raw payload so the failure is debuggable", async () => {
    // ai-systems.md: an LLM failure with no trace is unfixable.
    const error = await extractorReturning({ stop_reason: "max_tokens" })
      .extract("Barkha needs to give me the article by 6, remind me at 5")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExtractionError);
    const failure = error as ExtractionError;
    expect(failure.utterance).toBe("Barkha needs to give me the article by 6, remind me at 5");
    expect(failure.stopReason).toBe("max_tokens");
    expect(failure.rawPayload).toEqual(oneIntent);
  });

  it("captures stop_reason and cache token counts in the trace", async () => {
    const result = await extractorReturning({
      usage: {
        input_tokens: 210, output_tokens: 95,
        cache_creation_input_tokens: 200, cache_read_input_tokens: 0,
      },
    } as unknown as Partial<Anthropic.Message>).extract("Barkha owes me the article");
    expect(result.trace.stopReason).toBe("tool_use");
    expect(result.trace.usage).toMatchObject({
      inputTokens: 210, outputTokens: 95,
      cacheCreationInputTokens: 200, cacheReadInputTokens: 0,
    });
  });

  it("accepts a well-formed complete response", async () => {
    const result = await extractorReturning({}).extract("Barkha owes me the article");
    expect(result.extraction.intents).toHaveLength(1);
    expect(result.trace.model).toBe(EXTRACTION_MODEL);
  });
});
