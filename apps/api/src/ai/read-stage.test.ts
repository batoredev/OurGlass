/**
 * The Read stage (docs/PHASE-6-DESIGN.md §4) across all three providers and
 * the router. Every provider is faked at its transport, so these pin the
 * REQUEST each one sends and what it accepts back.
 */
import type { AIRequestLog, DocumentReading } from "@ourglass/shared";
import { describe, expect, it } from "vitest";
import { ClaudeProvider } from "./claude.js";
import { ProviderError } from "./errors.js";
import { GeminiProvider, type GeminiLikeClient } from "./gemini.js";
import type { AIProvider, ReadInput, ReadResult } from "./provider.js";
import { QWEN_READ_NUM_CTX, QwenProvider } from "./qwen.js";
import { READ_SYSTEM_PROMPT } from "./read-prompt.js";
import { AIModelRouter, AllProvidersFailedError } from "./router.js";

const READING: DocumentReading = {
  title: "Hult poster brief",
  summary: "Brief for the Hult poster.",
  people: ["Barkha"],
  organizations: ["Hult"],
  projects: [],
  events: [],
  deadlines: [{ what: "Final poster", when: "Fri 17 Oct, 6 pm" }],
};

const TEXT_BODY = "Hult poster brief. Final poster due Fri 17 Oct, 6 pm.";
const TEXT: ReadInput = { kind: "text", text: TEXT_BODY };
const IMAGE: ReadInput = { kind: "image", mediaType: "image/png", base64: "iVBORw0KGgo=" };

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

function claudeWith(response: Record<string, unknown>) {
  const requests: Record<string, unknown>[] = [];
  const provider = new ClaudeProvider({
    apiKey: "test",
    readClient: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          requests.push(params);
          return response;
        },
      },
    } as never,
  });
  return { provider, requests };
}

function claudeToolResponse(input: unknown, stop = "tool_use") {
  return {
    model: "claude-test",
    stop_reason: stop,
    usage: { input_tokens: 812, output_tokens: 96 },
    content: [{ type: "tool_use", name: "record_reading", id: "t1", input }],
  };
}

describe("ClaudeProvider.read", () => {
  it("sends the text fenced, with the read prompt and a forced reading tool", async () => {
    const { provider, requests } = claudeWith(claudeToolResponse(READING));
    const result = await provider.read(TEXT);

    expect(result.reading).toEqual(READING);
    expect(result.trace).toMatchObject({ model: "claude-test", inputTokens: 812, outputTokens: 96 });
    const request = requests[0]!;
    expect(request["system"]).toBe(READ_SYSTEM_PROMPT);
    expect(request["tool_choice"]).toMatchObject({ type: "tool", name: "record_reading" });
    const content = (request["messages"] as { content: string }[])[0]!.content;
    expect(content).toContain(TEXT_BODY);
    // A per-call marker: named once in the preamble, then the two fence lines.
    const marker = /^The file's text is between the two (FILE-[0-9A-F]{8}) lines/.exec(content)?.[1];
    expect(marker).toBeDefined();
    expect(content.split(marker!).length - 1).toBe(3);
  });

  it("sends an image as a base64 image block", async () => {
    const { provider, requests } = claudeWith(claudeToolResponse(READING));
    await provider.read(IMAGE);
    const content = (requests[0]!["messages"] as { content: unknown[] }[])[0]!.content;
    expect(content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
    });
  });

  it("drops an action-shaped key the model (or a file steering it) added", async () => {
    const { provider } = claudeWith(claudeToolResponse({ ...READING, action: "delete_all", tool: "complete_commitment" }));
    const { reading } = await provider.read(TEXT);
    expect(Object.keys(reading)).not.toContain("action");
    expect(Object.keys(reading)).not.toContain("tool");
  });

  it("checks the stop reason BEFORE the payload: a truncated reading is a failure", async () => {
    const { provider } = claudeWith(claudeToolResponse(READING, "max_tokens"));
    await expect(provider.read(TEXT)).rejects.toMatchObject({ category: "truncated" });
  });

  it("rejects a reading of the wrong shape as schema_invalid (retry/fallback, not store)", async () => {
    const { provider } = claudeWith(claudeToolResponse({ title: 3 }));
    await expect(provider.read(TEXT)).rejects.toMatchObject({ category: "schema_invalid" });
  });

  it("reads with the Interpret model, not the Respond one", () => {
    const provider = new ClaudeProvider({ apiKey: "k", interpretModel: "sonnet-x", respondModel: "haiku-y" });
    expect(provider.modelFor("read")).toBe("sonnet-x");
  });
});

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

function geminiWith(text: string, finishReason = "STOP") {
  const requests: Record<string, unknown>[] = [];
  const client: GeminiLikeClient = {
    models: {
      generateContent: async (params) => {
        requests.push(params as unknown as Record<string, unknown>);
        return { text, candidates: [{ finishReason }], usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 80 } };
      },
    },
  };
  return { provider: new GeminiProvider({ apiKey: "k", client }), requests };
}

describe("GeminiProvider.read", () => {
  it("constrains JSON with the reading schema and sends an image as inlineData", async () => {
    const { provider, requests } = geminiWith(JSON.stringify(READING));
    const result = await provider.read(IMAGE);
    expect(result.reading).toEqual(READING);
    const request = requests[0]!;
    expect((request["config"] as Record<string, unknown>)["responseMimeType"]).toBe("application/json");
    const parts = (request["contents"] as { parts: unknown[] }[])[0]!.parts;
    expect(parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } });
  });

  it("maps a safety stop to refused, and non-JSON to malformed_output", async () => {
    await expect(geminiWith("{}", "SAFETY").provider.read(TEXT)).rejects.toMatchObject({ category: "refused" });
    await expect(geminiWith("not json").provider.read(TEXT)).rejects.toMatchObject({ category: "malformed_output" });
  });
});

