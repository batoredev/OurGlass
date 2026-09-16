/**
 * QwenProvider — the request Ollama receives, and the failure taxonomy.
 *
 * ================================ READ THIS ================================
 * ⚠ NO OLLAMA WAS CONTACTED. It is not installed on this machine and nothing
 * serves :11434. Every test injects a fake `fetch`, so what is verified is
 * the adapter: the request body, normalisation into the shared contract, the
 * failure mapping, and the never-throws respond guarantee.
 *
 * NOT verified: that a real Ollama answers this way, or that `qwen3:8b` is
 * pulled anywhere.
 * ===========================================================================
 */
import { describe, expect, it } from "vitest";
import type { RespondInput } from "@ourglass/shared";
import { EXTRACTION_INPUT_SCHEMA } from "@ourglass/shared";
import { QwenProvider, type FetchLike, type OllamaChatResponse } from "./qwen.js";
import type { ProviderError } from "./errors.js";

const VALID = {
  intents: [
    {
      kind: "context",
      inferenceLevel: "CONFIRMED",
      sourceText: "Arun handles the backend",
      memoryBody: "Arun handles the backend",
    },
  ],
};

interface Captured {
  url?: string;
  body?: Record<string, unknown>;
}

function fakeFetch(
  response: Partial<OllamaChatResponse> | (() => never),
  options: { status?: number; captured?: Captured } = {},
): FetchLike {
  return async (url, init) => {
    if (options.captured) {
      options.captured.url = url;
      options.captured.body = JSON.parse(init.body) as Record<string, unknown>;
    }
    if (typeof response === "function") response();
    const status = options.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return response as OllamaChatResponse;
      },
      async text() {
        return JSON.stringify(response);
      },
    };
  };
}

const provider = (
  response: Partial<OllamaChatResponse> | (() => never),
  options: { status?: number; captured?: Captured } = {},
) => new QwenProvider({ fetchImpl: fakeFetch(response, options) });

describe("the request Ollama actually receives", () => {
  it("posts to /api/chat with the schema as `format`, not the string json", async () => {
    // Passing "json" would produce JSON-SHAPED output with no structure.
    // The schema is what makes it structured.
    const captured: Captured = {};
    await provider(
      { message: { content: JSON.stringify(VALID) }, done_reason: "stop" },
      { captured },
    ).interpret({ utterance: "Arun handles the backend" });

    expect(captured.url).toBe("http://localhost:11434/api/chat");
    expect(captured.body?.["format"]).toEqual(EXTRACTION_INPUT_SCHEMA);
    expect(captured.body?.["stream"]).toBe(false);
    expect(captured.body?.["model"]).toBe("qwen3:8b");
  });

  it("strips a trailing slash from the base URL exactly once", async () => {
    const captured: Captured = {};
    await new QwenProvider({
      baseUrl: "http://ollama.internal:11434/",
      fetchImpl: fakeFetch({ message: { content: JSON.stringify(VALID) } }, { captured }),
    }).interpret({ utterance: "hi" });

    expect(captured.url).toBe("http://ollama.internal:11434/api/chat");
  });

  it("sends NO tools and NO format on the respond stage", async () => {
    // A schema here would turn the reply into JSON; tools would be a surface
    // that does not need to exist at all.
    const captured: Captured = {};
    await provider({ message: { content: "Got it." }, done_reason: "stop" }, { captured }).respond({
      committed: [],
      questions: [],
      declined: [],
    });

    expect(captured.body).not.toHaveProperty("format");
    expect(captured.body).not.toHaveProperty("tools");
  });
});

