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

  /**
   * THE INVERSE ASSERTION, and the one the Phase 5 audit needed.
   *
   * The scan above proves every tool the orchestrator EMITS is registered. It
   * says nothing about the other direction, and that is where the real gap
   * was: 13 tools registered, 4 reachable from a conversation. Nine objects
   * that existed, compiled, passed their own unit tests, and could not be
   * invoked by talking to the assistant -- the "schema with no code path"
   * class again, one layer up.
   *
   * So every registered tool must be emitted by a planner branch OR appear in
   * the list below WITH A REASON. Adding a tool and forgetting to wire it now
   * fails here instead of being discovered by a user.
   */
  const NOT_REACHABLE_FROM_A_CONVERSATION: Readonly<Record<string, string>> = {
    // Driven by the cron poller, by design: a reminder fires because time
    // passed, not because anyone said anything (PHASE-3-DESIGN 6).
    fire_reminder: "poller-only",
    evaluate_workflow: "poller-only",
    // DECLARED GAP, not an oversight. correct_relationship takes a typed edge
    // (oldRelationshipId, subjectId, relType, objectKind, objectId) and the
    // extraction contract carries one entity mention and two text blobs -- in
    // "Karthik handles backend now, not Arun", "backend" is not a person,
    // organization, or project row. Conversational corrections therefore route
    // through the MEMORY tools (forget_memory + remember), which preserve the
    // same invalidate-never-delete property. Reaching this tool needs a
    // relationship-edge hint in the contract, not a planner branch.
    correct_relationship: "needs a typed relationship edge the contract cannot express",
  };

  it("leaves no tool registered but unreachable, unless the reason is stated", () => {
    const registered = buildToolRegistry().list().map((tool) => tool.name);
    const emitted = new Set(toolNamesEmittedByOrchestrator());

    const unreachable = registered.filter(
      (name) => !emitted.has(name) && NOT_REACHABLE_FROM_A_CONVERSATION[name] === undefined,
    );
    expect(unreachable).toEqual([]);
  });

  it("keeps the exemption list honest — every exemption is a REGISTERED tool", () => {
    // A stale exemption is worse than none: it would silence this test for a
    // tool that no longer exists while looking like coverage.
    const registered = new Set(buildToolRegistry().list().map((tool) => tool.name));
    for (const name of Object.keys(NOT_REACHABLE_FROM_A_CONVERSATION)) {
      expect(registered.has(name), `${name} is exempted but not registered`).toBe(true);
    }
  });

  it("emits the six tools the planner wiring made reachable", () => {
    // Stated as a fact, like the F1/F6 assertion above, so a revert is a named
    // failure rather than a silently shrinking list.
    const emitted = new Set(toolNamesEmittedByOrchestrator());
    for (const name of [
      "update_commitment",
      "remember",
      "forget_memory",
      "create_workflow",
      "define_entity_type",
      "create_entity_record",
    ]) {
      expect(emitted, `${name} is registered but no planner branch emits it`).toContain(name);
    }
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
