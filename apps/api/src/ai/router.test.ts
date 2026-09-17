/**
 * The router — and every failure scenario the spec names.
 *
 * ================================ READ THIS ================================
 * Scenarios A through G, as executable tests:
 *
 *   A  Claude unavailable                  -> Gemini handles it
 *   B  Claude + Gemini unavailable         -> Qwen handles it
 *   C  interpretation fine, mutation fails -> no provider replay
 *   D  mutation committed, respond fails   -> no replay, template answers
 *   E  ambiguous entity                    -> ASK, never fall back
 *   F  malformed JSON                      -> retry once, then next provider
 *   G  all providers unavailable           -> deterministic safe failure
 *
 * C and D are ORCHESTRATOR properties, not router ones — the router cannot
 * replay a mutation because it has never been given one. They are asserted in
 * orchestrator.integration.test.ts against a real database, which is the only
 * place that claim can honestly be made.
 * ===========================================================================
 */
import { describe, expect, it, vi } from "vitest";
import type {
  AIProviderName,
  AIRequestLog,
  ExtractionResult,
  ProviderHealth,
  RespondInput,
} from "@ourglass/shared";
import type { RespondResult } from "../assistant/respond.js";
import { ExtractionError } from "../assistant/extract.js";
import {
  AIModelRouter,
  AllProvidersFailedError,
  RoutedExtractor,
  RoutedResponder,
} from "./router.js";
import { ProviderError } from "./errors.js";
import type { AIProvider } from "./provider.js";

const OK: ExtractionResult = {
  extraction: {
    intents: [{ kind: "context", inferenceLevel: "CONFIRMED", sourceText: "hi", memoryBody: "hi" }],
  },
  trace: {
    model: "m",
    latencyMs: 1,
    stopReason: "tool_use",
    usage: { inputTokens: 1, outputTokens: 1 },
  },
};

const GOOD_REPLY: RespondResult = {
  reply: "Got it.",
  degraded: false,
  trace: { model: "m", latencyMs: 1, degraded: false },
};

interface FakeOptions {
  readonly interpret?: () => Promise<ExtractionResult>;
  readonly respond?: () => Promise<RespondResult>;
  readonly configured?: boolean;
}

function fake(name: AIProviderName, options: FakeOptions = {}) {
  const calls = { interpret: 0, respond: 0 };
  const provider: AIProvider = {
    name,
    modelFor: () => `${name}-model`,
    async interpret() {
      calls.interpret += 1;
      return options.interpret ? options.interpret() : OK;
    },
    async respond() {
      calls.respond += 1;
      return options.respond ? options.respond() : GOOD_REPLY;
    },
    health(): ProviderHealth {
      return {
        provider: name,
        configured: options.configured ?? true,
        lastFailureAt: null,
        lastFailureCategory: null,
      };
    },
  };
  return { provider, calls };
}

function router(
  providers: readonly AIProvider[],
  over: Partial<ConstructorParameters<typeof AIModelRouter>[0]> = {},
) {
  return new AIModelRouter({
    providers,
    // No real waiting and no real jitter: a retry test that sleeps is a slow
    // test, and a flaky one.
    sleep: async () => undefined,
    random: () => 0,
    ...over,
  });
}

const status = (code: number) => Object.assign(new Error(`HTTP ${code}`), { status: code });

describe("the happy path calls ONE provider", () => {
  it("stops at Claude and never touches Gemini or Qwen", async () => {
    // §27: three models per request is a cost and latency bug, not resilience.
    const claude = fake("claude");
    const gemini = fake("gemini");
    const qwen = fake("qwen");

    const result = await router([claude.provider, gemini.provider, qwen.provider]).interpret({
      utterance: "hello",
    });

    expect(result.provider).toBe("claude");
    expect(result.fallbackUsed).toBe(false);
    expect(claude.calls.interpret).toBe(1);
    expect(gemini.calls.interpret).toBe(0);
    expect(qwen.calls.interpret).toBe(0);
  });
});

