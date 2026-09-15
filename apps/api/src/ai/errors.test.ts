/**
 * The failure-policy table, and the three categories that must NOT fall back.
 *
 * ================================ READ THIS ================================
 * The dangerous mistake in a fallback chain is falling back too eagerly, not
 * too rarely. Three categories are deliberately terminal, and each has a
 * different reason worth keeping straight:
 *
 *   refused        - a safety decision. Trying the next provider is shopping
 *                    for one that will comply.
 *   truncated      - OUR max_tokens. Every provider truncates identically.
 *   context_window - the input is too big. Nothing downstream shrinks it.
 *
 * A fourth, `bad_request`, is terminal because it is our bug: a malformed
 * schema rejected by one provider is rejected by all three, and falling back
 * turns one clear error into three confusing ones.
 * ===========================================================================
 */
import { describe, expect, it } from "vitest";
import { PROVIDER_FAILURE_CATEGORIES } from "@ourglass/shared";
import { ExtractionError } from "../assistant/extract.js";
import { FAILURE_POLICY, ProviderError, classifyProviderError } from "./errors.js";

describe("the failure policy is total and reasoned", () => {
  it("covers every declared category", () => {
    // Derived from the shared list, never a hardcoded copy: adding a category
    // without a policy must fail here rather than default to something.
    for (const category of PROVIDER_FAILURE_CATEGORIES) {
      expect(FAILURE_POLICY[category], category).toBeDefined();
    }
    expect(Object.keys(FAILURE_POLICY).sort()).toEqual([...PROVIDER_FAILURE_CATEGORIES].sort());
  });

  it("gives every category a rationale someone can argue with", () => {
    for (const [category, policy] of Object.entries(FAILURE_POLICY)) {
      expect(policy.rationale.length, category).toBeGreaterThan(20);
    }
  });

  it("NEVER falls back on refusal, truncation, context overflow, or our own bad request", () => {
    for (const category of ["refused", "truncated", "context_window", "bad_request"] as const) {
      expect(FAILURE_POLICY[category].fallbackable, category).toBe(false);
      expect(FAILURE_POLICY[category].retryable, category).toBe(false);
    }
  });

  it("never retries a permanent auth failure", () => {
    // §10: a wrong key stays wrong. Retrying is latency the user pays for
    // nothing, before the fallback that was always going to be needed.
    expect(FAILURE_POLICY.auth.retryable).toBe(false);
    expect(FAILURE_POLICY.auth.fallbackable).toBe(true);
  });

  it("retries the transient ones", () => {
    for (const category of ["timeout", "network", "rate_limit", "server_error"] as const) {
      expect(FAILURE_POLICY[category].retryable, category).toBe(true);
      expect(FAILURE_POLICY[category].fallbackable, category).toBe(true);
    }
  });
});

describe("classifyProviderError", () => {
  const statusCases: readonly [number, string][] = [
    [401, "auth"],
    [403, "auth"],
    [404, "unavailable"],
    [408, "timeout"],
    [429, "rate_limit"],
    [500, "server_error"],
    [503, "server_error"],
    [400, "bad_request"],
    [422, "bad_request"],
  ];

  for (const [status, expected] of statusCases) {
    it(`maps HTTP ${status} to ${expected}`, () => {
      const classified = classifyProviderError("claude", Object.assign(new Error("boom"), { status }));
      expect(classified.category).toBe(expected);
      expect(classified.status).toBe(status);
    });
  }

  it("maps every ExtractionFailureReason without falling through to unknown", () => {
    const reasons = [
      ["refused", "refused"],
      ["truncated", "truncated"],
      ["context_window_exceeded", "context_window"],
      ["no_tool_call", "malformed_output"],
      ["invalid_payload", "schema_invalid"],
    ] as const;

    for (const [reason, expected] of reasons) {
      const error = new ExtractionError(reason, "x", { utterance: "u", stopReason: null });
      expect(classifyProviderError("claude", error).category, reason).toBe(expected);
    }
  });

  it("treats an aborted request as a timeout", () => {
    const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(classifyProviderError("qwen", aborted).category).toBe("timeout");
  });

  it("treats a dead host as network, including fetch's bare TypeError", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(classifyProviderError("qwen", refused).category).toBe("network");
    // `fetch` against a stopped Ollama reports exactly this, with no code.
    expect(classifyProviderError("qwen", new TypeError("fetch failed")).category).toBe("network");
  });

  it("falls back to unknown rather than guessing", () => {
    const classified = classifyProviderError("gemini", "something odd");
    expect(classified.category).toBe("unknown");
    // Unknown still lets the NEXT provider try — failing the whole turn on an
    // error we did not recognise is worse than one extra call.
    expect(classified.fallbackable).toBe(true);
    expect(classified.retryable).toBe(false);
  });

  it("passes an already-classified error through unchanged", () => {
    const original = new ProviderError("claude", "rate_limit", "slow down");
    expect(classifyProviderError("gemini", original)).toBe(original);
  });

  it("records the provider that failed, not the one asking", () => {
    const classified = classifyProviderError("gemini", new Error("x"));
    expect(classified.provider).toBe("gemini");
  });
});
