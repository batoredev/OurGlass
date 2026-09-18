/**
 * GeminiProvider — normalisation, and the failure taxonomy.
 *
 * ================================ READ THIS ================================
 * ⚠ NO LIVE CALL IS MADE HERE. Every test injects a fake client, so what is
 * verified is the ADAPTER — normalisation into the shared contract, the
 * finish-reason mapping, the never-throws respond guarantee, and the request
 * shape — and NOT that any model id exists or that the SDK behaves as its
 * type declarations say. `pnpm check:models` answers the first; nothing here
 * answers the second.
 *
 * That distinction earned its place: the shipped default model `404`d for new
 * keys while this file was green, because a fake client accepts any name.
 * ===========================================================================
 */
import { describe, expect, it } from "vitest";
import type { RespondInput } from "@ourglass/shared";
import { GeminiProvider, type GeminiLikeClient, type GeminiLikeResponse } from "./gemini.js";
import type { ProviderError } from "./errors.js";

const VALID_EXTRACTION = {
  intents: [
    {
      kind: "information",
      inferenceLevel: "CONFIRMED",
      sourceText: "Barkha needs to give me the article",
      objectText: "the article",
      owner: { name: "Barkha", kind: "person", inferenceLevel: "CONFIRMED" },
    },
  ],
};

function client(response: Partial<GeminiLikeResponse> | (() => never)): GeminiLikeClient {
  return {
    models: {
      async generateContent() {
        if (typeof response === "function") response();
        return response as GeminiLikeResponse;
      },
    },
  };
}

function provider(response: Partial<GeminiLikeResponse> | (() => never)) {
  return new GeminiProvider({ apiKey: "", client: client(response) });
}

describe("interpret normalises into the shared contract", () => {
  it("parses schema-constrained JSON into an Extraction", async () => {
    const gemini = provider({
      text: JSON.stringify(VALID_EXTRACTION),
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 45 },
    });

    const result = await gemini.interpret({ utterance: "Barkha needs to give me the article" });

    // The SAME shape Claude returns. Nothing downstream can tell which model
    // answered, which is what makes the fallback chain meaningful.
    expect(result.extraction.intents[0]?.kind).toBe("information");
    expect(result.extraction.intents[0]?.owner?.name).toBe("Barkha");
    expect(result.trace.usage).toEqual({ inputTokens: 120, outputTokens: 45 });
    expect(result.trace.stopReason).toBe("STOP");
  });

  it("REJECTS a payload with a stray field, which Gemini's schema cannot prevent", async () => {
    // Gemini has no additionalProperties, so this is the ONLY gate. An extra
    // key must fail validation rather than reach the planner.
    const gemini = provider({
      text: JSON.stringify({
        intents: [
          {
            kind: "context",
            inferenceLevel: "CONFIRMED",
            sourceText: "hi",
            invented: "a field nobody declared",
          },
        ],
      }),
      candidates: [{ finishReason: "STOP" }],
    });

    const failure = await gemini
      .interpret({ utterance: "hi" })
      .catch((error: unknown) => error) as ProviderError;

    expect(failure.category).toBe("schema_invalid");
    // Retry once, then let another model try — sampling variance is the
    // likeliest cause.
    expect(failure.retryable).toBe(true);
    expect(failure.fallbackable).toBe(true);
  });

  it("treats unparseable text as malformed output, not a contract failure", async () => {
    const gemini = provider({ text: "Sure! Here you go:", candidates: [{ finishReason: "STOP" }] });

    const failure = await gemini
      .interpret({ utterance: "hi" })
      .catch((error: unknown) => error) as ProviderError;
    expect(failure.category).toBe("malformed_output");
    expect(failure.retryable).toBe(true);
  });

  it("maps MAX_TOKENS to truncated, which is TERMINAL", async () => {
    // Our max_tokens, identical at every provider — falling back would spend
    // two more calls to fail the same way.
    const gemini = provider({
      text: JSON.stringify(VALID_EXTRACTION),
      candidates: [{ finishReason: "MAX_TOKENS" }],
    });

    const failure = await gemini
      .interpret({ utterance: "hi" })
      .catch((error: unknown) => error) as ProviderError;
    expect(failure.category).toBe("truncated");
    expect(failure.fallbackable).toBe(false);
  });

  it("maps EVERY safety finish reason to refused, and refused is terminal", async () => {
    // Gemini's safety vocabulary is far wider than Anthropic's single
    // `refusal`, which is why this is a table rather than one if.
    for (const reason of ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]) {
      const gemini = provider({ text: "", candidates: [{ finishReason: reason }] });
      const failure = await gemini
        .interpret({ utterance: "hi" })
        .catch((error: unknown) => error) as ProviderError;

      expect(failure.category, reason).toBe("refused");
      expect(failure.fallbackable, reason).toBe(false);
    }
  });

  it("classifies an HTTP status thrown by the SDK", async () => {
    const gemini = provider(() => {
      throw Object.assign(new Error("rate limited"), { status: 429 });
    });

    const failure = await gemini
      .interpret({ utterance: "hi" })
      .catch((error: unknown) => error) as ProviderError;
    expect(failure.category).toBe("rate_limit");
    expect(failure.provider).toBe("gemini");
  });

  it("refuses an empty utterance as a bad request, not a provider fault", async () => {
    const failure = await provider({ text: "{}" })
      .interpret({ utterance: "   " })
      .catch((error: unknown) => error) as ProviderError;

    expect(failure.category).toBe("bad_request");
    // Our bug. Every provider rejects it, so falling back turns one clear
    // error into three.
    expect(failure.fallbackable).toBe(false);
  });

  it("records the last failure for health without a network call", async () => {
    const gemini = provider(() => {
      throw Object.assign(new Error("boom"), { status: 500 });
    });
    await gemini.interpret({ utterance: "hi" }).catch(() => undefined);

    expect(gemini.health().lastFailureCategory).toBe("server_error");
  });
});

