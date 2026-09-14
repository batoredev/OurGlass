/**
 * The §29 read surfaces (docs/PHASE-5-DESIGN.md §2.2), resolving finding F14.
 *
 * Before this the API had three routes — /health, /turn, /undo — and none of
 * them served data. The web app could not render tables that nothing
 * returned.
 *
 * ┌─ EVERY ROUTE HERE IS A GET, AND THAT IS ARCHITECTURE, NOT STYLE ───────┐
 * │ There is NO mutation endpoint in this file and there must never be     │
 * │ one. Every write goes through /turn and the validated tool layer       │
 * │ (spec §37). A `POST /api/commitments` would be a second write path     │
 * │ around that layer — and once a UI exists it is the obvious shortcut,   │
 * │ which is exactly why the prohibition is written down AND asserted by a │
 * │ test that enumerates the registered routes.                            │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * GUARDED LIKE THE DEMO ENDPOINT, for the same reason: these serve personal
 * data over HTTP with no authentication, because Phase 7 owns the permission
 * model (§35). They register only behind the same flag, and the server binds
 * loopback when it is on.
 */
import type { FastifyInstance } from "fastify";
import type { DatabaseTransaction } from "@ourglass/shared";
import { commitments, entityRecords, events, memories, people, projects } from "@ourglass/db";
import { listRecentActivity } from "../tools/executor.js";

export interface ReadRouteDeps {
  readonly db: {
    withTransaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
  };
}

/**
 * Every route path this module registers.
 *
 * Exported so a test can assert the set is exactly this and every one is GET
 * — see the header. A future `POST /api/commitments` then fails a test
 * instead of quietly becoming a second write path around the tool layer.
 */
export const READ_ROUTES = [
  "/api/entity-types",
  "/api/entity-types/:key/records",
  "/api/commitments",
  "/api/people",
  "/api/projects",
  "/api/memories",
  "/api/activity",
  "/api/today",
] as const;

export function registerReadRoutes(app: FastifyInstance, deps: ReadRouteDeps): void {
  const read = <T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> =>
    deps.db.withTransaction(fn);

  // ---- The dynamic registry (the user's explicit requirement) -------------
  //
  // This is what lets the frontend hold NO hardcoded list of entity types: it
  // fetches the registry and renders from `field_kind`, so a type defined
  // thirty seconds ago appears on the next page load with no deploy.
  app.get("/api/entity-types", async () => {
    const types = await read((tx) => entityRecords.listTypes(tx));
    return { types };
  });

  app.get<{ Params: { key: string } }>("/api/entity-types/:key/records", async (request, reply) => {
    const { key } = request.params;
    const type = await read((tx) => entityRecords.getTypeByKey(tx, key));
    if (!type) {
      // 404 rather than an empty list: "this type does not exist" and "this
      // type has no records yet" are different answers, and a UI that cannot
      // tell them apart shows an empty table for a typo'd URL.
      return reply.code(404).send({ error: `No entity type "${key}".` });
    }
    const records = await read((tx) => entityRecords.listRecords(tx, key));
    return { type, records };
  });

  // ---- The §29 surfaces ---------------------------------------------------

  app.get("/api/commitments", async () => {
    const rows = await read((tx) => commitments.listCurrent(tx));
    return { commitments: rows };
  });

  app.get("/api/people", async () => {
    const rows = await read((tx) => people.list(tx));
    return { people: rows };
  });

  app.get("/api/projects", async () => {
    const rows = await read((tx) => projects.list(tx));
    return { projects: rows };
  });

  app.get("/api/memories", async () => {
    // §28's "inspect and correct what the assistant believes" is impossible
    // until the memories are visible at all.
    const rows = await read((tx) => memories.listAll(tx));
    return { memories: rows };
  });

  app.get("/api/activity", async () => {
    // action_log — every mutation with its inverse. This is what makes "undo
    // that" inspectable rather than merely promised.
    const rows = await read((tx) => listRecentActivity(tx));
    return { activity: rows };
  });

  app.get("/api/today", async () => {
    // Assembled from existing reads rather than a new SQL view: "today" is a
    // presentation concept, and baking it into a view would freeze a
    // definition the UI should stay free to change.
    const now = new Date();
    const open = await read((tx) => commitments.listCurrent(tx));
    const upcoming = await read((tx) => events.listUpcoming(tx, now, 20));
    const pending = open.filter((row) => !commitments.isTerminalStatus(row.status));
    return {
      overdue: pending.filter(
        (row) => row.expected_at !== null && row.expected_at.getTime() < now.getTime(),
      ),
      dueLater: pending.filter(
        (row) => row.expected_at !== null && row.expected_at.getTime() >= now.getTime(),
      ),
      undated: pending.filter((row) => row.expected_at === null),
      events: upcoming,
    };
  });
}