// ---------------------------------------------------------------------------
// Qwen
// ---------------------------------------------------------------------------

describe("QwenProvider.read", () => {
  it("sets the context window explicitly — Ollama's default truncates a document silently", async () => {
    const bodies: Record<string, unknown>[] = [];
    const provider = new QwenProvider({
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String((init as RequestInit).body)));
        return new Response(JSON.stringify({ message: { content: JSON.stringify(READING) }, done_reason: "stop" }));
      },
    });
    const result = await provider.read(TEXT);
    expect(result.reading).toEqual(READING);
    expect(bodies[0]).toMatchObject({ options: { num_ctx: QWEN_READ_NUM_CTX } });
    const user = (bodies[0]!["messages"] as { content: string }[])[1]!.content;
    expect(user).toContain(TEXT_BODY);
    expect(user).toMatch(/FILE-[0-9A-F]{8}/);
  });

  it("does not read images", () => {
    expect(new QwenProvider().readsImages).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Every real provider implements the capability
// ---------------------------------------------------------------------------

describe("provider capabilities", () => {
  it("all three real providers implement read; only claude and gemini read images", () => {
    const providers: AIProvider[] = [
      new ClaudeProvider({ apiKey: "k" }),
      new GeminiProvider({ apiKey: "k" }),
      new QwenProvider(),
    ];
    expect(providers.map((provider) => typeof provider.read)).toEqual(["function", "function", "function"]);
    expect(providers.map((provider) => provider.readsImages === true)).toEqual([true, true, false]);
  });
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function reader(
  name: "claude" | "gemini" | "qwen",
  behaviour: () => Promise<ReadResult>,
  readsImages = true,
): { provider: AIProvider; calls: ReadInput[] } {
  const calls: ReadInput[] = [];
  return {
    calls,
    provider: {
      name,
      readsImages,
      modelFor: () => `${name}-model`,
      interpret: async () => {
        throw new Error("unused");
      },
      respond: async () => {
        throw new Error("unused");
      },
      read: async (input) => {
        calls.push(input);
        return behaviour();
      },
      health: () => ({ provider: name, configured: true, lastFailureAt: null, lastFailureCategory: null }),
    },
  };
}

const OK_READ = async (): Promise<ReadResult> => ({
  reading: READING,
  trace: { model: "m", latencyMs: 1, stopReason: null, inputTokens: 1, outputTokens: 1 },
});

describe("AIModelRouter.read", () => {
  it("skips a text-only provider for an image instead of failing on it", async () => {
    const qwen = reader("qwen", OK_READ, false);
    const claude = reader("claude", OK_READ);
    const router = new AIModelRouter({ providers: [qwen.provider, claude.provider] });
    const result = await router.read(IMAGE);
    expect(result.provider).toBe("claude");
    expect(qwen.calls).toHaveLength(0);
  });

  it("does NOT swallow an image with fallback disabled when the first provider is text-only", async () => {
    const qwen = reader("qwen", OK_READ, false);
    const gemini = reader("gemini", OK_READ);
    const router = new AIModelRouter({ providers: [qwen.provider, gemini.provider], enableFallback: false });
    expect((await router.read(IMAGE)).provider).toBe("gemini");
  });

  it("falls back on an outage and logs stage 'read' with no content in the log", async () => {
    const logs: AIRequestLog[] = [];
    const down = reader("claude", async () => {
      throw new ProviderError("claude", "unavailable", "503");
    });
    const up = reader("gemini", OK_READ);
    const router = new AIModelRouter({
      providers: [down.provider, up.provider],
      onLog: (record) => logs.push(record),
      sleep: async () => undefined,
    });
    const result = await router.read(TEXT);
    expect(result).toMatchObject({ provider: "gemini", fallbackUsed: true });
    expect(logs.map((log) => `${log.stage}:${log.provider}:${log.ok}`)).toEqual(["read:claude:false", "read:gemini:true"]);
    expect(JSON.stringify(logs)).not.toContain("Hult");
  });

  it("stops at a refusal — the same file is refused everywhere", async () => {
    const refusing = reader("claude", async () => {
      throw new ProviderError("claude", "refused", "no");
    });
    const next = reader("gemini", OK_READ);
    const router = new AIModelRouter({ providers: [refusing.provider, next.provider] });
    await expect(router.read(TEXT)).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(next.calls).toHaveLength(0);
  });

  it("uses Interpret's order when no read order is set", async () => {
    const claude = reader("claude", OK_READ);
    const gemini = reader("gemini", OK_READ);
    const router = new AIModelRouter({
      providers: [claude.provider, gemini.provider],
      stageOrder: { interpret: ["gemini", "claude"] },
    });
    expect((await router.read(TEXT)).provider).toBe("gemini");
  });

  it("with nothing able to read, fails with the stage named", async () => {
    const qwen = reader("qwen", OK_READ, false);
    const router = new AIModelRouter({ providers: [qwen.provider] });
    await expect(router.read(IMAGE)).rejects.toMatchObject({ stage: "read" });
  });
});