describe("Scenario A — Claude unavailable", () => {
  it("Gemini handles the request", async () => {
    const claude = fake("claude", {
      interpret: async () => {
        throw status(503);
      },
    });
    const gemini = fake("gemini");
    const qwen = fake("qwen");

    const result = await router([claude.provider, gemini.provider, qwen.provider]).interpret({
      utterance: "hello",
    });

    expect(result.provider).toBe("gemini");
    expect(result.fallbackUsed).toBe(true);
    expect(qwen.calls.interpret).toBe(0);
  });
});

describe("Scenario B — Claude and Gemini unavailable", () => {
  it("Qwen handles the request", async () => {
    const claude = fake("claude", {
      interpret: async () => {
        throw status(500);
      },
    });
    const gemini = fake("gemini", {
      interpret: async () => {
        throw status(429);
      },
    });
    const qwen = fake("qwen");

    const result = await router([claude.provider, gemini.provider, qwen.provider]).interpret({
      utterance: "hello",
    });

    expect(result.provider).toBe("qwen");
    expect(qwen.calls.interpret).toBe(1);
  });
});

describe("Scenario E — ambiguity is NOT a provider failure", () => {
  it("returns the clarifying extraction without consulting another provider", async () => {
    // THE MOST IMPORTANT TEST IN THIS FILE. "Which Karthik?" is the product
    // working. Falling back here would shop for a model willing to guess,
    // which is exactly what §27 and the three-band resolution design exist to
    // prevent. An UNCERTAIN extraction is a SUCCESS and never reaches the
    // failure path at all.
    const uncertain: ExtractionResult = {
      extraction: {
        intents: [
          {
            kind: "information",
            inferenceLevel: "UNCERTAIN",
            sourceText: "Karthik needs to send it",
            objectText: "it",
            owner: { name: "Karthik", kind: "person", inferenceLevel: "UNCERTAIN" },
          },
        ],
      },
      trace: {
        model: "m",
        latencyMs: 1,
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    };
    const claude = fake("claude", { interpret: async () => uncertain });
    const gemini = fake("gemini");

    const result = await router([claude.provider, gemini.provider]).interpret({
      utterance: "Karthik needs to send it",
    });

    expect(result.provider).toBe("claude");
    expect(result.extraction.intents[0]?.inferenceLevel).toBe("UNCERTAIN");
    expect(gemini.calls.interpret).toBe(0);
  });

  it("does not fall back on a refusal either", async () => {
    // A safety decision, not a fault. Trying the next provider is shopping
    // past it.
    const claude = fake("claude", {
      interpret: async () => {
        throw new ExtractionError("refused", "declined", { utterance: "x", stopReason: "refusal" });
      },
    });
    const gemini = fake("gemini");

    await expect(
      router([claude.provider, gemini.provider]).interpret({ utterance: "x" }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(gemini.calls.interpret).toBe(0);
  });

  it("does not fall back on truncation or an oversized input", async () => {
    for (const reason of ["truncated", "context_window_exceeded"] as const) {
      const claude = fake("claude", {
        interpret: async () => {
          throw new ExtractionError(reason, "nope", { utterance: "x", stopReason: "max_tokens" });
        },
      });
      const gemini = fake("gemini");

      await expect(
        router([claude.provider, gemini.provider]).interpret({ utterance: "x" }),
      ).rejects.toBeInstanceOf(ProviderError);
      expect(gemini.calls.interpret, reason).toBe(0);
    }
  });
});

describe("Scenario F — malformed output retries once, then falls back", () => {
  it("retries the same provider before moving on", async () => {
    let attempts = 0;
    const claude = fake("claude", {
      interpret: async () => {
        attempts += 1;
        throw new ExtractionError("invalid_payload", "bad", {
          utterance: "x",
          stopReason: "tool_use",
        });
      },
    });
    const gemini = fake("gemini");

    const result = await router([claude.provider, gemini.provider]).interpret({ utterance: "x" });

    // Exactly twice: the first attempt and ONE retry. Not a loop.
    expect(attempts).toBe(2);
    expect(result.provider).toBe("gemini");
  });

  it("succeeds on the retry without falling back at all", async () => {
    let attempts = 0;
    const claude = fake("claude", {
      interpret: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new ExtractionError("invalid_payload", "bad", {
            utterance: "x",
            stopReason: "tool_use",
          });
        }
        return OK;
      },
    });
    const gemini = fake("gemini");

    const result = await router([claude.provider, gemini.provider]).interpret({ utterance: "x" });

    expect(result.provider).toBe("claude");
    expect(result.fallbackUsed).toBe(false);
    expect(gemini.calls.interpret).toBe(0);
  });

  it("NEVER retries a permanent auth failure", async () => {
    // A wrong key stays wrong. Retrying is latency the user pays for nothing,
    // before the fallback that was always going to happen.
    let attempts = 0;
    const claude = fake("claude", {
      interpret: async () => {
        attempts += 1;
        throw status(401);
      },
    });
    const gemini = fake("gemini");

    const result = await router([claude.provider, gemini.provider]).interpret({ utterance: "x" });

    expect(attempts).toBe(1);
    expect(result.provider).toBe("gemini");
  });
});

describe("RoutedExtractor speaks runTurn's failure contract", () => {
  // runTurn degrades gracefully ONLY on ExtractionError. Anything else becomes
  // a 500 with the user's message persisted and nothing beside it.

  it("turns an all-providers outage into ExtractionError(provider_error)", async () => {
    const down = async (): Promise<ExtractionResult> => {
      throw status(503);
    };
    const extractor = new RoutedExtractor(
      router([fake("claude", { interpret: down }).provider, fake("gemini", { interpret: down }).provider]),
    );

    const error = await extractor.extract("hi").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionError);
    expect((error as ExtractionError).reason).toBe("provider_error");
    // The trail survives into the message, for the log.
    expect((error as ExtractionError).message).toContain("claude:server_error");
  });

  it("hands back the provider's OWN ExtractionError for a refusal, stop reason intact", async () => {
    const original = new ExtractionError("refused", "declined", {
      utterance: "hi",
      stopReason: "refusal",
    });
    const claude = fake("claude", {
      interpret: async () => {
        throw new ProviderError("claude", "refused", "declined", { cause: original });
      },
    });

    const error = await new RoutedExtractor(router([claude.provider]))
      .extract("hi")
      .catch((e: unknown) => e);
    expect(error).toBe(original);
  });

  it("maps a terminal failure with no ExtractionError behind it", async () => {
    // A 400 we caused: terminal, not a model answer, still must not 500.
    const claude = fake("claude", {
      interpret: async () => {
        throw status(400);
      },
    });
    const error = await new RoutedExtractor(router([claude.provider]))
      .extract("hi")
      .catch((e: unknown) => e);
    expect((error as ExtractionError).reason).toBe("provider_error");
  });
});

