/**
 * The read-only API client (docs/PHASE-5-DESIGN.md §2.2), resolving F15.
 *
 * Before this, `apps/web` had no data path at all — its only link to the rest
 * of the system was one imported constant.
 *
 * ┌─ THERE IS NO WRITE FUNCTION HERE, AND THERE MUST NEVER BE ONE ─────────┐
 * │ Every mutation goes through the assistant's /turn endpoint and the     │
 * │ validated tool layer (spec §37). A `createCommitment()` helper in this │
 * │ file would be the first step toward a second write path that bypasses  │
 * │ validation, action_log, and undo — and the API has no endpoint to back │
 * │ it anyway (asserted by apps/api's read.test.ts).                       │
 * │                                                                        │
 * │ The UI is an INSPECTION surface. You change state by talking to the    │
 * │ assistant, which is the product thesis, not a limitation.              │
 * └────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Mirrors the `field_kind` Postgres enum and packages/db's `FieldKind`.
 *
 * Declared here rather than imported from `@ourglass/db` because this package
 * must not depend on a Postgres driver — `apps/web` runs in a browser. Same
 * boundary reasoning as `packages/shared` (PHASE-1-DESIGN §5). The two
 * declarations are checked against each other by a test rather than trusted.
 */
export type FieldKind = "text" | "number" | "bool" | "date" | "enum" | "person_ref";

export interface EnumOption {
  readonly value: string;
  readonly label: string;
}

export interface EntityTypeField {
  readonly field_key: string;
  readonly field_kind: FieldKind;
  readonly label: string;
  readonly required: boolean;
  readonly ordinal: number;
  readonly enum_options: readonly EnumOption[] | null;
}

export interface EntityTypeWithFields {
  readonly id: string;
  readonly type_key: string;
  readonly display_name: string;
  readonly current_version: number;
  readonly fields: readonly EntityTypeField[];
}

export interface EntityRecord {
  readonly id: string;
  readonly entity_type_id: string;
  readonly schema_version: number;
  readonly payload: Record<string, unknown>;
  readonly t_created: string;
}

export interface Commitment {
  readonly id: string;
  readonly object_text: string;
  readonly status: string;
  readonly expected_at: string | null;
  readonly owner_id: string;
  readonly recipient_id: string | null;
}

export interface Person {
  readonly id: string;
  readonly display_name: string;
}

export interface Project {
  readonly id: string;
  readonly name: string;
}

export interface Memory {
  readonly id: string;
  readonly kind: string;
  readonly body: string;
  readonly inference_level: string;
  readonly t_created: string;
}

export interface ActivityEntry {
  readonly id: string;
  readonly turnId: string;
  readonly seq: number;
  readonly toolName: string;
  readonly actorKind: string;
  readonly targetTable: string;
  readonly createdAt: string;
}

export interface TodayEvent {
  readonly id: string;
  readonly title: string;
  readonly starts_at: string;
}

export interface Today {
  readonly overdue: readonly Commitment[];
  readonly dueLater: readonly Commitment[];
  readonly undated: readonly Commitment[];
  readonly events: readonly TodayEvent[];
}

/** §35 — mirrors packages/db's PermissionGrant as serialised by the route. */
export interface PermissionGrant {
  readonly id: string;
  readonly action_type: string;
  readonly decision: "allow" | "confirm";
  readonly t_valid: string;
}

export interface PendingAction {
  readonly id: string;
  readonly risk_level: string;
  readonly summary: string;
  readonly status: "pending" | "executed" | "declined" | "failed";
  readonly expires_at: string;
  readonly decided_at: string | null;
  readonly t_created: string;
}

export interface ActionType {
  readonly name: string;
  readonly risk: string;
}

export interface Permissions {
  readonly grants: readonly PermissionGrant[];
  readonly pending: readonly PendingAction[];
  readonly actionTypes: readonly ActionType[];
}

/**
 * SAME-ORIGIN by default.
 *
 * The API now lives in this app's own Route Handlers (docs/
 * DEPLOYMENT-DESIGN.md §1), so there is no second host to point at — one
 * Cloudflare Worker serves the UI and the API, which is also why there is no
 * CORS configuration anywhere.
 *
 * Server components fetch during render, where a relative URL has no origin
 * to resolve against, so an absolute base is still needed there. In the
 * browser it stays empty and the path is relative.
 */
