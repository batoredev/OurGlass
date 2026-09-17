/**
 * The risk policy, and the two properties that make it a policy at all:
 * it covers every tool, and it fails closed on anything it does not know.
 */
import { describe, expect, it } from "vitest";
import { CONFIRMATION_FLOOR, RISK_LEVELS, atOrAbove, riskRank } from "@ourglass/shared";
import { buildToolRegistry } from "./index.js";
import {
  RISK_BY_TOOL,
  UnclassifiedToolError,
  assertRiskTableCovers,
  highestRisk,
  riskFor,
} from "./risk.js";

describe("the table covers the live registry", () => {
  it("classifies EVERY registered tool", () => {
    // Derived from the registry, never a hardcoded count: adding a tool
    // without classifying it fails HERE rather than defaulting to something.
    // A default would be too permissive (an unclassified external action
    // commits) or too strict (every new tool blocked until someone noticed).
    expect(assertRiskTableCovers(buildToolRegistry())).toEqual([]);
  });

  it("classifies nothing that is not registered", () => {
    // A stale entry is not harmless: it reads as coverage for a tool that no
    // longer exists, and hides the absence of one that does.
    const registered = new Set(buildToolRegistry().list().map((tool) => tool.name));
    const stale = Object.keys(RISK_BY_TOOL).filter((name) => !registered.has(name));
    expect(stale).toEqual([]);
  });

  it("uses only declared levels", () => {
    for (const [name, level] of Object.entries(RISK_BY_TOOL)) {
      expect(RISK_LEVELS, name).toContain(level);
    }
  });
});

describe("riskFor FAILS CLOSED", () => {
  it("throws on an unclassified tool rather than assuming the lowest level", () => {
    // "I do not know how dangerous this is" must refuse, not commit.
    expect(() => riskFor("some_future_tool")).toThrow(UnclassifiedToolError);
    expect(() => riskFor("some_future_tool")).toThrow(/RISK_BY_TOOL/);
  });

  it("names the tool, so the fix is obvious from the message", () => {
    try {
      riskFor("send_telegram");
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      expect((error as UnclassifiedToolError).toolName).toBe("send_telegram");
    }
  });
});

describe("severity ordering", () => {
  it("ranks the levels least- to most-consequential", () => {
    expect(riskRank("READ")).toBeLessThan(riskRank("REVERSIBLE_WRITE"));
    expect(riskRank("REVERSIBLE_WRITE")).toBeLessThan(riskRank("IMPORTANT_STATE_CHANGE"));
    expect(riskRank("IMPORTANT_STATE_CHANGE")).toBeLessThan(riskRank("EXTERNAL_ACTION"));
    expect(riskRank("EXTERNAL_ACTION")).toBeLessThan(riskRank("HIGH_IMPACT_ACTION"));
  });

  it("atOrAbove is inclusive at the floor", () => {
    expect(atOrAbove("EXTERNAL_ACTION", "EXTERNAL_ACTION")).toBe(true);
    expect(atOrAbove("HIGH_IMPACT_ACTION", "EXTERNAL_ACTION")).toBe(true);
    expect(atOrAbove("REVERSIBLE_WRITE", "EXTERNAL_ACTION")).toBe(false);
  });

  it("highestRisk takes the maximum across a turn, not the first", () => {
    expect(highestRisk(["create_commitment", "forget_memory"])).toBe("IMPORTANT_STATE_CHANGE");
    expect(highestRisk(["forget_memory", "create_commitment"])).toBe("IMPORTANT_STATE_CHANGE");
    expect(highestRisk([])).toBeNull();
  });
});

describe("confirmation", () => {
  // Whether a call ASKS is decided by permissions/policy.ts, which combines
  // this table with the user's grants — see policy.test.ts for every cell.

  it("puts the floor at the first level undo cannot reverse", () => {
    // §35: external actions always confirm. That is also exactly where
    // recoverability ends — nothing undoes a sent message.
    expect(CONFIRMATION_FLOOR).toBe("EXTERNAL_ACTION");
  });
});

describe("the classification itself, where it is non-obvious", () => {
  it("treats forgetting and correcting as MORE than a reversible write", () => {
    // Both are reversible — nothing here deletes — but they change what the
    // assistant BELIEVES, and the user may never notice the wrong one went.
    // Recoverability is not the only axis; noticeability is too.
    expect(riskFor("forget_memory")).toBe("IMPORTANT_STATE_CHANGE");
    expect(riskFor("correct_relationship")).toBe("IMPORTANT_STATE_CHANGE");
  });

  it("classifies poller-driven tools by their MUTATION, not their trigger", () => {
    expect(riskFor("fire_reminder")).toBe("REVERSIBLE_WRITE");
    expect(riskFor("evaluate_workflow")).toBe("REVERSIBLE_WRITE");
  });

  it("has no EXTERNAL_ACTION yet, and that is honest", () => {
    // Nothing in this registry leaves the system. Gmail, Calendar and Drive
    // arrive in Phase 7 (§34) and will be the first.
    const external = Object.entries(RISK_BY_TOOL).filter(
      ([, level]) => level === "EXTERNAL_ACTION" || level === "HIGH_IMPACT_ACTION",
    );
    expect(external).toEqual([]);
  });
});
