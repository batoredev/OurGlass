/**
 * Respond's fallback is the thing that must work when everything else does
 * not, so it carries more tests than the happy path.
 *
 * The property every test here defends: THE MUTATION HAS ALREADY COMMITTED
 * when Respond runs. A cosmetic model failure must produce a correct
 * template sentence and `degraded: true` — never a throw, never a retry,
 * never a rollback.
 */
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { RESPOND_MODEL, type CommittedFact, type RespondInput } from "@ourglass/shared";
import {
  HaikuResponder,
  TemplateResponder,
  formatDuration,
  renderFacts,
  templateReply,
} from "./respond.js";

function input(over: Partial<RespondInput> = {}): RespondInput {
  return { committed: [], questions: [], declined: [], ...over };
}

const completedLate: CommittedFact = {
  kind: "commitment_completed",
  objectText: "the Hult poster",
  latenessMs: 5 * 3_600_000,
};

describe("formatDuration", () => {
  // Spec §20's own wording, verbatim: expected 6 PM, actual 11 PM -> "five hours".
  it("renders five hours as spec §20 words it", () => {
    expect(formatDuration(5 * 3_600_000)).toBe("five hours");
  });

  it("uses minutes below ninety and words up to twelve", () => {
    expect(formatDuration(45 * 60_000)).toBe("45 minutes");
    expect(formatDuration(60_000)).toBe("one minute");
    expect(formatDuration(2 * 3_600_000)).toBe("two hours");
  });

  it("falls back to digits above twelve and to days above 48 hours", () => {
    expect(formatDuration(37 * 3_600_000)).toBe("37 hours");
    expect(formatDuration(72 * 3_600_000)).toBe("three days");
  });

  it("never reports a negative duration as late", () => {
    // An early completion has a negative latenessMs. describeFact gates on
    // `> 0`, but formatDuration must not produce nonsense if ever called.
    expect(formatDuration(-3_600_000)).toBe("less than a minute");
  });
});

describe("templateReply", () => {
  it("states a late completion with its duration", () => {
    expect(templateReply(input({ committed: [completedLate] }))).toBe(
      "Got it — the Hult poster marked complete, five hours late.",
    );
  });

  /**
   * latenessMs null means expected_at was NULL — there was no deadline to be
   * late against (§2). It must NOT be reported as on-time-to-the-millisecond
   * and must not invent a duration.
   */
  it("omits lateness entirely when there was no deadline", () => {
    expect(
      templateReply(input({ committed: [{ ...completedLate, latenessMs: null }] })),
    ).toBe("Got it — the Hult poster marked complete.");
  });

  it("treats an early completion as plain complete", () => {
    expect(
      templateReply(input({ committed: [{ ...completedLate, latenessMs: -7_200_000 }] })),
    ).toBe("Got it — the Hult poster marked complete.");
  });

  /**
   * §3.3: a partial commit is only safe if it is VISIBLE. The reply must
   * state both halves so the user can say "undo that" and get the turn back.
   * Silence about a write is exactly what spec §28 exists to prevent.
   */
  it("states BOTH what committed and what is still being asked", () => {
    const reply = templateReply(
      input({ committed: [completedLate], questions: ["Who's the plumber?"] }),
    );
    expect(reply).toContain("marked complete");
    expect(reply).toContain("Who's the plumber?");
  });

  it("never returns an empty reply", () => {
    expect(templateReply(input())).toBe("Done.");
  });

  it("renders each fact kind", () => {
    expect(
      templateReply(
        input({
          committed: [
            {
              kind: "commitment_created",
              ownerName: "Barkha",
              recipientName: "You",
              objectText: "the article",
              expectedAtLocal: "Fri 6:00 PM",
            },
            { kind: "reminder_created", fireAtLocal: "Fri 5:00 PM" },
            { kind: "commitment_updated", objectText: "the schema", status: "pending" },
          ],
        }),
      ),
    ).toBe(
      "Noted: Barkha → You — the article, due Fri 6:00 PM. " +
        "Reminder set for Fri 5:00 PM. Updated: the schema — pending.",
    );
  });
});

