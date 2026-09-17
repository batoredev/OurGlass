/**
 * Configuration parsing — defaults, degradation, and the secret boundary.
 *
 * Env is INJECTED, never read from process.env: a test that mutates the real
 * environment leaks into every other test in the file.
 */
import { describe, expect, it } from "vitest";
import {
  NoProviderConfiguredError,
  buildAIRouter,
  describeProviders,
  loadAIConfig,
  parseOrder,
} from "./config.js";

const KEY = "test-key-not-a-real-one";

describe("provider order", () => {
  it("defaults to Claude then Gemini, WITHOUT Qwen", () => {
    // Qwen is configured by a base URL alone and the base URL has a default,
    // so including it unconditionally would put it in every chain — and a
    // deployment with no Ollama would pay a connection timeout on every
    // fallback before failing.
    expect(loadAIConfig({}).order).toEqual(["claude", "gemini"]);
  });

  it("includes Qwen once OLLAMA_BASE_URL is set explicitly", () => {
    expect(loadAIConfig({ OLLAMA_BASE_URL: "http://localhost:11434" }).order).toEqual([
      "claude",
      "gemini",
      "qwen",
    ]);
  });

  it("honours an explicit order, including one naming qwen with no base URL", () => {
    // An operator who asks for it by name gets it.
    expect(loadAIConfig({ AI_PROVIDER_ORDER: "qwen,claude" }).order).toEqual(["qwen", "claude"]);
  });

  it("DROPS an unrecognised name rather than throwing", () => {
    // A typo should degrade to the providers that are recognised, not take
    // the process down at startup.
    expect(parseOrder("claude,mistral,gemini", ["claude"])).toEqual(["claude", "gemini"]);
  });

  it("de-duplicates, because trying one provider twice is what retries are for", () => {
    expect(parseOrder("claude,claude,gemini", ["claude"])).toEqual(["claude", "gemini"]);
  });

  it("falls back to the default when the value parses to nothing", () => {
    expect(parseOrder("nonsense,garbage", ["claude", "gemini"])).toEqual(["claude", "gemini"]);
    expect(parseOrder("", ["claude"])).toEqual(["claude"]);
    expect(parseOrder(undefined, ["claude"])).toEqual(["claude"]);
  });

  it("supports per-stage overrides (§29)", () => {
    const config = loadAIConfig({
      AI_INTERPRET_ORDER: "claude,gemini",
      AI_RESPOND_ORDER: "qwen",
    });
    expect(config.stageOrder.interpret).toEqual(["claude", "gemini"]);
    expect(config.stageOrder.respond).toEqual(["qwen"]);
  });

  it("leaves stageOrder empty when no override is given", () => {
    expect(loadAIConfig({}).stageOrder).toEqual({});
  });
});

describe("numeric and boolean settings reject nonsense instead of applying it", () => {
  it("uses defaults for absent values", () => {
    const config = loadAIConfig({});
    expect(config.timeoutMs).toBe(20_000);
    expect(config.maxRetries).toBe(1);
    expect(config.enableFallback).toBe(true);
  });

  it("IGNORES an out-of-range or unparseable number", () => {
    // A typo must not silently become a 0ms timeout — that changes behaviour
    // drastically while still looking like configuration.
    expect(loadAIConfig({ AI_REQUEST_TIMEOUT_MS: "0" }).timeoutMs).toBe(20_000);
    expect(loadAIConfig({ AI_REQUEST_TIMEOUT_MS: "abc" }).timeoutMs).toBe(20_000);
    expect(loadAIConfig({ AI_REQUEST_TIMEOUT_MS: "999999999" }).timeoutMs).toBe(20_000);
    expect(loadAIConfig({ AI_MAX_RETRIES: "-1" }).maxRetries).toBe(1);
    expect(loadAIConfig({ AI_MAX_RETRIES: "99" }).maxRetries).toBe(1);
  });

  it("accepts values inside the bounds", () => {
    expect(loadAIConfig({ AI_REQUEST_TIMEOUT_MS: "5000" }).timeoutMs).toBe(5_000);
    expect(loadAIConfig({ AI_MAX_RETRIES: "0" }).maxRetries).toBe(0);
  });

  it("treats only the literal 'false' as disabling fallback", () => {
    expect(loadAIConfig({ AI_ENABLE_FALLBACK: "false" }).enableFallback).toBe(false);
    expect(loadAIConfig({ AI_ENABLE_FALLBACK: "FALSE" }).enableFallback).toBe(false);
    expect(loadAIConfig({ AI_ENABLE_FALLBACK: "true" }).enableFallback).toBe(true);
    expect(loadAIConfig({ AI_ENABLE_FALLBACK: "yes" }).enableFallback).toBe(true);
  });
});

