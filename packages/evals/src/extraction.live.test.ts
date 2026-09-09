import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import {
  EXTRACTION_INPUT_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_TOOL_NAME,
  isExtraction,
} from "@ourglass/shared";
import { EXTRACTION_FIXTURES } from "./fixtures.js";
import { matchesExpected } from "./match.js";

const apiKey = process.env["ANTHROPIC_API_KEY"];
const extractionTool: Tool = {
  name: EXTRACTION_TOOL_NAME,
  strict: true,
  input_schema: EXTRACTION_INPUT_SCHEMA as unknown as Tool["input_schema"],
};

describe.skipIf(!apiKey)("Phase 2 live extraction evals", () => {
  it("meets the recorded intent-kind and inference-level labels", async () => {
    const client = new Anthropic({ apiKey: apiKey! });
    const failures: string[] = [];
    for (const fixture of EXTRACTION_FIXTURES) {
      const response = await client.messages.create({
        model: "claude-sonnet-5",
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