describe("renderFacts", () => {
  it("carries no UUID-shaped content to the model", () => {
    // The trust boundary is structural — RespondInput has no field that can
    // hold an id — but this asserts it end-to-end so a future field addition
    // that leaks one fails here rather than in production prose.
    const rendered = renderFacts(input({ committed: [completedLate] }));
    expect(rendered).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});

// ---------------------------------------------------------------------------
// The fallback. One test per row of §5.2's table.
// ---------------------------------------------------------------------------

function fakeClient(create: unknown): Anthropic {
  return { messages: { create } } as unknown as Anthropic;
}

function message(over: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: RESPOND_MODEL,
    content: [{ type: "text", text: "Got it — the Hult poster marked complete.", citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 14 },
    ...over,
  } as Anthropic.Message;
}

describe("HaikuResponder", () => {
  it("uses the model's reply when it is well-formed", async () => {
    const responder = new HaikuResponder({ apiKey: "k", client: fakeClient(async () => message()) });
    const result = await responder.respondWithTrace(input({ committed: [completedLate] }));
    expect(result.degraded).toBe(false);
    expect(result.reply).toBe("Got it — the Hult poster marked complete.");
    expect(result.trace.usage).toEqual({ inputTokens: 120, outputTokens: 14 });
  });

  it("sends NO tools — a hallucination must not be executable", async () => {
    // The parameter is DECLARED AND USED (`body`) rather than elided:
    // `vi.fn(async () => ...)` infers a ZERO-argument signature, which makes
    // `mock.calls[0]` the empty tuple and indexing it a type error. The whole
    // point of this test is inspecting that first argument, so the signature
    // has to admit it.
    const create = vi.fn(async (body: Record<string, unknown>) => {
      void body;
      return message();
    });
    const responder = new HaikuResponder({ apiKey: "k", client: fakeClient(create) });
    await responder.respond(input({ committed: [completedLate] }));
    const body = create.mock.calls[0]![0];
    expect(body["tools"]).toBeUndefined();
    expect(body["tool_choice"]).toBeUndefined();
    expect(body["model"]).toBe(RESPOND_MODEL);
    // §31: a token cap makes "concise" structural rather than a request.
    expect(body["max_tokens"]).toBe(200);
  });

  /**
   * THE CENTRAL TEST OF THIS FILE.
   *
   * A thrown SDK error must produce the correct template sentence, exactly
   * ONE call attempt (no retry — a retry loop on a paid endpoint is the most
   * expensive failure available, .claude/rules/wat.md §3), and degraded:true.
   */
  it("falls back with no retry when the SDK throws", async () => {
    const create = vi.fn(async () => {
      throw new Error("503 upstream");
    });
    const responder = new HaikuResponder({ apiKey: "k", client: fakeClient(create) });
    const result = await responder.respondWithTrace(input({ committed: [completedLate] }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.degraded).toBe(true);
    expect(result.trace.fallbackReason).toBe("sdk_error");
    expect(result.reply).toBe("Got it — the Hult poster marked complete, five hours late.");
  });

  it.each([
    ["refusal", "refusal"],
    ["max_tokens", "max_tokens"],
  ] as const)("falls back on stop_reason %s", async (stopReason, expected) => {
    const responder = new HaikuResponder({
      apiKey: "k",
      client: fakeClient(async () => message({ stop_reason: stopReason })),
    });
    const result = await responder.respondWithTrace(input({ committed: [completedLate] }));
    expect(result.degraded).toBe(true);
    expect(result.trace.fallbackReason).toBe(expected);
  });

  it("falls back on empty or whitespace-only text", async () => {
    const responder = new HaikuResponder({
      apiKey: "k",
      client: fakeClient(async () => message({ content: [{ type: "text", text: "   ", citations: null }] })),
    });
    const result = await responder.respondWithTrace(input({ committed: [completedLate] }));
    expect(result.trace.fallbackReason).toBe("empty_text");
  });

  it("falls back on a reply over the 600-character cap", async () => {
    const responder = new HaikuResponder({
      apiKey: "k",
      client: fakeClient(async () =>
        message({ content: [{ type: "text", text: "x".repeat(601), citations: null }] }),
      ),
    });
    const result = await responder.respondWithTrace(input({ committed: [completedLate] }));
    expect(result.trace.fallbackReason).toBe("too_long");
  });

  /**
   * The timeout is not a nicety. Without it an SDK hang makes a COMMITTED
   * turn appear to fail, the user says it again, and the duplicate lands in
   * spec §23's machinery. Tested with a 10ms bound and a never-resolving
   * promise so it cannot sleep.
   */
  it("falls back on a timeout rather than hanging on a committed turn", async () => {
    const responder = new HaikuResponder({
      apiKey: "k",
      timeoutMs: 10,
      client: fakeClient(
        (_body: unknown, options: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    });
    const result = await responder.respondWithTrace(input({ committed: [completedLate] }));
    expect(result.degraded).toBe(true);
    expect(result.trace.fallbackReason).toBe("timeout");
    expect(result.reply).toContain("five hours late");
  });
});

describe("TemplateResponder", () => {
  it("is honest that it never called a model", async () => {
    const result = await new TemplateResponder().respond(input({ committed: [completedLate] }));
    expect(result.degraded).toBe(true);
  });
});