describe("Scenario G — every provider unavailable", () => {
  it("fails deterministically, naming the whole trail", async () => {
    const claude = fake("claude", {
      interpret: async () => {
        throw status(500);
      },
    });
    const gemini = fake("gemini", {
      interpret: async () => {
        throw status(503);
      },
    });
    const qwen = fake("qwen", {
      interpret: async () => {
        throw new TypeError("fetch failed");
      },
    });

    try {
      await router([claude.provider, gemini.provider, qwen.provider]).interpret({ utterance: "x" });
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AllProvidersFailedError);
      const failed = error as AllProvidersFailedError;
      // Every attempt named, so a 3am log says which three ways it broke.
      expect(failed.failures.map((f) => f.provider)).toEqual([
        "claude",
        "claude",
        "gemini",
        "gemini",
        "qwen",
        "qwen",
      ]);
      expect(failed.message).toContain("claude:server_error");
      expect(failed.message).toContain("qwen:network");
    }
  });

  it("still answers on the RESPOND stage, from the template", async () => {
    // The mutation is already durable. Respond must degrade, never throw.
    const claude = fake("claude", {
      respond: async () => {
        throw status(500);
      },
    });
    const input: RespondInput = {
      committed: [{ kind: "reminder_created", fireAtLocal: "5 PM" }],
      questions: [],
      declined: [],
    };

    const reply = await router([claude.provider]).respond(input);

    expect(reply.degraded).toBe(true);
    expect(reply.provider).toBeNull();
    // Deterministic, from templateReply — not an empty string and not a crash.
    expect(reply.reply).toContain("Reminder set for 5 PM");
  });
});

