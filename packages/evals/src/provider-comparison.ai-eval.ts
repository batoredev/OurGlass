/**
 * `pnpm eval:ai` — every fixture against every CONFIGURED provider.
 *
 * ⚠ PAID. Each configured provider makes one Interpret call per fixture
 * (~97 each). Manual only; never in CI; the owner approves each run.
 *
 * Refuses loudly when nothing is configured, and SKIPS (with a printed reason)
 * any provider that is not — it never reports zeros for a provider it did not
 * call, because a zero reads as "measured and bad".
 */
import { describe, expect, it } from "vitest";
import type { Extraction } from "@ourglass/shared";
import {
  ClaudeProvider,
  GeminiProvider,
  QwenProvider,
  classifyProviderError,
  loadAIConfig,
  type AIProvider,
} from "@ourglass/api/ai";
import { EXTRACTION_FIXTURES } from "./fixtures.js";
import { aggregate, formatTable, scoreFixture, type FixtureScore, type ProviderReport } from "./provider-eval.js";

const config = loadAIConfig(process.env);

const candidates: AIProvider[] = [
  new ClaudeProvider({
    apiKey: config.anthropic.apiKey,
    interpretModel: config.anthropic.interpretModel,
    respondModel: config.anthropic.respondModel,
  }),
  new GeminiProvider({
    apiKey: config.gemini.apiKey,
    interpretModel: config.gemini.interpretModel,
    respondModel: config.gemini.respondModel,
  }),
  ...(config.ollama.baseUrl
    ? [new QwenProvider({ baseUrl: config.ollama.baseUrl, model: config.ollama.model })]
    : []),
];

const configured = candidates.filter((provider) => provider.health().configured);
for (const skipped of candidates.filter((provider) => !provider.health().configured)) {
  console.log(`[eval:ai] skipping ${skipped.name}: not configured`);
}
if (!config.ollama.baseUrl) console.log("[eval:ai] skipping qwen: OLLAMA_BASE_URL not set");

if (configured.length === 0) {
  throw new Error(
    "eval:ai has no configured provider, so it would report nothing measured. " +
      "Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OLLAMA_BASE_URL.",
  );
}

describe("provider comparison (PAID)", () => {
  it(
    "scores every fixture against each configured provider",
    async () => {
      const reports: ProviderReport[] = [];
      for (const provider of configured) {
        const scores: FixtureScore[] = [];
        for (const fixture of EXTRACTION_FIXTURES) {
          const started = performance.now();
          let extraction: Extraction | null = null;
          let category: string | null = null;
          try {
            extraction = (await provider.interpret({ utterance: fixture.utterance })).extraction;
          } catch (error: unknown) {
            category = classifyProviderError(provider.name, error).category;
          }
          scores.push(scoreFixture(fixture, extraction, performance.now() - started, category));
        }
        reports.push(aggregate(provider.name, provider.modelFor("interpret"), scores));
      }
      console.log("\n" + formatTable(reports) + "\n");
      expect(reports.length).toBe(configured.length);
    },
    3_600_000,
  );
});