describe("respond never throws", () => {
  const input: RespondInput = {
    committed: [{ kind: "reminder_created", fireAtLocal: "5 PM" }],
    questions: [],
    declined: [],
  };

  it("returns the model's prose when it is usable", async () => {
    const result = await provider({
      text: "Reminder set for 5 PM.",
      candidates: [{ finishReason: "STOP" }],
    }).respond(input);

    expect(result.degraded).toBe(false);
    expect(result.reply).toBe("Reminder set for 5 PM.");
  });

  it("degrades to the template when the SDK throws", async () => {
    const result = await provider(() => {
      throw new Error("network down");
    }).respond(input);

    expect(result.degraded).toBe(true);
    expect(result.trace.fallbackReason).toBe("sdk_error");
    // Deterministic, and correct — not an empty string and not a crash.
    expect(result.reply).toContain("Reminder set for 5 PM");
  });

  it("degrades on a refusal, an empty reply, a wall of text, and truncation", async () => {
    const cases: readonly [Partial<GeminiLikeResponse>, string][] = [
      [{ text: "x", candidates: [{ finishReason: "SAFETY" }] }, "refusal"],
      [{ text: "   ", candidates: [{ finishReason: "STOP" }] }, "empty_text"],
      [{ text: "y".repeat(2_000), candidates: [{ finishReason: "STOP" }] }, "too_long"],
      [{ text: "cut off", candidates: [{ finishReason: "MAX_TOKENS" }] }, "max_tokens"],
    ];

    for (const [response, expected] of cases) {
      const result = await provider(response).respond(input);
      expect(result.degraded, expected).toBe(true);
      expect(result.trace.fallbackReason, expected).toBe(expected);
    }
  });
});

/**
 * THE REQUEST SHAPE — the half a fake client can still check.
 *
 * A fake accepts any model name and any config, so these tests cannot say the
 * call SUCCEEDS. They can say we send what we decided to send, and that is
 * exactly the guard the thinking-budget bug needed: Gemini 3.x Flash spent the
 * entire 200-token reply budget thinking, emitted four tokens, hit MAX_TOKENS,
 * and every reply silently became the template — which reads like the product
 * working. Delete `thinkingConfig` from either stage and one of these fails.
 */
describe("the request disables thinking on both stages", () => {
  function capturing(): { calls: Record<string, unknown>[]; client: GeminiLikeClient } {
    const calls: Record<string, unknown>[] = [];
    return {
      calls,
      client: {
        models: {
          async generateContent(params) {
            calls.push(params as unknown as Record<string, unknown>);
            return {
              text: JSON.stringify(VALID_EXTRACTION),
              candidates: [{ finishReason: "STOP" }],
            };
          },
        },
      },
    };
  }

  it("sends thinkingBudget 0 when interpreting", async () => {
    const { calls, client: fake } = capturing();
    await new GeminiProvider({ apiKey: "", client: fake }).interpret({ utterance: "hi" });

    const config = calls[0]?.["config"] as Record<string, unknown>;
    expect(config["thinkingConfig"]).toEqual({ thinkingBudget: 0 });
    // The budget is shared with the OUTPUT, so this is what keeps the
    // extraction cap meaningful rather than a ceiling on deliberation.
    expect(config["maxOutputTokens"]).toBe(1_200);
  });

  it("sends thinkingBudget 0 when responding", async () => {
    const { calls, client: fake } = capturing();
    await new GeminiProvider({ apiKey: "", client: fake }).respond({
      committed: [{ kind: "reminder_created", fireAtLocal: "5 PM" }],
      questions: [],
      declined: [],
    });

    const config = calls[0]?.["config"] as Record<string, unknown>;
    expect(config["thinkingConfig"]).toEqual({ thinkingBudget: 0 });
  });
});

describe("configuration", () => {
  it("reports unconfigured without a key, rather than throwing at construction", () => {
    // The ROUTER decides what to do about an unconfigured provider. Throwing
    // here would make an unset GEMINI_API_KEY crash the process at startup
    // instead of simply leaving Gemini out of the chain.
    expect(new GeminiProvider({ apiKey: "" }).health().configured).toBe(false);
    expect(new GeminiProvider({ apiKey: "a-key" }).health().configured).toBe(true);
  });

  it("fails as auth, not as a crash, when asked to work without a key", async () => {
    const failure = await new GeminiProvider({ apiKey: "" })
      .interpret({ utterance: "hi" })
      .catch((error: unknown) => error) as ProviderError;

    expect(failure.category).toBe("auth");
    // A wrong key stays wrong: no retry, but another provider may be configured.
    expect(failure.retryable).toBe(false);
    expect(failure.fallbackable).toBe(true);
  });

  it("exposes configurable models per stage", () => {
    const gemini = new GeminiProvider({
      apiKey: "k",
      interpretModel: "gemini-custom-pro",
      respondModel: "gemini-custom-flash",
    });

    expect(gemini.modelFor("interpret")).toBe("gemini-custom-pro");
    expect(gemini.modelFor("respond")).toBe("gemini-custom-flash");
  });
});
