/**
 * POST /api/turn — the conversational entry point, as a Route Handler.
 *
 * This replaces Fastify's `/turn` (docs/DEPLOYMENT-DESIGN.md §1). Cloudflare
 * Workers are V8 isolates that handle a request and terminate; Fastify
 * expects a persistent server owning a socket, which is an architecture
 * mismatch no polyfill fixes.
 *
 * ┌─ WHAT THIS FILE PROVES ────────────────────────────────────────────────┐
 * │ The entire assistant stack — orchestrator, resolver, tool layer,       │
 * │ repositories — moves runtimes with NO change. Everything below is a    │
 * │ thin adapter: parse a body, call `runTurn`, return JSON. That is all   │
 * │ `server.ts` ever was.                                                  │
 * │                                                                        │
 * │ It works because PHASE-1-DESIGN §5 put the repositories behind         │
 * │ framework-agnostic interfaces (`Queryable`, `DatabaseTransaction`) for │
 * │ TESTABILITY. That decision is what makes the code portable to a        │
 * │ runtime nobody had considered when it was made.                        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * SERVER-ONLY. Route Handlers never ship to the browser, so importing a
 * Postgres driver here is correct — unlike in a client component, where it
 * would pull `pg` into the bundle. `lib/render-value.tsx`'s note about not
 * importing `@ourglass/db` applies to CLIENT code specifically.
 */
import { NextResponse } from "next/server";
import { UnknownUserError, runTurn } from "@ourglass/api/assistant";
import {
  NoProviderConfiguredError,
  RoutedExtractor,
  RoutedResponder,
  buildAIRouter,
} from "@ourglass/api/ai";
import { buildToolRegistry } from "@ourglass/api/tools";
import { createPool, users, withTransaction } from "@ourglass/db";
import type { DatabaseTransaction } from "@ourglass/shared";

// Node runtime, not Edge. `pg` needs `nodejs_compat`, which the Cloudflare
// adapter supplies for the Node runtime; the Edge runtime has no TCP sockets.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One pool per isolate, created lazily.
 *
 * A Worker isolate handles many requests, so building a pool per request
 * would open a connection per turn and exhaust Supabase's limit under any
 * real load. Module scope is the isolate's lifetime, which is exactly the
 * scope a pool wants.
 */
// Typed from createPool rather than importing `pg` — this package has no
// Postgres dependency of its own, and adding one for a type would blur a
// boundary that is otherwise clean.
type Pool = ReturnType<typeof createPool>;

let pool: Pool | null = null;
let bootstrapUserId: string | null = null;

function getPool(): Pool {
  if (!pool) {
    const url = process.env["DATABASE_URL"];
    if (!url) throw new Error("DATABASE_URL is required");
    pool = createPool(url);
  }
  return pool;
}

const db = {
  withTransaction: <T>(fn: (tx: DatabaseTransaction) => Promise<T>) =>
    withTransaction(getPool(), fn),
};

/**
 * The bootstrap user, resolved once and cached.
 *
 * `runTurn` needs a user id for the timezone and the first-person
 * short-circuit (§3.2.1). A missing user row is a DEPLOYMENT fault, not a
 * conversational one, so it must fail loudly rather than defaulting a
 * timezone and producing replies that are silently hours wrong.
 */
async function getUserId(): Promise<string> {
  if (!bootstrapUserId) {
    const account = await db.withTransaction((tx) => users.ensureUser(tx, { displayName: "You" }));
    bootstrapUserId = account.user.id;
  }
  return bootstrapUserId;
}

export async function POST(request: Request) {
  // Same guard as the Fastify demo endpoint, for the same reason: this spends
  // model tokens on whatever it is sent and has no authentication until
  // Phase 7 owns the permission model (§35). A route that refuses by default
  // is a stronger guarantee than one that checks a flag it might forget.
  if (process.env["ENABLE_DEMO_ENDPOINT"] !== "true") {
    return NextResponse.json({ error: "Not enabled." }, { status: 404 });
  }


  let body: { utterance?: unknown };
  try {
    body = (await request.json()) as { utterance?: unknown };
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (typeof body.utterance !== "string" || body.utterance.trim() === "") {
    return NextResponse.json({ error: "utterance must be a non-empty string" }, { status: 400 });
  }

  // ONE ROUTER, built from the environment. The provider chain, its order, the
  // timeout and the retry budget are configuration now — this file knows only
  // that something can interpret and something can respond.
  //
  // Built per request rather than cached per isolate, deliberately: it is a
  // few object allocations, and caching would mean a rotated key needs a
  // redeploy to take effect.
  let router;
  try {
    router = buildAIRouter(process.env, {
      // §21. One structured line per attempt, carrying no key and no
      // utterance — Workers Logs is a different retention story from
      // `messages`, where the body already lives with its own provenance.
      onLog: (record) => {
        console.log(JSON.stringify({ event: "ai_request", ...record }));
      },
    });
  } catch (error: unknown) {
    if (error instanceof NoProviderConfiguredError) {
      // Named at the boundary rather than surfacing as a generic 500 after
      // the user has already typed a sentence.
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    throw error;
  }

  try {
    const result = await runTurn(
      { utterance: body.utterance, userId: await getUserId() },
      {
        db,
        registry: buildToolRegistry(),
        extractor: new RoutedExtractor(router),
        responder: new RoutedResponder(router),
      },
    );
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof UnknownUserError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    throw error;
  }
}
