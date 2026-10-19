import { describe, expect, it } from "vitest";
import type { RespondInput } from "@ourglass/shared";
import { OPENAI_COMPAT_DEFAULTS, OpenAICompatProvider } from "./openai-compat.js";
import type { FetchLike } from "./qwen.js";
import type { ProviderError } from "./errors.js";

const EXTRACTION = {
  intents: [
    {
      kind: "information",
      inferenceLevel: "CONFIRMED",
      sourceText: "Karthik owes me the budget by Friday",
      objectText: "the budget",
      owner: { name: "Karthik", kind: "person", inferenceLevel: "CONFIRMED" },
      recipient: { name: "me", kind: "person", inferenceLevel: "CONFIRMED" },
      time: { kind: "deterministic", sourcePhrase: "by Friday" },
    },
  ],
};

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fake endpoint answering each call from `replies` in order, recording what was sent. */
function fakeFetch(replies: { status?: number; json?: unknown; text?: string }[]) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    const status = reply.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => reply.json,
      text: async () => reply.text ?? JSON.stringify(reply.json ?? {}),
    };
  };
  return { calls, fetchImpl };
}

const completion = (content: string, finish = "stop") => ({
  choices: [{ message: { content }, finish_reason: finish }],
  usage: { prompt_tokens: 900, completion_tokens: 80 },
});

describe("OpenAICompatProvider", () => {
  it("is configured by its key alone, with each provider's own endpoint and default model", () => {
    for (const name of ["groq", "cerebras", "openrouter"] as const) {
      const p = new OpenAICompatProvider({ name, apiKey: "" });
      expect(p.health().configured).toBe(false);
      expect(p.modelFor()).toBe(OPENAI_COMPAT_DEFAULTS[name].model);
      expect(new OpenAICompatProvider({ name, apiKey: "k" }).health().configured).toBe(true);
    }
  });

  it("asks for json_schema, sends the key as a bearer token, and returns a contract-valid extraction", async () => {
    const { calls, fetchImpl } = fakeFetch([{ json: completion(JSON.stringify(EXTRACTION)) }]);
    const groq = new OpenAICompatProvider({ name: "groq", apiKey: "gsk_test", fetchImpl });
    const result = await groq.interpret({ utterance: "Karthik owes me the budget by Friday" });

    expect(result.extraction.intents[0]?.objectText).toBe("the budget");
    expect(calls[0]?.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(calls[0]?.headers["authorization"]).toBe("Bearer gsk_test");
    expect((calls[0]?.body["response_format"] as { type: string }).type).toBe("json_schema");
    expect(calls[0]?.body["model"]).toBe("llama-3.3-70b-versatile");
  });

  it("retries once in json_object mode when a model rejects json_schema with a 400", async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 400, text: "response_format json_schema not supported" },
      { json: completion("```json\n" + JSON.stringify(EXTRACTION) + "\n```") },
    ]);
    const p = new OpenAICompatProvider({ name: "openrouter", apiKey: "k", fetchImpl });
    const result = await p.interpret({ utterance: "Karthik owes me the budget by Friday" });

    expect(calls).toHaveLength(2);
    expect((calls[1]?.body["response_format"] as { type: string }).type).toBe("json_object");
    expect(calls[1]?.headers["x-title"]).toBe("OurGlass");
    expect(result.extraction.intents).toHaveLength(1);
  });

  it("rejects output that is not the shared contract, whatever mode produced it", async () => {
    const { fetchImpl } = fakeFetch([{ json: completion(JSON.stringify({ intents: [{ kind: "nonsense" }] })) }]);
    const p = new OpenAICompatProvider({ name: "cerebras", apiKey: "k", fetchImpl });
    await expect(p.interpret({ utterance: "hello" })).rejects.toBeTruthy();
    expect(p.health().lastFailureCategory).not.toBeNull();
  });

  it("maps a quota response to rate_limit, so the router moves on to the next provider", async () => {
    const { fetchImpl } = fakeFetch([{ status: 429, text: "rate limit reached" }]);
    const p = new OpenAICompatProvider({ name: "groq", apiKey: "k", fetchImpl });
    const failure = (await p.interpret({ utterance: "hi" }).catch((e: unknown) => e)) as ProviderError;
    expect(failure.category).toBe("rate_limit");
    expect(failure.provider).toBe("groq");
  });

  it("asks a reasoning model for low effort and leaves room for its hidden tokens", async () => {
    const { calls, fetchImpl } = fakeFetch([{ json: completion(JSON.stringify(EXTRACTION)) }]);
    const p = new OpenAICompatProvider({ name: "cerebras", apiKey: "k", fetchImpl });
    await p.interpret({ utterance: "Karthik owes me the budget by Friday" });
    expect(calls[0]?.body["model"]).toBe("gpt-oss-120b");
    expect(calls[0]?.body["reasoning_effort"]).toBe("low");
    expect(calls[0]?.body["max_tokens"]).toBeGreaterThan(1_200);
  });

  it("respond never throws: a failure becomes the template reply", async () => {
    const { fetchImpl } = fakeFetch([{ status: 503, text: "overloaded" }]);
    const p = new OpenAICompatProvider({ name: "groq", apiKey: "k", fetchImpl });
    const input: RespondInput = { committed: [], questions: [], declined: [] };
    const result = await p.respond(input);
    expect(result.degraded).toBe(true);
    expect(result.trace.fallbackReason).toBe("sdk_error");
  });
});