const API_BASE =
  process.env["NEXT_PUBLIC_API_URL"] ??
  (typeof window === "undefined" ? "http://localhost:3000" : "");

/**
 * The incoming request's credentials, for a server component's fetch.
 *
 * Server components render by calling this app's own API over HTTP. That call
 * starts on the SERVER, so the browser's session cookie is not attached to it
 * automatically — without forwarding, every page would render "Not signed in"
 * for a signed-in user. In the browser there is nothing to forward: the
 * request is same-origin and carries the cookie itself.
 */
async function forwardedCredentials(): Promise<Record<string, string>> {
  if (typeof window !== "undefined") return {};
  try {
    const { headers } = await import("next/headers");
    const incoming = await headers();
    const forwarded: Record<string, string> = {};
    const cookie = incoming.get("cookie");
    const authorization = incoming.get("authorization");
    if (cookie) forwarded["cookie"] = cookie;
    if (authorization) forwarded["authorization"] = authorization;
    return forwarded;
  } catch {
    // Outside a request (a build step): nothing to forward.
    return {};
  }
}

/**
 * One fetch, with the failure mode named rather than swallowed.
 *
 * The API's read routes register only behind the demo flag, so the
 * overwhelmingly likely failure in development is a 404 from a server started
 * without `ENABLE_DEMO_ENDPOINT=true`. Returning an empty array there would
 * render an empty table and the user would conclude their data was gone —
 * the exact confusion the API's own 404-vs-empty distinction exists to
 * prevent. So this THROWS, and the surfaces show why.
 */
async function get<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      headers: await forwardedCredentials(),
    });
  } catch (error: unknown) {
    throw new Error(
      `Cannot reach the API at ${API_BASE}. Is it running? ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }

  if (response.status === 401) {
    throw new Error("Not signed in. Sign in at /login with the deployment's access token.");
  }
  if (response.status === 404) {
    throw new Error(
      `${path} returned 404. The API is closed: set OURGLASS_ACCESS_TOKEN (or, for local ` +
        `development only, ENABLE_DEMO_ENDPOINT=true).`,
    );
  }
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}.`);
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// The dynamic registry — the user's explicit requirement
// ---------------------------------------------------------------------------

/**
 * THE CALL THAT MAKES THE UI SCHEMA-DRIVEN.
 *
 * There is deliberately no hardcoded list of entity types anywhere in this
 * app. A type the assistant invented thirty seconds ago arrives here on the
 * next page load and renders from its `field_kind`s — no deploy, no
 * migration, no code change.
 */
export async function fetchEntityTypes(): Promise<readonly EntityTypeWithFields[]> {
  const body = await get<{ types: EntityTypeWithFields[] }>("/api/entity-types");
  return body.types;
}

export async function fetchEntityRecords(
  typeKey: string,
): Promise<{ type: EntityTypeWithFields; records: readonly EntityRecord[] }> {
  return get<{ type: EntityTypeWithFields; records: EntityRecord[] }>(
    `/api/entity-types/${encodeURIComponent(typeKey)}/records`,
  );
}

// ---------------------------------------------------------------------------
// The §29 surfaces
// ---------------------------------------------------------------------------

export async function fetchCommitments(): Promise<readonly Commitment[]> {
  return (await get<{ commitments: Commitment[] }>("/api/commitments")).commitments;
}

export async function fetchPeople(): Promise<readonly Person[]> {
  return (await get<{ people: Person[] }>("/api/people")).people;
}

export async function fetchProjects(): Promise<readonly Project[]> {
  return (await get<{ projects: Project[] }>("/api/projects")).projects;
}

export async function fetchMemories(): Promise<readonly Memory[]> {
  return (await get<{ memories: Memory[] }>("/api/memories")).memories;
}

export async function fetchActivity(): Promise<readonly ActivityEntry[]> {
  return (await get<{ activity: ActivityEntry[] }>("/api/activity")).activity;
}

export async function fetchToday(): Promise<Today> {
  return get<Today>("/api/today");
}

/**
 * §35 — READ ONLY, like everything in this file. Changing a permission or
 * deciding a held action goes through `lib/control.ts`, which exists as a
 * separate module so this one keeps its "no write function" guarantee.
 */
export async function fetchPermissions(): Promise<Permissions> {
  return get<Permissions>("/api/permissions");
}