describe("interpret normalises into the shared contract", () => {
  it("returns the same Extraction shape the other providers do", async () => {
    const result = await provider({
      message: { content: JSON.stringify(VALID) },
      done_reason: "stop",
      prompt_eval_count: 88,
      eval_count: 24,
    }).interpret({ utterance: "Arun handles the backend" });

    expect(result.extraction.intents[0]?.memoryBody).toBe("Arun handles the backend");
    expect(result.trace.usage).toEqual({ inputTokens: 88, outputTokens: 24 });
    expect(result.trace.model).toBe("qwen3:8b");
  });

  it("REJECTS a payload that does not match the contract", async () => {
    // A local model is the most likely of the three to drift from the schema,
    // which makes this the least optional of the three validations.
    const failure = (await provider({
      message: { content: JSON.stringify({ intents: [{ kind: "not_a_real_kind" }] }) },
      done_reason: "stop",
    })
      .interpret({ utterance: "hi" })
      .catch((error: unknown) => error)) as ProviderError;

    expect(failure.category).toBe("schema_invalid");
    expect(failure.retryable).toBe(true);
  });

  it("treats non-JSON as malformed output", async () => {
    const failure = (await provider({ message: { content: "here you go" }, done_reason: "stop" })
      .interpret({ utterance: "hi" })
      .catch((error: unknown) => error)) as ProviderError;

    expect(failure.category).toBe("malformed_output");
  });

  it("maps done_reason length to truncated, which is TERMINAL", async () => {
    const failure = (await provider({
      message: { content: JSON.stringify(VALID) },
      done_reason: "length",
    })
      .interpret({ utterance: "hi" })
      .catch((error: unknown) => error)) as ProviderError;

    expect(failure.category).toBe("truncated");
    expect(failure.fallbackable).toBe(false);
  });

  it("maps a dead daemon to network, so the router falls back", async () => {
    // THE most likely real-world failure: Ollama simply is not running.
    // `fetch` reports it as a bare TypeError with no status.
    const failure = (await provider(() => {
      throw new TypeError("fetch failed");
    })
      .interpret({ utterance: "hi" })
      .catch((error: unknown) => error)) as ProviderError;

    expect(failure.category).toBe("network");
    expect(failure.fallbackable).toBe(true);
  });

  it("maps an HTTP error status through the shared table", async () => {
    // 404 from Ollama usually means the model tag is not pulled.
    const failure = (await provider({}, { status: 404 })
      .interpret({ utterance: "hi" })
      .catch((error: unknown) => error)) as ProviderError;

    expect(failure.category).toBe("unavailable");
  });

  it("refuses an empty utterance as a bad request", async () => {
    const failure = (await provider({})
      .interpret({ utterance: "  " })
      .catch((error: unknown) => error)) as ProviderError;

    expect(failure.category).toBe("bad_request");
    expect(failure.fallbackable).toBe(false);
  });
});

describe("respond never throws", () => {
  const input: RespondInput = {
    committed: [{ kind: "reminder_created", fireAtLocal: "5 PM" }],
    questions: [],
    declined: [],
  };

  it("returns usable prose", async () => {
    const result = await provider({
      message: { content: "Reminder set for 5 PM." },
      done_reason: "stop",
    }).respond(input);

    expect(result.degraded).toBe(false);
    expect(result.reply).toBe("Reminder set for 5 PM.");
  });

  it("degrades to the template when Ollama is unreachable", async () => {
    const result = await provider(() => {
      throw new TypeError("fetch failed");
    }).respond(input);

    expect(result.degraded).toBe(true);
    expect(result.trace.fallbackReason).toBe("sdk_error");
    expect(result.reply).toContain("Reminder set for 5 PM");
  });

  it("degrades on an empty reply, a wall of text, and truncation", async () => {
    const cases: readonly [Partial<OllamaChatResponse>, string][] = [
      [{ message: { content: "   " }, done_reason: "stop" }, "empty_text"],
      [{ message: { content: "y".repeat(2_000) }, done_reason: "stop" }, "too_long"],
      [{ message: { content: "cut" }, done_reason: "length" }, "max_tokens"],
    ];

    for (const [response, expected] of cases) {
      const result = await provider(response).respond(input);
      expect(result.degraded, expected).toBe(true);
      expect(result.trace.fallbackReason, expected).toBe(expected);
    }
  });
});

describe("configuration", () => {
  it("is configured by a base URL alone — there is no key", () => {
    expect(new QwenProvider().health().configured).toBe(true);
    expect(new QwenProvider().health().lastFailureCategory).toBeNull();
  });

  it("uses ONE model for both stages", () => {
    // Unlike Claude and Gemini. Asking a local deployment to hold two models
    // doubles disk and RAM for a fallback that may never fire.
    const qwen = new QwenProvider({ model: "qwen3:4b" });
    expect(qwen.modelFor()).toBe("qwen3:4b");
  });

  it("records the last failure for health", async () => {
    const qwen = provider({}, { status: 500 });
    await qwen.interpret({ utterance: "hi" }).catch(() => undefined);

    expect(qwen.health().lastFailureCategory).toBe("server_error");
  });
});
