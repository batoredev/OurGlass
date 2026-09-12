/**
 * THE TEST THAT WOULD HAVE CAUGHT F6.
 *
 * `complete_commitment` and `update_commitment` were written, typechecked,
 * unit-tested, and left OUT of `buildToolRegistry`. Nothing failed: the
 * modules compile, their own unit tests import them directly, and the only
 * test that touches the registry (create-commitment.integration.test.ts)
 * exercises a Phase 1 tool. The orchestrator emits `complete_commitment` for
 * this phase's demo sentence, so the first symptom would have been a runtime
 * "unknown tool" on the one utterance Phase 3 exists to support.
 *
 * That is the fifth instance of the class `docs/DECISIONS.md` records as
 * "schema with no code path" — here in its tool-layer form. The recorded rule
 * is: verify a prerequisite by finding the CODE PATH, not the object. This
 * file makes that verification automatic.
 *
 * It reads the orchestrator's SOURCE rather than importing it, deliberately.
 * Calling `runTurn` to discover which tools it emits would need a database,
 * an extractor, and one utterance per branch — and it would only cover the
 * branches the fixtures happen to reach. A source scan covers every literal
 * unconditionally, which is exactly the property that was missing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildToolRegistry } from "./index.js";

const ORCHESTRATOR = fileURLToPath(
  new URL("../assistant/orchestrator.ts", import.meta.url),
);

/** Every `name: "..."` inside a ToolCall literal in the orchestrator. */
function toolNamesEmittedByOrchestrator(): string[] {
  const source = readFileSync(ORCHESTRATOR, "utf8");
  const names = new Set<string>();
  for (const match of source.matchAll(/\bname:\s*"([a-z_]+)"/g)) {
    names.add(match[1]!);
  }
  return [...names].sort();
}

describe("tool registry coverage", () => {
  it("registers every tool the orchestrator can emit", () => {
    const registry = buildToolRegistry();
    const emitted = toolNamesEmittedByOrchestrator();

    // Guard the guard: if the regex ever stops matching (a refactor to a
    // helper, say), an empty list would make this test vacuously pass — the
    // hollow-test failure mode this repo has already hit once in the eval
    // harness. Assert it found something real first.
    expect(emitted.length).toBeGreaterThanOrEqual(3);

    const missing = emitted.filter((name) => !registry.has(name));
    expect(missing).toEqual([]);
  });

  it("registers the two Phase 3 commitment tools by name", () => {
    // Explicit, in addition to the scan above: the scan protects against
    // FUTURE additions, this states the F1/F6 fix as a fact so a revert is a
    // named failure rather than a silently shrinking list.
    const registry = buildToolRegistry();
    expect(registry.has("complete_commitment")).toBe(true);
    expect(registry.has("update_commitment")).toBe(true);
  });

  it("every registered tool has a distinct name and a handler", () => {
    const tools = buildToolRegistry().list();
    const names = tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of tools) {
      expect(typeof tool.validate).toBe("function");
      expect(typeof tool.commit).toBe("function");
    }
  });
});
