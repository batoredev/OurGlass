import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import {
  EXTRACTION_INPUT_SCHEMA,
  EXTRACTION_MODEL,
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_TOOL_NAME,
  isExtraction,
} from "@ourglass/shared";
import { EXTRACTION_FIXTURES } from "./fixtures.js";
import { matchesExpected } from "./match.js";

const apiKey = process.env["ANTHROPIC_API_KEY"];

// A skipped suite and a passing suite are indistinguishable in a CI summary line.
// This lane is the ONLY thing that measures extraction quality against the real
// model, and DECISIONS.md open question 2 makes it the safeguard that replaced
// Opus's ask-tendency — so a silent skip here is a silent loss of the safeguard.
//
// Third instance of this defect class in this repo (packages/db's suite and the
// CI job-isolation bug were the first two), which is why it fails loudly rather
// than politely: `pnpm test:live` without a key is always a mistake, and under CI
// it is a configuration error, not a local convenience.
if (!apiKey) {
  const where = process.env["CI"] ? "in CI" : "locally";
  throw new Error(
    `ANTHROPIC_API_KEY is unset ${where}, so the live extraction evals would have ` +
      "reported green having made ZERO model calls. This lane is the only measurement " +
      "of extraction quality against the real model (docs/DECISIONS.md open question 2). " +
      "Set the key in .env (gitignored) or as a GitHub Actions secret. If you meant the " +
      "free lane, run `pnpm --filter @ourglass/evals test` instead.",
  );
}
const extractionTool: Tool = {
  name: EXTRACTION_TOOL_NAME,
  strict: true,
  input_schema: EXTRACTION_INPUT_SCHEMA as unknown as Tool["input_schema"],
};

describe("Phase 2 live extraction evals", () => {
  it("meets the recorded intent-kind and inference-level labels", async () => {
    const client = new Anthropic({ apiKey: apiKey! });
    const failures: string[] = [];
    for (const fixture of EXTRACTION_FIXTURES) {
      const response = await client.messages.create({
        // Imported, never a literal: this pin drifted twice in one session when the
        // API and the eval lane each held their own copy. Eval numbers are
        // unattributable if the two lanes measure different models.
        model: EXTRACTION_MODEL,
        max_tokens: 1_200,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: fixture.utterance }],
        tools: [extractionTool],
        tool_choice: { type: "tool", name: EXTRACTION_TOOL_NAME, disable_parallel_tool_use: true },
      });
      const block = response.content.find(
        (content): content is Anthropic.ToolUseBlock => content.type === "tool_use" && content.name === EXTRACTION_TOOL_NAME,
      );
      if (!block || !isExtraction(block.input) || !matchesExpected(block.input, fixture.expected)) failures.push(fixture.id);
    }
    expect(failures).toEqual([]);
  }, 300_000);
});
