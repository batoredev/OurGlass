/**
 * The §35 decision table, exhaustively. Every risk level crossed with every
 * grant state — fifteen cells, so a changed cell cannot hide among the rest.
 */
import { describe, expect, it } from "vitest";
import { RISK_LEVELS, type RiskLevel } from "@ourglass/shared";
import { canPersistentlyAllow, decidePermission, type PermissionGrantDecision } from "./policy.js";

type Cell = "allow" | "confirm";

const TABLE: Record<RiskLevel, Record<"none" | PermissionGrantDecision, Cell>> = {
  READ: { none: "allow", allow: "allow", confirm: "confirm" },
  REVERSIBLE_WRITE: { none: "allow", allow: "allow", confirm: "confirm" },
  IMPORTANT_STATE_CHANGE: { none: "allow", allow: "allow", confirm: "confirm" },
  EXTERNAL_ACTION: { none: "confirm", allow: "allow", confirm: "confirm" },
  HIGH_IMPACT_ACTION: { none: "confirm", allow: "confirm", confirm: "confirm" },
};

describe("decidePermission", () => {
  it("covers every risk level", () => {
    expect(Object.keys(TABLE).sort()).toEqual([...RISK_LEVELS].sort());
  });

  for (const risk of RISK_LEVELS) {
    for (const grant of ["none", "allow", "confirm"] as const) {
      it(`${risk} with ${grant} grant -> ${TABLE[risk][grant]}`, () => {
        const outcome = decidePermission(risk, grant === "none" ? null : grant);
        expect(outcome.decision).toBe(TABLE[risk][grant]);
      });
    }
  }

  it("names WHY it asks, so the question can say so", () => {
    expect(decidePermission("REVERSIBLE_WRITE", "confirm")).toEqual({
      decision: "confirm",
      reason: "user_requires_confirmation",
    });
    expect(decidePermission("EXTERNAL_ACTION", null)).toEqual({
      decision: "confirm",
      reason: "risk_default",
    });
    expect(decidePermission("HIGH_IMPACT_ACTION", "allow")).toEqual({
      decision: "confirm",
      reason: "never_persistently_allowed",
    });
  });
});

describe("canPersistentlyAllow", () => {
  it("refuses only HIGH_IMPACT_ACTION, so a grant is never recorded and then ignored", () => {
    for (const risk of RISK_LEVELS) {
      expect(canPersistentlyAllow(risk)).toBe(risk !== "HIGH_IMPACT_ACTION");
    }
  });
});
