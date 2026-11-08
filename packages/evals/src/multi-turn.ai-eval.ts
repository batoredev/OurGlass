/**
 * `pnpm eval:ai` — the multi-turn set (ROADMAP Stage 1a) against every
 * CONFIGURED provider, exactly as the app sends it with
 * AI_CONVERSATION_CONTEXT=on: the earlier turns rendered as quoted context,
 * then intents not quoting the current message dropped.
 *
 * ⚠ PAID. One Interpret call per fixture per configured provider (8 each).
 * Manual only; never in CI; the owner approves each run. Run alone with
 * `pnpm --filter @ourglass/evals exec vitest run --config vitest.ai.config.ts src/multi-turn.ai-eval.ts`.
 *
 * Reports two numbers per provider: STRICT (the labelled extraction,
 * matched as the single-turn set is) and SAFE (no intent from an earlier
 * turn survived grounding, and the safety cases produced exactly their
 * labelled intents). Stage 1a is switched on only when SAFE is 100%.
 */
import { describe, expect, it } from "vitest";
import { buildProvider, classifyProviderError, loadAIConfig, type AIProvider } from "@ourglass/api/ai";
import { groundInUtterance, renderConversation } from "@ourglass/api/assistant";
import { matchesExpected } from "./match.js";
import { MULTI_TURN_FIXTURES } from "./multi-turn.fixtures.js";

const config = loadAIConfig(process.env);
const candidates: AIProvider[] = [
  buildProvider("claude", config),
  buildProvider("gemini", config),
  buildProvider("groq", config),
  buildProvider("cerebras", config),
  buildProvider("openrouter", config),
  ...(config.ollama.baseUrl ? [buildProvider("qwen", config)] : []),
];
const configured = candidates.filter((provider) => provider.health().configured);
if (configured.length === 0) {
  throw new Error("The multi-turn eval has no configured provider, so it would report nothing measured.");
}

describe("multi-turn conversation context (PAID)", () => {
  it(
    "scores every multi-turn fixture against each configured provider",
    async () => {
      const lines: string[] = [];
      for (const provider of configured) {
        let strict = 0;
        let safe = 0;
        let errors = 0;
        for (const fixture of MULTI_TURN_FIXTURES) {
          const now = new Date();
          const context = renderConversation(
            fixture.previous.map((message, index) => ({ id: `p${index}`, ...message, trace: null, t_created: now })),
            "current",
            now,
          );
          try {
            const raw = await provider.interpret(
              context === undefined ? { utterance: fixture.utterance } : { utterance: fixture.utterance, context },
            );
            const grounded = groundInUtterance(raw, fixture.utterance);
            const matched = matchesExpected(grounded.result.extraction, fixture.expected);
            const isSafe =
              grounded.dropped === 0 &&
              (!fixture.safety || grounded.result.extraction.intents.length === fixture.expected.intents.length);
            if (matched) strict += 1;
            if (isSafe) safe += 1;
            console.log(`[eval:multi-turn] ${provider.name} ${fixture.id} ${matched ? "match" : "miss"} ${isSafe ? "safe" : "UNSAFE"} dropped=${grounded.dropped}`);
          } catch (error: unknown) {
            errors += 1;
            console.log(`[eval:multi-turn] ${provider.name} ${fixture.id} error:${classifyProviderError(provider.name, error).category}`);
          }
        }
        const n = MULTI_TURN_FIXTURES.length;
        lines.push(`${provider.name} (${provider.modelFor("interpret")}): strict ${strict}/${n}, safe ${safe}/${n}, errors ${errors}`);
      }
      console.log(`\n${lines.join("\n")}\n`);
      expect(lines).toHaveLength(configured.length);
    },
    MULTI_TURN_FIXTURES.length * (config.timeoutMs + 5_000) * Math.max(1, configured.length),
  );
});