describe("respond-stage fallback is narrower than interpret's", () => {
  const input: RespondInput = { committed: [], questions: [], declined: [] };

  it("tries another provider on a transport degradation", async () => {
    const claude = fake("claude", {
      respond: async () => ({
        reply: "Done.",
        degraded: true,
        trace: { model: "m", latencyMs: 1, degraded: true, fallbackReason: "timeout" },
      }),
    });
    const gemini = fake("gemini");

    const reply = await router([claude.provider, gemini.provider]).respond(input);

    expect(reply.provider).toBe("gemini");
    expect(reply.degraded).toBe(false);
  });

  it("does NOT shop for a second opinion on a refusal or a verbose reply", async () => {
    for (const reason of ["refusal", "too_long"] as const) {
      const claude = fake("claude", {
        respond: async () => ({
          reply: "Done.",
          degraded: true,
          trace: { model: "m", latencyMs: 1, degraded: true, fallbackReason: reason },
        }),
      });
      const gemini = fake("gemini");

      const reply = await router([claude.provider, gemini.provider]).respond(input);

      expect(reply.provider, reason).toBe("claude");
      expect(gemini.calls.respond, reason).toBe(0);
    }
  });
});

describe("configuration", () => {
  it("SKIPS an unconfigured provider rather than failing on it", async () => {
    // An unset GEMINI_API_KEY is a deployment choosing two providers, not an
    // error — and counting it as a failure would make the trail lie.
    const claude = fake("claude", {
      interpret: async () => {
        throw status(500);
      },
    });
    const gemini = fake("gemini", { configured: false });
    const qwen = fake("qwen");

    const result = await router([claude.provider, gemini.provider, qwen.provider]).interpret({
      utterance: "x",
    });

    expect(result.provider).toBe("qwen");
    expect(gemini.calls.interpret).toBe(0);
  });

  it("honours a per-stage order override (§29)", async () => {
    const claude = fake("claude");
    const qwen = fake("qwen");

    const result = await router([claude.provider, qwen.provider], {
      stageOrder: { interpret: ["qwen", "claude"] },
    }).interpret({ utterance: "x" });

    expect(result.provider).toBe("qwen");
    expect(claude.calls.interpret).toBe(0);
  });

  it("tries only the first provider when fallback is disabled", async () => {
    const claude = fake("claude", {
      interpret: async () => {
        throw status(500);
      },
    });
    const gemini = fake("gemini");

    await expect(
      router([claude.provider, gemini.provider], { enableFallback: false }).interpret({
        utterance: "x",
      }),
    ).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(gemini.calls.interpret).toBe(0);
  });

  it("bounds the wait even when a provider never settles", async () => {
    const claude = fake("claude", {
      interpret: () => new Promise<ExtractionResult>(() => undefined),
    });
    const gemini = fake("gemini");

    const result = await router([claude.provider, gemini.provider], { timeoutMs: 5 }).interpret({
      utterance: "x",
    });

    expect(result.provider).toBe("gemini");
  });
});

