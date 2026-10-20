/**
 * The gate's pure half: one intent's calls against the current grants.
 */
import { describe, expect, it } from "vitest";
import { UnclassifiedToolError } from "../tools/risk.js";
import { ControlPlaneToolEmittedError, gateIntentCalls } from "./gate.js";
import type { PermissionGrantDecision } from "./policy.js";

const none = new Map<string, PermissionGrantDecision>();

describe("gateIntentCalls", () => {
  it("allows internal writes by default — act immediately, undo available", () => {
    expect(
      gateIntentCalls([{ name: "remember", input: {} }, { name: "forget_memory", input: {} }], none),
    ).toEqual({ decision: "allow" });
  });

  it("holds the WHOLE intent when any one call needs confirmation", () => {
    const grants = new Map<string, PermissionGrantDecision>([["forget_memory", "confirm"]]);
    expect(
      gateIntentCalls([{ name: "forget_memory", input: {} }, { name: "remember", input: {} }], grants),
    ).toEqual({
      decision: "confirm",
      // The HIGHEST risk among the calls, not the risk of the call that asked.
      risk: "IMPORTANT_STATE_CHANGE",
      reason: "user_requires_confirmation",
    });
  });

  it("THROWS on a control-plane tool — a grant must never come from a conversation", () => {
    // Even with an allow grant sitting in the map for it: the refusal is about
    // where the call came from, not about its risk.
    const grants = new Map<string, PermissionGrantDecision>([["set_permission", "allow"]]);
    expect(() =>
      gateIntentCalls([{ name: "set_permission", input: { action_type: "x" } }], grants),
    ).toThrow(ControlPlaneToolEmittedError);
  });

  it("fails closed on an unclassified tool rather than assuming it is safe", () => {
    // Was "send_email" until email shipped (2026-10-20); any unclassified name will do.
    expect(() => gateIntentCalls([{ name: "transfer_money", input: {} }], none)).toThrow(
      UnclassifiedToolError,
    );
  });

  it("holds every email — even under a standing allow (owner decision 2026-09-24)", () => {
    const send = [{ name: "send_email", input: {} }];
    expect(gateIntentCalls(send, none)).toMatchObject({ decision: "confirm", risk: "HIGH_IMPACT_ACTION" });
    expect(gateIntentCalls(send, new Map([["send_email", "allow" as const]]))).toMatchObject({ decision: "confirm" });
  });

  it("allows an empty call list", () => {
    expect(gateIntentCalls([], none)).toEqual({ decision: "allow" });
  });
});
