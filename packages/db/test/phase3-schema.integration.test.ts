/**
 * PHASE 3 SCHEMA + REPOSITORY INTEGRATION TESTS.
 *
 * ================================ READ THIS ================================
 * These assert the things TYPECHECK AND LINT CANNOT SEE. Every finding in
 * docs/PHASE-3-DESIGN.md §0 (F1–F5) was a column or table that existed with no
 * code path reaching it — invisible to the compiler, to lint, and to a green
 * test suite. So was `rev3`'s `users_current` finding, which is the mirror
 * image: code reaching schema through a view that silently does not carry it,
 * where `tx.query<User>` is an UNCHECKED CAST that keeps the compiler happy
 * while the runtime value is `undefined`.
 *
 * The `_current` view column-parity suite below is the standing guard for that
 * whole class, not for the one instance. Do not delete it as redundant.
 * ===========================================================================
 *
 * INTEGRATION: needs a real Postgres 17 + pgvector with migrations applied.
 * Skips when DATABASE_URL is unset so the fast unit lane stays Docker-free —
 * a skip is expected locally and a HARD FAILURE in CI, which does set it.
 *
 * NOTE ON PARALLELISM: vitest.integration.config.ts sets `fileParallelism:
 * false`. Do not re-enable it. docs/DECISIONS.md records the cross-file race
 * where one file's truncate fired between another's commit and read-back,
 * which took `main` red.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createPool,
  withTransaction,
  people,
  commitments,
  users,
  reminders,
  messages,
  commitmentNotes,
  workflows,
  truncateAll,
} from "../src/index.js";
import type pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL && process.env.CI) {
  throw new Error(
    "DATABASE_URL is unset in CI. The Phase 3 schema suite would have silently " +
      "skipped — see the header comment in this file for why that is not " +
      "acceptable. Ensure `pnpm db:migrate` ran and DATABASE_URL is exported.",
  );
}

const suite = DATABASE_URL ? describe : describe.skip;

suite("Phase 3 schema and repositories", () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  // -------------------------------------------------------------------------
  // `_current` view column parity — the standing guard for a whole defect class
  // -------------------------------------------------------------------------
  describe("_current views carry every column of their base table", () => {
    /**
     * Postgres expands `SELECT *` in a view AT CREATE VIEW TIME into a fixed
     * column list. A later `ALTER TABLE ... ADD COLUMN` does NOT propagate.
     * Migration 007 (`users.person_id`) and 009 (`messages.trace`) are the first
     * two ALTERs in this repo against tables that already had a view, and both
     * rebuild it — this test is what keeps the THIRD one honest.
     *
     * Failure mode if this regresses: nothing errors. The view returns a row
     * missing the key, `tx.query<T>` casts it anyway, and a `=== null` guard
     * does not fire against `undefined`. Silent, and downstream of the change by
     * however long it takes someone to notice "me" stopped resolving.
     */
    it("every _current view exposes all base-table columns", async () => {
      const { rows } = await pool.query<{
        view_name: string;
        missing: string[];
      }>(
        `SELECT v.table_name AS view_name,
                array_agg(bc.column_name ORDER BY bc.column_name) AS missing
           FROM information_schema.views v
           JOIN information_schema.columns bc
             ON bc.table_schema = 'public'
            AND bc.table_name = left(v.table_name, length(v.table_name) - 8)
          WHERE v.table_schema = 'public'
            AND v.table_name LIKE '%\\_current'
            AND NOT EXISTS (
              SELECT 1 FROM information_schema.columns vc
               WHERE vc.table_schema = 'public'
                 AND vc.table_name = v.table_name
                 AND vc.column_name = bc.column_name
            )
          GROUP BY v.table_name`,
      );
      // An empty result is the pass. A non-empty one names the view and the
      // columns it is silently dropping.
      expect(rows).toEqual([]);
    });

    it("users_current exposes person_id (migration 007's rebuild)", async () => {
      // The specific regression `rev3` caught in review. Named separately from
      // the generic check so a failure reads as "F3 is back" rather than as an
      // anonymous parity violation.
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'users_current' AND column_name = 'person_id'`,
      );
      expect(rows).toHaveLength(1);
    });

    it("messages_current exposes trace and degraded (migration 009's rebuild)", async () => {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'messages_current'
            AND column_name IN ('trace','degraded')`,
      );
      expect(rows).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // F3 / F2 — the user IS a person, and carries a timezone
  // -------------------------------------------------------------------------
  describe("users repository (findings F2 and F3)", () => {
    it("ensureUser creates the user AND its person row, and links them", async () => {
      const result = await withTransaction(pool, (tx) =>
        users.ensureUser(tx, { displayName: "Srivaibhav" }),
      );
      expect(result.self).not.toBeNull();
      expect(result.user.person_id).toBe(result.self!.id);
      // F2: the timezone must be readable, not a literal at a call site.
      expect(result.user.timezone).toBe("Asia/Kolkata");
    });

    it("ensureUser is IDEMPOTENT — no second user, no second person", async () => {
      // This is the test that would have caught the `users_current` bug: with a
      // view missing person_id, the second call inserts a FRESH people row every
      // time, turning idempotency into unbounded growth.
      const first = await withTransaction(pool, (tx) =>
        users.ensureUser(tx, { displayName: "Srivaibhav" }),
      );
      const second = await withTransaction(pool, (tx) =>
        users.ensureUser(tx, { displayName: "Srivaibhav" }),
      );
      expect(second.user.id).toBe(first.user.id);
      expect(second.self!.id).toBe(first.self!.id);
      expect(await people.list(pool)).toHaveLength(1);
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM users`);
      expect(rows[0]!.n).toBe(1);
    });

    it("getUserWithPerson returns the self person, so 'me' can resolve", async () => {
      const created = await withTransaction(pool, (tx) =>
        users.ensureUser(tx, { displayName: "Srivaibhav" }),
      );
      const read = await users.getUserWithPerson(pool, created.user.id);
      expect(read).not.toBeNull();
      // The whole point of F3: a real people.id the resolver can short-circuit to.
      expect(read!.self!.id).toBe(created.self!.id);
      expect(read!.user.timezone).toBe("Asia/Kolkata");
    });

    it("getUserWithPerson follows a merge to the survivor, not the merged-away row", async () => {
      // READ SHAPE 2, not 1 (people.ts's header). If the self person is merged,
      // `people_current` returns zero rows and "me" silently stops resolving.
      // This is the single most load-bearing id in the system.
      const { userId, winnerId } = await withTransaction(pool, async (tx) => {
        const bootstrapped = await users.ensureUser(tx, { displayName: "Sri" });
        const winner = await people.createPerson(tx, {
          displayName: "Srivaibhav",
        });
        await people.mergePerson(tx, bootstrapped.self!.id, winner.id);
        return { userId: bootstrapped.user.id, winnerId: winner.id };
      });
      const read = await users.getUserWithPerson(pool, userId);
      expect(read!.self).not.toBeNull();
      expect(read!.self!.id).toBe(winnerId);
    });

    it("returns null for an unknown user — a deployment fault, not a guess", async () => {
      const missing = await users.getUserWithPerson(
        pool,
        "00000000-0000-0000-0000-000000000000",
      );
      expect(missing).toBeNull();
    });

    it("one account per person — the unique index holds", async () => {
      const bootstrapped = await withTransaction(pool, (tx) =>
        users.ensureUser(tx, { displayName: "Sri" }),
      );
      await expect(
        pool.query(`INSERT INTO users (display_name, person_id) VALUES ($1, $2)`, [
          "Impostor",
          bootstrapped.self!.id,
        ]),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // F1 — completion, and the self-join capture that makes undo correct
  // -------------------------------------------------------------------------
  describe("completeCommitment and its inverse (finding F1)", () => {
    async function seed() {
      return withTransaction(pool, async (tx) => {
        const self = await users.ensureUser(tx, { displayName: "Sri" });
        const barkha = await people.createPerson(tx, { displayName: "Barkha" });
        const c = await commitments.createCommitment(tx, {
          ownerId: barkha.id,
          recipientId: self.self!.id,
          objectText: "the article",
          expectedAt: "2026-09-11T18:00:00+05:30",
        });
        return { self, barkha, c };
      });
    }

    it("writes status and completed_at, and CAPTURES the pre-update state", async () => {
      const { c } = await seed();
      const result = await withTransaction(pool, (tx) =>
        commitments.completeCommitment(tx, c.id, {
          status: "completed_late",
          completedAt: "2026-09-11T23:00:00+05:30",
        }),
      );
      // Post-update state on the row itself...
      expect(result.commitment.status).toBe("completed_late");
      expect(result.commitment.completed_at).not.toBeNull();
      // ...but PRE-update state in the captured fields. THIS IS THE WHOLE POINT.
      // `RETURNING *` alone would make previousStatus 'completed_late' — the value
      // just written — and the inverse would restore 'completed_late' instead of
      // 'pending'. Undo would be a no-op that reports success.
      // docs/DECISIONS.md Phase 1 build finding #4, one table over.
      expect(result.previousStatus).toBe("pending");
      expect(result.previousCompletedAt).toBeNull();
    });

    it("uncompleteCommitment restores EXACTLY the captured prior state", async () => {
      const { c } = await seed();
      const done = await withTransaction(pool, (tx) =>
        commitments.completeCommitment(tx, c.id, {
          status: "completed",
          completedAt: "2026-09-11T23:00:00+05:30",
        }),
      );
      await withTransaction(pool, (tx) =>
        commitments.uncompleteCommitment(
          tx,
          c.id,
          done.previousStatus,
          done.previousCompletedAt,
        ),
      );
      const after = await commitments.getById(pool, c.id);
      expect(after!.status).toBe("pending");
      expect(after!.completed_at).toBeNull();
    });

    it("undoing a RE-completion restores the FIRST completion, not 'pending'", async () => {
      // The case a default argument would silently get wrong: complete, undo,
      // re-complete, undo again must restore the CAPTURED state each time. This
      // is why uncompleteCommitment takes both prior values with no defaults,
      // mirroring unmergePerson.
      const { c } = await seed();
      const firstAt = "2026-09-11T20:00:00+05:30";
      const first = await withTransaction(pool, (tx) =>
        commitments.completeCommitment(tx, c.id, {
          status: "completed",
          completedAt: firstAt,
        }),
      );
      // A second completion ON TOP of the first, capturing the first's state.
      const second = await withTransaction(pool, (tx) =>
        commitments.completeCommitment(tx, c.id, {
          status: "completed_late",
          completedAt: "2026-09-12T09:00:00+05:30",
        }),
      );
      expect(second.previousStatus).toBe("completed");
      expect(second.previousCompletedAt).not.toBeNull();

      await withTransaction(pool, (tx) =>
        commitments.uncompleteCommitment(
          tx,
          c.id,
          second.previousStatus,
          second.previousCompletedAt,
        ),
      );
      const after = await commitments.getById(pool, c.id);
      expect(after!.status).toBe("completed");
      // Restored to the FIRST completion's instant, not to NULL.
      expect(after!.completed_at).not.toBeNull();
      expect(new Date(after!.completed_at!).toISOString()).toBe(
        new Date(firstAt).toISOString(),
      );
      void first;
    });

    it("uncomplete leaves the commitment LIVE — it is not an invalidate", async () => {
      const { c } = await seed();
      const done = await withTransaction(pool, (tx) =>
        commitments.completeCommitment(tx, c.id, {
          status: "completed",
          completedAt: new Date(),
        }),
      );
      await withTransaction(pool, (tx) =>
        commitments.uncompleteCommitment(
          tx,
          c.id,
          done.previousStatus,
          done.previousCompletedAt,
        ),
      );
      const after = await commitments.getById(pool, c.id);
      expect(after!.t_invalid).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // §1.4 — partial update, and a closed-allowlist restore
  // -------------------------------------------------------------------------
  describe("updateCommitment and restoreCommitmentFields", () => {
    async function seedOne() {
      return withTransaction(pool, async (tx) => {
        const owner = await people.createPerson(tx, { displayName: "Arun" });
        return commitments.createCommitment(tx, {
          ownerId: owner.id,
          objectText: "the schema",
          expectedAt: "2026-09-11T18:00:00+05:30",
          status: "pending",
        });
      });
    }

    it("updates ONLY the fields present, and captures ONLY their prior values", async () => {
      const c = await seedOne();
      const result = await withTransaction(pool, (tx) =>
        commitments.updateCommitment(tx, c.id, { status: "in_progress" }),
      );
      expect(result.commitment.status).toBe("in_progress");
      // Capturing the whole row would make undo restore fields a DIFFERENT turn
      // had legitimately changed in between (§1.4 constraint 2).
      expect(Object.keys(result.previousFields)).toEqual(["status"]);
      expect(result.previousFields.status).toBe("pending");
      // expected_at was not in the patch, so it is untouched.
      expect(result.commitment.expected_at).not.toBeNull();
    });

    it("restoreCommitmentFields round-trips a JSONB-shaped patch", async () => {
      const c = await seedOne();
      const result = await withTransaction(pool, (tx) =>
        commitments.updateCommitment(tx, c.id, {
          status: "blocked",
          objectText: "the revised schema",
        }),
      );
      // Simulate the action_log round-trip: the inverse patch comes back as JSONB,
      // so instants arrive as STRINGS rather than Dates. That is exactly why
      // restoreCommitmentFields casts.
      const asJsonb = JSON.parse(JSON.stringify(result.previousFields));
      await withTransaction(pool, (tx) =>
        commitments.restoreCommitmentFields(tx, c.id, asJsonb),
      );
      const after = await commitments.getById(pool, c.id);
      expect(after!.status).toBe("pending");
      expect(after!.object_text).toBe("the schema");
    });

    it("restores a nulled expected_at through the JSONB round-trip", async () => {
      const c = await seedOne();
      const result = await withTransaction(pool, (tx) =>
        commitments.updateCommitment(tx, c.id, { expectedAt: null }),
      );
      expect(result.commitment.expected_at).toBeNull();
      const asJsonb = JSON.parse(JSON.stringify(result.previousFields));
      await withTransaction(pool, (tx) =>
        commitments.restoreCommitmentFields(tx, c.id, asJsonb),
      );
      const after = await commitments.getById(pool, c.id);
      expect(after!.expected_at).not.toBeNull();
    });

    it("REJECTS a key outside the allowlist — inverse_patch is untrusted input", async () => {
      // `fields` arrives from action_log.inverse_patch, i.e. JSONB read back from
      // the database. Interpolating a key from there into SQL is injection
      // (.claude/rules/security.md). Loud rejection, never a silent skip.
      const c = await seedOne();
      await expect(
        withTransaction(pool, (tx) =>
          commitments.restoreCommitmentFields(tx, c.id, {
            "t_invalid = now(), object_text": "pwned",
          }),
        ),
      ).rejects.toThrow(/not an updatable commitment field/);
      const after = await commitments.getById(pool, c.id);
      expect(after!.t_invalid).toBeNull();
      expect(after!.object_text).toBe("the schema");
    });

    it("an empty restore is a no-op, not a throw mid-undo", async () => {
      const c = await seedOne();
      await withTransaction(pool, (tx) =>
        commitments.restoreCommitmentFields(tx, c.id, {}),
      );
      const after = await commitments.getById(pool, c.id);
      expect(after!.object_text).toBe("the schema");
    });
  });

  // -------------------------------------------------------------------------
  // §4.1 — the completion-matching candidate read
  // -------------------------------------------------------------------------
  describe("listOpenForOwner", () => {
    it("matches a self-owned commitment whose recipient is NULL", async () => {
      // `=` would make this return nothing: NULL = NULL is NULL, not true. The
      // SQL-level twin of the `?? null` fix in hasHardVeto.
      const owner = await withTransaction(pool, async (tx) => {
        const p = await people.createPerson(tx, { displayName: "Sri" });
        await commitments.createCommitment(tx, {
          ownerId: p.id,
          objectText: "finish the poster",
        });
        return p;
      });
      const open = await commitments.listOpenForOwner(pool, owner.id, null);
      expect(open).toHaveLength(1);
      expect(open[0]!.object_text).toBe("finish the poster");
    });

    it("excludes terminal statuses but KEEPS blocked and waiting", async () => {
      const owner = await withTransaction(pool, async (tx) => {
        const p = await people.createPerson(tx, { displayName: "Arun" });
        for (const [text, status] of [
          ["open one", "pending"],
          ["blocked one", "blocked"],
          ["waiting one", "waiting"],
          ["done one", "completed"],
          ["late one", "completed_late"],
          ["cancelled one", "cancelled"],
          ["superseded one", "superseded"],
        ] as const) {
          await commitments.createCommitment(tx, {
            ownerId: p.id,
            objectText: text,
            status,
          });
        }
        return p;
      });
      const open = await commitments.listOpenForOwner(pool, owner.id, null);
      const texts = open.map((c) => c.object_text).sort();
      // A blocked commitment can absolutely be completed — excluding it would
      // make "I finally sent it" unmatchable.
      expect(texts).toEqual(["blocked one", "open one", "waiting one"]);
    });

    it("excludes an invalidated commitment", async () => {
      const owner = await withTransaction(pool, async (tx) => {
        const p = await people.createPerson(tx, { displayName: "Arun" });
        const c = await commitments.createCommitment(tx, {
          ownerId: p.id,
          objectText: "undone thing",
        });
        await commitments.invalidateCommitment(tx, c.id);
        return p;
      });
      expect(await commitments.listOpenForOwner(pool, owner.id, null)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // F5 — reminders repository and the poller's claim
  // -------------------------------------------------------------------------
  describe("reminders repository (finding F5)", () => {
    const AT = new Date("2026-09-11T11:30:00+05:30");

    async function seedReminder(fireAt: string | null) {
      return withTransaction(pool, (tx) =>
        reminders.createReminder(tx, {
          body: "ask her about the article",
          fireAt,
          sourcePhrase: "at 5",
        }),
      );
    }

    it("claims a reminder whose fire_at has passed", async () => {
      await seedReminder("2026-09-11T11:00:00+05:30");
      const due = await withTransaction(pool, (tx) =>
        reminders.claimDueReminders(tx, AT),
      );
      expect(due).toHaveLength(1);
    });

    it("does NOT claim one that is not yet due", async () => {
      await seedReminder("2026-09-11T12:00:00+05:30");
      const due = await withTransaction(pool, (tx) =>
        reminders.claimDueReminders(tx, AT),
      );
      expect(due).toEqual([]);
    });

    it("does NOT claim a tier-2/3 reminder with a NULL fire_at", async () => {
      // reminders_pending_idx does NOT filter these — its predicate is only
      // (fired_at IS NULL AND t_invalid IS NULL) — so the QUERY must.
      await seedReminder(null);
      const due = await withTransaction(pool, (tx) =>
        reminders.claimDueReminders(tx, AT),
      );
      expect(due).toEqual([]);
    });

    it("does NOT claim an invalidated reminder — a cancelled one stays silent", async () => {
      const r = await seedReminder("2026-09-11T11:00:00+05:30");
      await withTransaction(pool, (tx) =>
        reminders.invalidateReminder(tx, r.id),
      );
      const due = await withTransaction(pool, (tx) =>
        reminders.claimDueReminders(tx, AT),
      );
      expect(due).toEqual([]);
    });

    it("does not fire the same reminder twice — fired_at is the idempotency key", async () => {
      const r = await seedReminder("2026-09-11T11:00:00+05:30");
      const firstPass = await withTransaction(pool, async (tx) => {
        const due = await reminders.claimDueReminders(tx, AT);
        return reminders.markFired(tx, due.map((d) => d.id), AT);
      });
      expect(firstPass).toEqual([r.id]);

      const secondPass = await withTransaction(pool, async (tx) => {
        const due = await reminders.claimDueReminders(tx, AT);
        return reminders.markFired(tx, due.map((d) => d.id), AT);
      });
      expect(secondPass).toEqual([]);
    });

    it("unfireReminder restores the captured prior fired_at", async () => {
      const r = await seedReminder("2026-09-11T11:00:00+05:30");
      await withTransaction(pool, (tx) => reminders.markFired(tx, [r.id], AT));
      await withTransaction(pool, (tx) =>
        reminders.unfireReminder(tx, r.id, null),
      );
      const after = await reminders.getById(pool, r.id);
      expect(after!.fired_at).toBeNull();
    });

    it("markFired on an empty batch touches nothing", async () => {
      const result = await withTransaction(pool, (tx) =>
        reminders.markFired(tx, [], AT),
      );
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // §8 — trace persistence
  // -------------------------------------------------------------------------
  describe("messages repository and trace (§8)", () => {
    it("persists a trace and reads it back as structured JSON", async () => {
      const trace = {
        model: "claude-haiku-4-5",
        stopReason: "end_turn",
        latencyMs: 412,
        usage: { input_tokens: 900, output_tokens: 40 },
        requestId: "req_abc123",
      };
      const m = await withTransaction(pool, (tx) =>
        messages.createMessage(tx, {
          role: "assistant",
          body: "Got it — article marked complete.",
          trace,
          degraded: false,
        }),
      );
      const read = await messages.getById(pool, m.id);
      expect(read!.trace).toEqual(trace);
      expect(read!.degraded).toBe(false);
    });

    it("a non-mutating turn keeps turn_id NULL but still carries its trace", async () => {
      // §8.2: the turns that mutate nothing are exactly the ones worth studying,
      // and they have no action_log row at all — which is WHY trace lives here.
      const m = await withTransaction(pool, (tx) =>
        messages.createMessage(tx, {
          role: "assistant",
          body: "I can't look things up yet.",
          trace: { model: "claude-haiku-4-5", stopReason: "end_turn" },
        }),
      );
      expect(m.turn_id).toBeNull();
      expect(m.trace).not.toBeNull();
    });

    it("a user message carries no trace", async () => {
      const m = await withTransaction(pool, (tx) =>
        messages.createMessage(tx, { role: "user", body: "Barkha gave me it" }),
      );
      expect(m.trace).toBeNull();
      expect(m.degraded).toBeNull();
    });

    it("setTurnId captures the PRE-update turn_id", async () => {
      // §3.2 step 5: the user message is inserted before the turn id exists.
      const m = await withTransaction(pool, (tx) =>
        messages.createMessage(tx, { role: "user", body: "hello" }),
      );
      const turnId = "11111111-1111-1111-1111-111111111111";
      const result = await withTransaction(pool, (tx) =>
        messages.setTurnId(tx, m.id, turnId),
      );
      expect(result.message.turn_id).toBe(turnId);
      expect(result.previousTurnId).toBeNull();
    });

    it("listRecent returns the NEWEST messages, oldest-first", async () => {
      await withTransaction(pool, async (tx) => {
        for (const body of ["one", "two", "three"]) {
          await messages.createMessage(tx, { role: "user", body });
        }
      });
      const recent = await messages.listRecent(pool, 2);
      expect(recent.map((m) => m.body)).toEqual(["two", "three"]);
    });
  });

  // -------------------------------------------------------------------------
  // F4 — commitment notes with provenance
  // -------------------------------------------------------------------------
  describe("commitment_notes (finding F4, spec §20)", () => {
    it("attaches context to a commitment WITH message provenance", async () => {
      const { c, msg } = await withTransaction(pool, async (tx) => {
        const owner = await people.createPerson(tx, { displayName: "Barkha" });
        const c = await commitments.createCommitment(tx, {
          ownerId: owner.id,
          objectText: "the article",
        });
        const msg = await messages.createMessage(tx, {
          role: "user",
          body: "She had a family emergency",
        });
        return { c, msg };
      });
      const note = await withTransaction(pool, (tx) =>
        commitmentNotes.createNote(tx, {
          commitmentId: c.id,
          body: "She had a family emergency",
          sourceMessageId: msg.id,
        }),
      );
      expect(note.source_message_id).toBe(msg.id);
    });

    it("accumulates MANY notes — a column would have overwritten the first", async () => {
      // This is F4's whole argument for a table over a `notes text` column.
      const c = await withTransaction(pool, async (tx) => {
        const owner = await people.createPerson(tx, { displayName: "Barkha" });
        return commitments.createCommitment(tx, {
          ownerId: owner.id,
          objectText: "the article",
        });
      });
      await withTransaction(pool, async (tx) => {
        await commitmentNotes.createNote(tx, {
          commitmentId: c.id,
          body: "family emergency",
        });
        await commitmentNotes.createNote(tx, {
          commitmentId: c.id,
          body: "she will send tomorrow",
        });
      });
      const notes = await commitmentNotes.listByCommitment(pool, c.id);
      expect(notes).toHaveLength(2);
    });

    it("an invalidated note disappears from the list", async () => {
      const c = await withTransaction(pool, async (tx) => {
        const owner = await people.createPerson(tx, { displayName: "Barkha" });
        return commitments.createCommitment(tx, {
          ownerId: owner.id,
          objectText: "the article",
        });
      });
      const note = await withTransaction(pool, (tx) =>
        commitmentNotes.createNote(tx, { commitmentId: c.id, body: "oops" }),
      );
      await withTransaction(pool, (tx) =>
        commitmentNotes.invalidateNote(tx, note.id),
      );
      expect(await commitmentNotes.listByCommitment(pool, c.id)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // §7 — conditional rules, and the early-completion requirement
  // -------------------------------------------------------------------------
  describe("workflows (§7)", () => {
    const FRIDAY = new Date("2026-09-11T18:00:00+05:30");

    async function seedWorkflow(status: "pending" | "completed" = "pending") {
      return withTransaction(pool, async (tx) => {
        const arun = await people.createPerson(tx, { displayName: "Arun" });
        const c = await commitments.createCommitment(tx, {
          ownerId: arun.id,
          objectText: "the schema",
          status,
        });
        const w = await workflows.createWorkflow(tx, {
          conditionKind: "commitment_not_completed",
          subjectCommitmentId: c.id,
          evaluateAt: "2026-09-11T17:00:00+05:30",
          actionKind: "remind",
          actionBody: "chase Arun about the schema",
          sourcePhrase: "if Arun hasn't sent the schema by Friday",
        });
        return { c, w };
      });
    }

    it("claims a workflow whose evaluate_at has passed", async () => {
      await seedWorkflow();
      const due = await withTransaction(pool, (tx) =>
        workflows.claimDueWorkflows(tx, FRIDAY),
      );
      expect(due).toHaveLength(1);
    });

    it("FIRES when the commitment is still open at evaluate_at", async () => {
      const { c } = await seedWorkflow("pending");
      const holds = await workflows.evaluateCondition(
        pool,
        "commitment_not_completed",
        c.id,
      );
      expect(holds).toBe(true);
    });

    it("does NOT fire when the commitment completed EARLY — §7.3, the requirement", async () => {
      // If Arun sent the schema on Wednesday, then on Friday the condition is
      // false and the user is never reminded about something already done.
      const { c } = await seedWorkflow("pending");
      await withTransaction(pool, (tx) =>
        commitments.completeCommitment(tx, c.id, {
          status: "completed",
          completedAt: "2026-09-09T12:00:00+05:30",
        }),
      );
      const holds = await workflows.evaluateCondition(
        pool,
        "commitment_not_completed",
        c.id,
      );
      expect(holds).toBe(false);
    });

    it("does NOT fire when the subject commitment was INVALIDATED", async () => {
      // Zero rows means DO NOT FIRE. Getting this backwards fires a reminder
      // about a commitment that no longer exists — the most confusing possible
      // output (§7.3, path 1).
      const { c } = await seedWorkflow("pending");
      await withTransaction(pool, (tx) =>
        commitments.invalidateCommitment(tx, c.id),
      );
      const holds = await workflows.evaluateCondition(
        pool,
        "commitment_not_completed",
        c.id,
      );
      expect(holds).toBe(false);
    });

    it("an invalidated workflow is never claimed — an undone rule stays silent", async () => {
      const { w } = await seedWorkflow();
      await withTransaction(pool, (tx) =>
        workflows.invalidateWorkflow(tx, w.id),
      );
      const due = await withTransaction(pool, (tx) =>
        workflows.claimDueWorkflows(tx, FRIDAY),
      );
      expect(due).toEqual([]);
    });

    it("evaluated_at is the idempotency key — a second pass claims nothing", async () => {
      const { w } = await seedWorkflow();
      const first = await withTransaction(pool, async (tx) => {
        const due = await workflows.claimDueWorkflows(tx, FRIDAY);
        return workflows.markEvaluated(tx, due.map((d) => d.id), FRIDAY, true);
      });
      expect(first).toEqual([w.id]);
      const second = await withTransaction(pool, (tx) =>
        workflows.claimDueWorkflows(tx, FRIDAY),
      );
      expect(second).toEqual([]);
    });

    it("records a rule that was evaluated and correctly DECLINED", async () => {
      // fired = false, evaluated_at set. That distinction is what makes §28's
      // "why didn't you remind me?" answerable in Phase 4.
      const { w } = await seedWorkflow();
      await withTransaction(pool, (tx) =>
        workflows.markEvaluated(tx, [w.id], FRIDAY, false),
      );
      const after = await workflows.getById(pool, w.id);
      expect(after!.evaluated_at).not.toBeNull();
      expect(after!.fired).toBe(false);
    });
  });
});