describe("buildAIRouter", () => {
  it("builds with only an Anthropic key — one provider is a valid deployment", () => {
    const router = buildAIRouter({ ANTHROPIC_API_KEY: KEY });
    const health = router.health();

    expect(health.map((h) => h.provider)).toEqual(["claude", "gemini"]);
    expect(health[0]?.configured).toBe(true);
    // Present in the list but skipped by the router — an unset key is a
    // choice, not an error.
    expect(health[1]?.configured).toBe(false);
  });

  it("builds with only a Gemini key", () => {
    const health = buildAIRouter({ GEMINI_API_KEY: KEY }).health();
    expect(health.find((h) => h.provider === "gemini")?.configured).toBe(true);
  });

  it("builds with only Ollama", () => {
    const health = buildAIRouter({ OLLAMA_BASE_URL: "http://localhost:11434" }).health();
    expect(health.find((h) => h.provider === "qwen")?.configured).toBe(true);
  });

  it("THROWS a named error when nothing is configured", () => {
    // Named at the boundary. The alternative is a generic 500 after the user
    // has already typed a sentence.
    expect(() => buildAIRouter({})).toThrow(NoProviderConfiguredError);
    expect(() => buildAIRouter({})).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("does not throw merely because one provider in the order is unconfigured", () => {
    expect(() =>
      buildAIRouter({ AI_PROVIDER_ORDER: "gemini,claude", ANTHROPIC_API_KEY: KEY }),
    ).not.toThrow();
  });
});

describe("describeProviders never leaks a secret", () => {
  it("reports names and flags only", () => {
    const described = describeProviders({
      ANTHROPIC_API_KEY: "sk-ant-super-secret-value",
      GEMINI_API_KEY: "AIza-super-secret-value",
    });

    expect(described).toEqual([
      { provider: "claude", configured: true },
      { provider: "gemini", configured: true },
    ]);

    // Asserted, not merely intended: this shape is destined for /api/health,
    // which is the one route reachable without the demo flag.
    const serialised = JSON.stringify(described);
    expect(serialised).not.toContain("sk-ant");
    expect(serialised).not.toContain("AIza");
    expect(serialised).not.toContain("secret");
  });
});

describe("model overrides", () => {
  it("passes per-provider model names through", () => {
    const config = loadAIConfig({
      ANTHROPIC_INTERPRET_MODEL: "claude-sonnet-5",
      ANTHROPIC_RESPONSE_MODEL: "claude-haiku-4-5-20251001",
      GEMINI_INTERPRET_MODEL: "gemini-custom",
      OLLAMA_MODEL: "qwen3:4b",
    });

    expect(config.anthropic.interpretModel).toBe("claude-sonnet-5");
    expect(config.anthropic.respondModel).toBe("claude-haiku-4-5-20251001");
    expect(config.gemini.interpretModel).toBe("gemini-custom");
    expect(config.ollama.model).toBe("qwen3:4b");
  });

  it("treats a blank override as absent, not as an empty model name", () => {
    expect(
      loadAIConfig({ ANTHROPIC_INTERPRET_MODEL: "   " }).anthropic.interpretModel,
    ).toBeUndefined();
  });
});
