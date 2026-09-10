import { describe, expect, it } from "vitest";
import type { CurrentCommitment } from "@ourglass/db";
import { detectDuplicate, resolveMention } from "./resolve.js";

describe("resolveMention", () => {
  it("auto-resolves one exact person and asks on an exact-name collision", () => {
    expect(resolveMention({ name: "Barkha" }, [{ id: "1", displayName: "Barkha" }])).toMatchObject({ band: "auto", id: "1" });
    expect(resolveMention({ name: "Arun" }, [{ id: "1", displayName: "Arun" }, { id: "2", displayName: "Arun" }])).toMatchObject({ band: "ask" });
  });

  /**
   * REGRESSION — spec §11's "two Aruns" case, at the POLICY level.
   *
   * An exact match used to auto-resolve whenever it was the sole top score,
   * because only exact TIES were treated as contested. "Arun" scores 1.0 against
   * "Arun" and 0.725 against "Arun Kumar" — not a tie — so it silently picked
   * one, which is the wrong-merge failure mode DECISIONS.md #9 calls the worst
   * in the system. A contested runner-up must force `ask` even behind a perfect
   * leader.
   */
  it("asks when a second person's name plausibly matches, even behind an exact match", () => {
    const resolution = resolveMention({ name: "Arun" }, [
      { id: "batore", displayName: "Arun" },
      { id: "mttn", displayName: "Arun Kumar" },
    ]);
    expect(resolution.band).toBe("ask");
    if (resolution.band !== "ask") throw new Error("unreachable");
    expect(resolution.candidates.map((candidate) => candidate.id).sort()).toEqual(["batore", "mttn"]);
  });

  it("still auto-resolves an exact match when nothing else is close", () => {
    expect(resolveMention({ name: "Arun" }, [
      { id: "arun", displayName: "Arun" },
      { id: "barkha", displayName: "Barkha" },
    ])).toMatchObject({ band: "auto", id: "arun" });
  });

  /**
   * REGRESSION — nameSimilarity returned a flat 0.8 for ANY containment, so a
   * single stray character scored the same as a real name-vs-fuller-name match.
   * `nameSimilarity("a", "Barkha")` was 0.8, landing in the ask band against
   * every person in the table.
   */
  it("rejects a one-character fragment instead of asking about everyone", () => {
    expect(resolveMention({ name: "a" }, [
      { id: "1", displayName: "Barkha" },
      { id: "2", displayName: "Arun Kumar" },
    ])).toMatchObject({ band: "reject" });
  });

  it("still asks about a plausible typo", () => {
    expect(resolveMention({ name: "Aru" }, [{ id: "1", displayName: "Arun" }])).toMatchObject({ band: "ask" });
  });

  it("rejects a name that matches nobody", () => {
    expect(resolveMention({ name: "Priya" }, [{ id: "1", displayName: "Barkha" }])).toMatchObject({ band: "reject" });
  });

  it("rejects when there are no candidates at all", () => {
    expect(resolveMention({ name: "Arun" }, [])).toEqual({ band: "reject", score: 0 });
  });
});

describe("detectDuplicate", () => {
  const sameDirection = (overrides: Partial<CurrentCommitment> = {}): CurrentCommitment => ({
    id: "commitment-1", owner_id: "barkha", recipient_id: "user", object_text: "the Hult poster",
    object_embedding: null, expected_at: null, completed_at: null, status: "pending", project_id: null,
    t_valid: new Date(), t_invalid: null, t_created: new Date(), t_expired: null, display_status: "pending", ...overrides,
  });

  it("auto-matches only exact normalized content in the interim lexical policy", () => {
    expect(detectDuplicate({ ownerId: "barkha", recipientId: "user", objectText: "the Hult poster", status: "pending" }, [sameDirection()])).toMatchObject({ kind: "auto_match" });
  });

  it("hard-vetoes ownership or completion-state differences before text similarity", () => {
    expect(detectDuplicate({ ownerId: "user", recipientId: "barkha", objectText: "Hult poster", status: "pending" }, [sameDirection()])).toMatchObject({ kind: "create", reason: "hard_veto" });
    expect(detectDuplicate({ ownerId: "barkha", recipientId: "user", objectText: "Hult poster", status: "completed" }, [sameDirection()])).toMatchObject({ kind: "create", reason: "hard_veto" });
  });

  /**
   * REGRESSION — spec §23's own example produced the duplicate the section says
   * verbatim not to create. Plain Jaccard divides by the UNION, so every
   * qualifier the user adds LOWERS the score — and users add qualifiers exactly
   * when they are re-referring to something. This pair scored 0.250 (reject).
   */
  it("matches spec §23's own re-reference example instead of duplicating it", () => {
    const selfOwned = sameDirection({ owner_id: "user", recipient_id: null, object_text: "finish the poster" });
    const decision = detectDuplicate(
      { ownerId: "user", recipientId: null, objectText: "still need to finish that Hult poster", status: "pending" },
      [selfOwned],
    );
    expect(decision.kind).not.toBe("create");
    if (decision.kind === "create") throw new Error("unreachable");
    expect(decision.score).toBeGreaterThanOrEqual(0.65);
  });

  it("does not merge two genuinely different commitments", () => {
    const decision = detectDuplicate(
      { ownerId: "barkha", recipientId: "user", objectText: "the article", status: "pending" },
      [sameDirection()],
    );
    expect(decision).toMatchObject({ kind: "create", reason: "below_threshold" });
  });

  /**
   * REGRESSION — `undefined !== null` is true, so a proposal with no recipient
   * was vetoed against a SQL NULL recipient column, silently forcing a duplicate
   * for every self-owned commitment.
   */
  it("treats an absent recipient and a NULL recipient as the same direction", () => {
    const selfOwned = sameDirection({ owner_id: "user", recipient_id: null, object_text: "the Hult poster" });
    expect(detectDuplicate(
      { ownerId: "user", recipientId: undefined as unknown as null, objectText: "the Hult poster", status: "pending" },
      [selfOwned],
    )).toMatchObject({ kind: "auto_match" });
  });

  /**
   * REGRESSION — the reason feeds spec §28's inspection surface. It used to
   * report `hard_veto` whenever any rows existed, including when the real cause
   * was "nothing scored high enough", misleading whoever debugs a duplicate.
   */
  it("reports which filter actually caused a create", () => {
    expect(detectDuplicate({ ownerId: "barkha", recipientId: "user", objectText: "anything", status: "pending" }, []))
      .toMatchObject({ kind: "create", reason: "no_candidates" });

    // Candidates exist but all differ in direction -> genuinely a veto.
    expect(detectDuplicate({ ownerId: "user", recipientId: "barkha", objectText: "the Hult poster", status: "pending" }, [sameDirection()]))
      .toMatchObject({ kind: "create", reason: "hard_veto" });

    // Candidates survive the veto and are scored, but none is close enough.
    expect(detectDuplicate({ ownerId: "barkha", recipientId: "user", objectText: "buy milk", status: "pending" }, [sameDirection()]))
      .toMatchObject({ kind: "create", reason: "below_threshold" });
  });
});
