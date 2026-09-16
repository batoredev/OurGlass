/**
 * ClaudeProvider — a wrapper, and these tests check it wraps rather than
 * reimplements.
 *
 * No API key and no network: both halves are injected. What is under test is
 * the ADAPTATION — that a thrown SDK error becomes a routable ProviderError,
 * that a never-throwing responder stays never-throwing, and that the Sonnet/
 * Haiku constraint is not quietly bypassed by the new layer.
 */
import { describe, expect, it } from "vitest";
import { EXTRACTION_MODEL, RESPOND_MODEL, type ExtractionResult, type RespondInput } from "@ourglass/shared";
import { ExtractionError } from "../assistant/extract.js";
import type { RespondResult } from "../assistant/respond.js";
import { ClaudeProvider } from "./claude.js";
import { ProviderError } from "./errors.js";

const EXTRACTION: ExtractionResult = {
  extraction: {
    intents: [
      { kind: "context", inferenceLevel: "CONFIRMED", sourceText: "hello", memoryBody: "hello" },
    ],
  },
  trace: {
    model: "claude-sonnet-5",
    latencyMs: 4,
    stopReason: "tool_use",
    usage: { inputTokens: 90, outputTokens: 20 },
  },
};

const REPLY: RespondResult = {
  reply: "Got it.",
  degraded: false,
  trace: { model: "claude-haiku-4-5-20251001", latencyMs: 3, degraded: false },
};

function provider(over: {
  extract?: () => Promise<ExtractionResult>;
  respond?: (input: RespondInput) => Promise<RespondResult>;
} = {}) {
  return new ClaudeProvider({
    apiKey: "test-key-not-a-real-one",
    extractor: { extract: over.extract ?? (async () => EXTRACTION) },
    responder: { respondWithTrace: over.respond ?? (async () => REPLY) },
  });
}

describe("ClaudeProvider", () => {
  it("is named claude and reports the Sonnet/Haiku pair", () => {
    const claude = provider();
    expect(claude.name).toBe("claude");
    // The owner constraint, asserted rather than trusted: this product runs on
    // Sonnet and Haiku only. A provider layer is an easy place to smuggle a
    // different tier in as a "default".
    expect(claude.modelFor("interpret")).toBe(EXTRACTION_MODEL);
    expect(claude.modelFor("respond")).toBe(RESPOND_MODEL);
    expect(claude.modelFor("interpret")).not.toContain("opus");
    expect(claude.modelFor("respond")).not.toContain("opus");
  });

  it("returns the extraction untouched on success", async () => {
    expect(await provider().interpret({ utterance: "hello" })).toEqual(EXTRACTION);
  });

  it("converts a thrown ExtractionError into a routable ProviderError", async () => {
    const claude = provider({
      extract: async () => {
        throw new ExtractionError("invalid_payload", "bad shape", {
          utterance: "hello",
          stopReason: "tool_use",
        });
      },
    });

    await expect(claude.interpret({ utterance: "hello" })).rejects.toBeInstanceOf(ProviderError);
    try {
      await claude.interpret({ utterance: "hello" });
    } catch (error: unknown) {
      const provided = error as ProviderError;
      expect(provided.category).toBe("schema_invalid");
      expect(provided.provider).toBe("claude");
      // Retry once, then let another model try — sampling variance is the
      // likeliest cause of a payload that does not fit the contract.
      expect(provided.retryable).toBe(true);
      expect(provided.fallbackable).toBe(true);
    }
  });

  it("does NOT make a refusal fallbackable", async () => {
    const claude = provider({
      extract: async () => {
        throw new ExtractionError("refused", "declined", {
          utterance: "hello",
          stopReason: "refusal",
        });
      },
    });

    try {
      await claude.interpret({ utterance: "hello" });
      expect.unreachable("interpret should have thrown");
    } catch (error: unknown) {
      const provided = error as ProviderError;
      expect(provided.category).toBe("refused");
      expect(provided.fallbackable).toBe(false);
    }
  });

  it("records the last failure for health, without a network call", async () => {
    const claude = provider({
      extract: async () => {
        throw Object.assign(new Error("429"), { status: 429 });
      },
    });

    expect(claude.health().lastFailureCategory).toBeNull();
    await claude.interpret({ utterance: "hi" }).catch(() => undefined);

    const health = claude.health();
    expect(health.provider).toBe("claude");
    expect(health.configured).toBe(true);
    expect(health.lastFailureCategory).toBe("rate_limit");
    expect(health.lastFailureAt).not.toBeNull();
  });

  it("does NOT throw at construction with no key AND no injected client", () => {
    // THE TEST THAT WAS MISSING, and its absence hid a real bug.
    //
    // The version below injects an extractor, which bypasses construction
    // entirely -- so it passed while proving nothing. Meanwhile
    // AnthropicExtractor's constructor throws on an empty key, and
    // buildAIRouter constructs EVERY provider before asking any of them
    // whether they are configured. A deployment with only a Gemini key
    // therefore crashed while building Claude.
    expect(() => new ClaudeProvider({ apiKey: "" })).not.toThrow();
    expect(new ClaudeProvider({ apiKey: "" }).health().configured).toBe(false);
  });

  it("fails as auth, not as a crash, when used without a key", async () => {
    const claude = new ClaudeProvider({ apiKey: "" });
    const failure = (await claude
      .interpret({ utterance: "hi" })
      .catch((error: unknown) => error)) as ProviderError;

    expect(failure.category).toBe("auth");
    expect(failure.retryable).toBe(false);
    expect(failure.fallbackable).toBe(true);
  });

  it("DEGRADES rather than throwing when respond has no key", async () => {
    // The mutation is already durable by then; an exception would make a
    // committed write look like a failure.
    const result = await new ClaudeProvider({ apiKey: "" }).respond({
      committed: [{ kind: "reminder_created", fireAtLocal: "5 PM" }],
      questions: [],
      declined: [],
    });

    expect(result.degraded).toBe(true);
    expect(result.reply).toContain("Reminder set for 5 PM");
  });

  it("passes a degraded reply through instead of throwing", async () => {
    // respondWithTrace never throws; the wrapper must not invent a throw.
    const degraded: RespondResult = {
      reply: "Done.",
      degraded: true,
      trace: { model: "x", latencyMs: 1, degraded: true, fallbackReason: "timeout" },
    };
    const claude = provider({ respond: async () => degraded });

    const result = await claude.respond({ committed: [], questions: [], declined: [] });
    expect(result.degraded).toBe(true);
    expect(result.trace.fallbackReason).toBe("timeout");
  });
});
