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
import { VoyageClient } from "@ourglass/api/embeddings";
import { buildToolRegistry } from "@ourglass/api/tools";
import { authorize } from "../_auth";
import { rejectCrossSite } from "../_http";
import { rejectOverLimit, turnLimits } from "../_rate-limit";
import { messages, users } from "@ourglass/db";
import { db, read } from "../_lib";

// Node runtime, not Edge. `pg` needs `nodejs_compat`, which the Cloudflare
// adapter supplies for the Node runtime; the Edge runtime has no TCP sockets.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE POOL IS `_lib`'s, not this route's.
 *
 * This file used to carry a byte-identical copy of that singleton, and both
 * copies' comments explained that a pool per request would exhaust Supabase's
 * connection limit — while the two of them together held two pools, each with
 * pg's default max of 10, for twenty connections where ten was intended. Two
 * declarations of one fact, which is this project's most-repeated defect.
 */
let bootstrapUserId: string | null = null;

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
  // This spends model tokens on whatever it is sent and writes to the
  // database, so it is the route an attacker most wants. Access first
  // (PHASE-7-PERMISSIONS-DESIGN §8), then refuse anything a foreign page could
  // have submitted on a signed-in browser's behalf.
  const denied = await authorize(request);
  if (denied) return denied;
  const crossSite = rejectCrossSite(request, { requireJson: true });
  if (crossSite) return crossSite;


  let body: { utterance?: unknown };
  try {
    body = (await request.json()) as { utterance?: unknown };
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (typeof body.utterance !== "string" || body.utterance.trim() === "") {
    return NextResponse.json({ error: "utterance must be a non-empty string" }, { status: 400 });
  }

  // The spend cap (_rate-limit.ts), before anything touches a model. A
  // refused turn writes no message and spends no tokens.
  const limited = await rejectOverLimit(
    (since) => read((tx) => messages.countUserMessagesSince(tx, since)),
    turnLimits(process.env),
  );
  if (limited) return limited;

  // ONE ROUTER, built from the environment. The provider chain, its order, the
  // timeout and the retry budget are configuration now — this file knows only
  // that something can interpret and something can respond.
  //
  // Built per request rather than cached per isolate, deliberately: it is a
  // few object allocations, and caching would mean a rotated key needs a
  // redeploy to take effect.
  // ONE id per turn, shared by Interpret and Respond so a failed turn reads as
  // one story in the log rather than three unrelated lines.
  const requestId = crypto.randomUUID();

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
        extractor: new RoutedExtractor(router, requestId),
        responder: new RoutedResponder(router, requestId),
        // Optional semantic recall. Without a key, recall is lexical-only —
        // the orchestrator treats an absent embedder as a choice, not a fault.
        embedder: process.env["VOYAGE_API_KEY"]
          ? new VoyageClient({ apiKey: process.env["VOYAGE_API_KEY"] })
          : undefined,
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
