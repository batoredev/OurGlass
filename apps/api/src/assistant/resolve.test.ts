import { describe, expect, it } from "vitest";
import type { CurrentCommitment } from "@ourglass/db";
import {
  decideCompletion,
  detectDuplicate,
  isFirstPersonMention,
  resolveMention,
  resolvePersonMention,
} from "./resolve.js";

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

// ---------------------------------------------------------------------------
// Phase 3 — the first-person short-circuit (F3) and completion matching (§4).
// ---------------------------------------------------------------------------

describe("isFirstPersonMention", () => {
  it("recognises the first-person mentions the demo sentence uses", () => {
    for (const name of ["me", "I", "Me", "myself", "my", "mine", " me "]) {
      expect(isFirstPersonMention(name)).toBe(true);
    }
  });

  /**
   * WHOLE mention only, never a prefix. A real name that merely starts with a
   * first-person string must not short-circuit to the user — that would be
   * the wrong-merge failure mode DECISIONS.md #9 calls the worst in the
   * system, landing on the most common mention in the product.
   */
  it("does not match a real name that merely starts with a first-person string", () => {
    for (const name of ["Mike", "Mina", "Ian", "Mira", "Minal", "Ines"]) {
      expect(isFirstPersonMention(name)).toBe(false);
    }
  });
});

describe("resolvePersonMention — first-person short-circuit (F3)", () => {
  /**
   * ============================ WHY THIS EXISTS ============================
   * The demo sentence is "Barkha needs to give ME the article by 6", so
   * recipient_id IS the user. Before the short-circuit,
   * nameSimilarity("me", <any real name>) was ~0 and every first-person
   * mention landed in `reject` — the product could not express its own demo
   * sentence.
   *
   * The Phase 1 integration test hid this by seeding a person literally named
   * "User" and handing the tool a UUID directly, so "me" never reached the
   * resolver at all. A green test over a path the product cannot take. Do NOT
   * reintroduce a person named "User" to make anything here pass.
   * =======================================================================
   */
  const throwingTx = {
    query: async () => {
      throw new Error("the short-circuit must resolve BEFORE any candidate query runs");
    },
  } as unknown as Parameters<typeof resolvePersonMention>[0];

  it("resolves 'me' to the user's own person WITHOUT querying candidates", async () => {
    expect(await resolvePersonMention(throwingTx, { name: "me" }, "self-person-id")).toEqual({
      band: "auto",
      id: "self-person-id",
      score: 1,
    });
  });

  it("short-circuits before scoring, so no real person can contest 'I'", async () => {
    expect(await resolvePersonMention(throwingTx, { name: "I" }, "self-person-id")).toMatchObject({
      band: "auto",
      id: "self-person-id",
    });
  });

  /**
   * A user row with no linked person is HALF-BUILT, not a crash. The honest
   * outcome is that "me" falls through to similarity scoring, rejects, and
   * becomes a question. (A missing USER row is a different thing entirely —
   * the orchestrator throws UnknownUserError before Interpret, because that
   * is a deployment fault rather than a conversational one.)
   */
  it("falls through to normal scoring when the user has no linked person", async () => {
    const emptyTx = {
      query: async () => ({ rows: [], command: "", rowCount: 0, oid: 0, fields: [] }),
    } as unknown as Parameters<typeof resolvePersonMention>[0];
    expect(await resolvePersonMention(emptyTx, { name: "me" }, null)).toMatchObject({
      band: "reject",
    });
  });
});

