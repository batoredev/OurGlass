/**
 * Batore Personal Assistant — API entry point.
 *
 * `/health` round-trips through Postgres so CI's integration job and
 * `docker compose up` have a real, non-trivial thing to verify.
 *
 * `POST /turn` and `POST /undo` are the Phase 3 DEMO SURFACE (§9), and they
 * exist because of a real DX defect: there is no UI until Phase 5, so if the
 * only way to see this phase's behaviour is a CI assertion, nobody ever
 * experiences the product. Every judgement in §5 — conversational tone, §31
 * conciseness, §20's optional late prompt — is UNFALSIFIABLE by a test suite.
 * A human has to read the replies.
 *
 * They are a TEST surface, not a product surface, and are guarded as such:
 * off by default, loopback-only when on, and refusing to start without a key.
 */
import Fastify from "fastify";
import pg from "pg";
import type { DatabaseTransaction, HealthCheck } from "@ourglass/shared";
import { withTransaction } from "@ourglass/db";
import { AnthropicExtractor, HaikuResponder, UnknownUserError, runTurn } from "./assistant/index.js";
import { buildToolRegistry, undoTurn } from "./tools/index.js";
import { TurnAlreadyUndoneError, TurnNotFoundError } from "./tools/errors.js";

export interface ServerOptions {
  /**
   * Register POST /turn and POST /undo. OFF unless explicitly enabled — a
   * route that does not exist cannot be reached, which is a stronger
   * guarantee than a route that exists and checks a flag.
   */
  readonly enableDemoEndpoint?: boolean | undefined;
  /**
   * `| undefined` explicitly, not just `?`. `exactOptionalPropertyTypes` is on
   * in this repo, which distinguishes "absent" from "present and undefined" —
   * and `main()` reads these straight out of `process.env`, where a missing
   * variable IS `undefined`. Without this the caller would have to build the
   * object conditionally to say the same thing.
   */
  readonly anthropicApiKey?: string | undefined;
  /** The bootstrap user's id. Required when the demo endpoint is on. */
  readonly demoUserId?: string | undefined;
}

interface TurnBody {
  readonly utterance?: unknown;
}

interface UndoBody {
  readonly turnId?: unknown;
}

export function buildServer(pool: pg.Pool, options: ServerOptions = {}) {
  const app = Fastify({ logger: true });

  app.get("/health", async (): Promise<HealthCheck & { db: boolean }> => {
    const result = await pool.query("SELECT 1 AS ok");
    return { ok: true, service: "api", db: result.rows[0]?.ok === 1 };
  });

  if (!options.enableDemoEndpoint) return app;

  // Fail at STARTUP, not at first request. Discovering a missing key
  // mid-demo, after typing a sentence, is the worst moment to find out.
  const apiKey = options.anthropicApiKey;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required when ENABLE_DEMO_ENDPOINT=true — the demo " +
        "endpoint calls both Sonnet (Interpret) and Haiku (Respond).",
    );
  }
  const userId = options.demoUserId;
  if (!userId) {
    throw new Error(
      "demoUserId is required when the demo endpoint is enabled — run ensureUser first.",
    );
  }

  const deps = {
    db: {
      withTransaction: <T>(fn: (tx: DatabaseTransaction) => Promise<T>) => withTransaction(pool, fn),
    },
    registry: buildToolRegistry(),
    extractor: new AnthropicExtractor({ apiKey }),
    responder: new HaikuResponder({ apiKey }),
  };

  app.post("/turn", async (request, reply) => {
    const body = (request.body ?? {}) as TurnBody;
    if (typeof body.utterance !== "string" || body.utterance.trim() === "") {
      return reply.code(400).send({ error: "utterance must be a non-empty string" });
    }
    try {
      return await runTurn({ utterance: body.utterance, userId }, deps);
    } catch (error: unknown) {
      if (error instanceof UnknownUserError) {
        // A DEPLOYMENT fault, not a conversational one (§3.2.1) — say so
        // rather than returning a plausible-looking reply from a
        // half-provisioned database.
        return reply.code(500).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/undo", async (request, reply) => {
    const body = (request.body ?? {}) as UndoBody;
    if (typeof body.turnId !== "string") {
      return reply.code(400).send({ error: "turnId must be a string" });
    }
    try {
      return await undoTurn(body.turnId, deps);
    } catch (error: unknown) {
      // Both are EXPECTED outcomes with distinct meanings, and collapsing
      // them would hide the more interesting one. TurnNotFound covers "no
      // such turn" AND "that was a scheduled job" — a clock tick is not
      // undoable (§6.3), and the user should be told that plainly.
      if (error instanceof TurnNotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      if (error instanceof TurnAlreadyUndoneError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  return app;
}

async function main() {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new pg.Pool({ connectionString });
  const demo = process.env["ENABLE_DEMO_ENDPOINT"] === "true";

  // The bootstrap user is resolved BEFORE the server is built, so a
  // half-provisioned database fails at startup rather than on the first turn.
  let demoUserId: string | undefined;
  if (demo) {
    const { users } = await import("@ourglass/db");
    const account = await withTransaction(pool, (tx) =>
      users.ensureUser(tx, { displayName: "You" }),
    );
    demoUserId = account.user.id;
  }

  const app = buildServer(pool, {
    enableDemoEndpoint: demo,
    anthropicApiKey: process.env["ANTHROPIC_API_KEY"],
    demoUserId,
  });

  const port = Number(process.env["PORT"] ?? 3001);
  // LOOPBACK WHEN THE DEMO ENDPOINT IS ON. 0.0.0.0 is right for a container
  // and wrong for an unauthenticated endpoint that spends model tokens on
  // whatever it is sent — .claude/rules/security.md treats that input as
  // untrusted, and Phase 7 owns the real permission model (§35). Until then
  // the demo simply is not reachable from off the machine.
  const host = demo ? "127.0.0.1" : "0.0.0.0";
  await app.listen({ port, host });
}

// Only auto-start when run directly (not when imported by tests).
if (process.env["VITEST"] !== "true") {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
