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
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Extraction } from "@ourglass/shared";
import { buildProvider, classifyProviderError, loadAIConfig, type AIProvider } from "@ourglass/api/ai";
import { EXTRACTION_FIXTURES } from "./fixtures.js";
import { aggregate, formatTable, scoreFixture, type FixtureScore, type ProviderReport } from "./provider-eval.js";

const config = loadAIConfig(process.env);

// THE APP'S OWN FACTORY, not hand-built providers. This file used to call the
// constructors itself and dropped the timeouts, so Qwen ran on the adapter's
// 20s default instead of AI_REQUEST_TIMEOUT_MS — a local model answering in
// 18-60s would have scored as mostly "timeout". Measuring a configuration the
// app never runs is measuring nothing.
const candidates: AIProvider[] = [
  buildProvider("claude", config),
  buildProvider("gemini", config),
  buildProvider("groq", config),
  buildProvider("cerebras", config),
  buildProvider("openrouter", config),
  // Opt-in, exactly as in the app: Ollama has no key, so a base URL is the signal.
  ...(config.ollama.baseUrl ? [buildProvider("qwen", config)] : []),
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

/**
 * Optional subset: `EVAL_FIXTURES=id,id,...`. A full local run is ~50 minutes,
 * so iterating on a prompt against the fixtures that failed — plus a guard set
 * that passed — is what makes measuring each change affordable. The headline
 * number still comes from a full run.
 */
const ONLY = (process.env["EVAL_FIXTURES"] ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const FIXTURES = ONLY.length > 0 ? EXTRACTION_FIXTURES.filter((f) => ONLY.includes(f.id)) : EXTRACTION_FIXTURES;
if (ONLY.length > 0 && FIXTURES.length !== ONLY.length) {
  const known = new Set(FIXTURES.map((f) => f.id));
  throw new Error(`EVAL_FIXTURES names unknown fixtures: ${ONLY.filter((id) => !known.has(id)).join(", ")}`);
}

/**
 * Long enough for every fixture to use its full per-request budget. A fixed
 * hour was too short for a local model: 101 fixtures at ~35s is ~59 minutes,
 * and the run would have died a fixture or two from the end.
 */
const EVAL_TIMEOUT_MS =
  FIXTURES.length * (config.timeoutMs + 5_000 + Math.max(0, Number(process.env["EVAL_PACE_MS"] ?? 0) || 0)) *
  Math.max(1, configured.length);

/** Optional per-fixture dump — the aggregate table says how many, not which. */
const REPORT_PATH = process.env["EVAL_REPORT_PATH"];

/**
 * Optional pause between fixtures, in ms. A free tier's per-MINUTE cap is
 * the binding limit, not the daily one: the first Gemini free-tier run
 * (2026-10-19) sent fixtures back to back, got ~9 answers, and 90 were
 * refused as rate_limit — a run that measured the quota, not the model.
 * `EVAL_PACE_MS=7000` keeps a ~10 requests/minute tier under its cap.
 */
const PACE_MS = Math.max(0, Number(process.env["EVAL_PACE_MS"] ?? 0) || 0);

describe("provider comparison (PAID)", () => {
  it(
    "scores every fixture against each configured provider",
    async () => {
      const reports: ProviderReport[] = [];
      const detail: unknown[] = [];
      for (const provider of configured) {
        const scores: FixtureScore[] = [];
        for (const fixture of FIXTURES) {
          if (PACE_MS > 0 && scores.length > 0) await new Promise((resolve) => setTimeout(resolve, PACE_MS));
          const started = performance.now();
          let extraction: Extraction | null = null;
          let category: string | null = null;
          try {
            extraction = (await provider.interpret({ utterance: fixture.utterance })).extraction;
          } catch (error: unknown) {
            category = classifyProviderError(provider.name, error).category;
          }
          const score = scoreFixture(fixture, extraction, performance.now() - started, category);
          scores.push(score);
          detail.push({ provider: provider.name, utterance: fixture.utterance, score, extraction });
          // AFTER EVERY FIXTURE, not once at the end. A local run is ~50
          // minutes; the first full one was cut off by the laptop sleeping
          // partway, the test timeout fired on wake, and a report written only
          // on success kept nothing that had been measured. The progress line
          // is what says where a stalled run stopped.
          if (REPORT_PATH) writeFileSync(REPORT_PATH, JSON.stringify(detail, null, 1));
          console.log(
            `[eval:ai] ${provider.name} ${scores.length}/${FIXTURES.length} ${fixture.id} ` +
              `${score.matched === null ? `error:${score.errorCategory}` : score.matched ? "match" : "miss"} ` +
              `${Math.round(score.latencyMs / 1000)}s`,
          );
        }
        reports.push(aggregate(provider.name, provider.modelFor("interpret"), scores));
      }
      console.log("\n" + formatTable(reports) + "\n");
      expect(reports.length).toBe(configured.length);
    },
    EVAL_TIMEOUT_MS,
  );
});