describe("decideCompletion (§4)", () => {
  const open = (overrides: Partial<CurrentCommitment> = {}): CurrentCommitment => ({
    id: "c1", owner_id: "barkha", recipient_id: "user", object_text: "the article",
    object_embedding: null, expected_at: null, completed_at: null, status: "pending", project_id: null,
    t_valid: new Date(), t_invalid: null, t_created: new Date(), t_expired: null,
    display_status: "pending", ...overrides,
  });

  const probe = { ownerId: "barkha", recipientId: "user", objectText: "the article" };

  /**
   * THE INVERTED VETO (§4.1).
   *
   * detectDuplicate's third hard veto is
   *   isCompleted(proposal.status) !== isCompleted(candidate.status)
   * which is correct for §23 and BACKWARDS here: a completion's real status
   * is `completed` while every open candidate is `pending`, so every
   * candidate would be vetoed and the decision would come back `create`.
   *
   * `create` is catastrophic for a completion — it would insert a SECOND,
   * already-completed commitment beside the open one (§23's forbidden
   * duplicate) and leave the real commitment open forever. The "pending"
   * probe is what prevents that.
   */
  it("matches an OPEN commitment instead of vetoing every candidate", () => {
    expect(decideCompletion(probe, [open()])).toMatchObject({
      kind: "matched",
      commitmentId: "c1",
    });
  });

  it("still honours the owner/recipient direction veto", () => {
    // Spec §7's central distinction: "Barkha owes me" is not "I owe Barkha".
    expect(decideCompletion(probe, [open({ owner_id: "user", recipient_id: "barkha" })])).toMatchObject({
      kind: "ask",
      reason: "hard_veto",
    });
  });

  it("matches a self-owned commitment whose recipient is SQL NULL", () => {
    expect(
      decideCompletion({ ownerId: "user", recipientId: null, objectText: "the Hult poster" }, [
        open({ owner_id: "user", recipient_id: null, object_text: "the Hult poster" }),
      ]),
    ).toMatchObject({ kind: "matched" });
  });

  /**
   * THE INVERSION (§4.2). Zero matches ASKS; it never creates a retroactive
   * already-completed commitment. Creating one would write a row the user
   * never asked for with a fabricated (or absent) expected_at — making §20's
   * lateness, the very thing the sentence is about, unreachable — and would
   * silently hide the real still-open commitment when the miss was a
   * text-similarity failure rather than a genuine absence.
   */
  it("ASKS rather than creating when nothing matches", () => {
    expect(decideCompletion(probe, [])).toMatchObject({ kind: "ask", reason: "no_candidates" });
    expect(decideCompletion(probe, [open({ object_text: "buy milk" })])).toMatchObject({
      kind: "ask",
      reason: "below_threshold",
    });
  });

  it("asks with every plausible candidate when several are in band", () => {
    const decision = decideCompletion({ ...probe, objectText: "the deck" }, [
      open({ id: "a", object_text: "the deck for Monday" }),
      open({ id: "b", object_text: "the deck for Friday" }),
    ]);
    expect(decision).toMatchObject({ kind: "ask", reason: "ambiguous" });
    if (decision.kind !== "ask") throw new Error("unreachable");
    expect([...decision.candidateIds].sort()).toEqual(["a", "b"]);
  });

  /**
   * ============ RECORDS WHICH BAND EACH DEMO PHRASING LANDS IN ============
   * UPDATE DELIBERATELY, NEVER TO MAKE A TEST PASS.
   *
   * Pinned arithmetic, not aspiration. `auto_match` needs >= 0.92, and this
   * scorer reaches that ONLY when the content-token sets are IDENTICAL:
   * containment 1.0 + Jaccard 1.0 = exactly 1.000. One extra content token on
   * either side caps a two-token match at 0.7*1.0 + 0.3*(2/3) = 0.900.
   *
   * CONSEQUENCE, VERIFIED BY RUNNING THE SCORER: the auto band is effectively
   * UNREACHABLE for completion matching. Every realistic re-phrasing lands in
   * `ask`, including the phase demo's own pairing ("the article" against a
   * stored "give me the article" scores 0.850). The two-turn exchange — ask,
   * confirm, complete — IS the expected demo path, not a degraded one. That is
   * spec §11 and §27 working correctly: marking the WRONG commitment done is a
   * meaningful mistake, and §27 says never guess when guessing can cause one.
   *
   * DO NOT lower ASK_THRESHOLD or AUTO_THRESHOLD to make the auto band fire.
   * §4.2 forbids it explicitly and DECISIONS.md #9 is why: a wrong write is
   * the worst outcome in this system, and a wrongly-completed commitment is
   * near-invisible — it silently stops appearing in "what am I waiting on",
   * which is the very surface a user would rely on to notice.
   * The real fix is Phase 4's embeddings over commitments.object_embedding,
   * which already ships NULLable for exactly this.
   * =======================================================================
   */
  it.each([
    ["the article", "the article", "matched"],
    ["the article", "give me the article", "ask"],
    ["the article", "the article by 6", "ask"],
    ["the Hult poster", "finish the Hult poster", "ask"],
    ["the poster", "the Hult poster", "ask"],
    // Lexical only: it cannot tell "the article" from "the piece" — scores 0.
    ["the article", "the piece", "ask"],
  ])("records the band for %j said against stored %j", (said, stored, expected) => {
    expect(decideCompletion({ ...probe, objectText: said }, [open({ object_text: stored })]).kind).toBe(
      expected,
    );
  });
});