describe("observability", () => {
  it("logs one record per attempt, with no secret and no utterance", async () => {
    const records: AIRequestLog[] = [];
    const claude = fake("claude", {
      interpret: async () => {
        throw status(500);
      },
    });
    const gemini = fake("gemini");

    await router([claude.provider, gemini.provider], {
      onLog: (record) => records.push(record),
    }).interpret({ utterance: "a private sentence about Barkha" });

    // claude attempt 1, claude retry, gemini success.
    expect(records).toHaveLength(3);
    expect(records.map((r) => [r.provider, r.ok])).toEqual([
      ["claude", false],
      ["claude", false],
      ["gemini", true],
    ]);
    expect(records[2]?.fallbackUsed).toBe(true);
    expect(records.every((r) => r.requestId === records[0]?.requestId)).toBe(true);

    // The utterance is already persisted in `messages` with its own
    // provenance; copying personal content into a log line gives it a second
    // retention story nobody signed up for.
    const serialised = JSON.stringify(records);
    expect(serialised).not.toContain("Barkha");
    expect(serialised).not.toContain("private sentence");
  });

  it("does not let a throwing logger take down a turn", async () => {
    const claude = fake("claude");
    const result = await router([claude.provider], {
      onLog: () => {
        throw new Error("logger exploded");
      },
    }).interpret({ utterance: "x" });

    expect(result.provider).toBe("claude");
  });
});

describe("RoutedExtractor keeps runTurn's interface unchanged", () => {
  it("satisfies Extractor and returns a plain ExtractionResult", async () => {
    const claude = fake("claude");
    const extractor = new RoutedExtractor(router([claude.provider]));

    const result = await extractor.extract("hello");

    expect(result.extraction.intents).toHaveLength(1);
    // Same top-level shape as before the router existed, which is why runTurn
    // needed no edit — provenance rides INSIDE the trace (§21).
    expect(Object.keys(result).sort()).toEqual(["extraction", "trace"]);
    expect(result.trace.provider).toBe("claude");
    expect(result.trace.fallbackUsed).toBe(false);
  });
});

describe("requestId correlates both stages of one turn", () => {
  it("uses the adapter's id for interpret AND respond", async () => {
    // One turn, one id, across two stages and any number of retries. Without
    // it, the log for a failed turn is three unrelated lines.
    const records: AIRequestLog[] = [];
    const claude = fake("claude");
    const shared = router([claude.provider], { onLog: (record) => records.push(record) });

    await new RoutedExtractor(shared, "turn-abc").extract("hello");
    await new RoutedResponder(shared, "turn-abc").respondWithTrace({
      committed: [],
      questions: [],
      declined: [],
    });

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.stage)).toEqual(["interpret", "respond"]);
    expect(records.every((r) => r.requestId === "turn-abc")).toBe(true);
  });

  it("still works without one, rather than requiring it", async () => {
    const records: AIRequestLog[] = [];
    const claude = fake("claude");
    await new RoutedExtractor(
      router([claude.provider], { onLog: (record) => records.push(record) }),
    ).extract("hello");

    expect(records[0]?.requestId).toBeTruthy();
  });
});

describe("provenance is persisted, and never clobbers the vendor request id", () => {
  it("stamps provider, fallback and correlation id into both traces", async () => {
    const claude = fake("claude", { interpret: async () => { throw status(503); } });
    const gemini = fake("gemini", {
      interpret: async () => ({ ...OK, trace: { ...OK.trace, requestId: "vendor-req-1" } }),
    });
    const shared = router([claude.provider, gemini.provider]);

    const extracted = await new RoutedExtractor(shared, "turn-9").extract("hi");
    expect(extracted.trace.provider).toBe("gemini");
    expect(extracted.trace.fallbackUsed).toBe(true);
    expect(extracted.trace.correlationId).toBe("turn-9");
    // The vendor's id survives. Overwriting it would destroy the only handle
    // for a support conversation with them.
    expect(extracted.trace.requestId).toBe("vendor-req-1");

    const replied = await new RoutedResponder(shared, "turn-9").respondWithTrace({
      committed: [], questions: [], declined: [],
    });
    expect(replied.trace.correlationId).toBe("turn-9");
    expect(replied.trace.provider).toBe("claude");
  });
});

describe("health", () => {
  it("reports every provider without making a model call", () => {
    const claude = fake("claude");
    const gemini = fake("gemini", { configured: false });
    const spy = vi.spyOn(claude.provider, "interpret");

    const health = router([claude.provider, gemini.provider]).health();

    expect(health.map((h) => [h.provider, h.configured])).toEqual([
      ["claude", true],
      ["gemini", false],
    ]);
    expect(spy).not.toHaveBeenCalled();
  });
});
