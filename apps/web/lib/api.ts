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
import type { DocumentReading } from "@ourglass/shared";
import { apiBase, apiFetch } from "./session";

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

/** One line of Today's checklist (GET /api/today). */
export interface ChecklistItem {
  readonly kind: "commitment" | "meeting" | "reminder";
  readonly id: string;
  readonly title: string;
  /** Who owes it, or "On Google Calendar" — whatever helps read the line. */
  readonly detail: string | null;
  readonly at: string;
  readonly done: boolean;
  readonly status: string | null;
}

export interface Today {
  readonly checklist: readonly ChecklistItem[];
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
 * One fetch, with the failure mode named rather than swallowed.
 *
 * The API is a Supabase Edge Function on its own origin (lib/session.ts says
 * where, and attaches the access token). The overwhelmingly likely failures
 * are not being signed in (401) and an API that is closed (404). Returning an
 * empty array there would render an empty table and the user would conclude
 * their data was gone — so this THROWS, and the surfaces show why.
 */
async function get<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(path);
  } catch (error: unknown) {
    throw new Error(
      `Cannot reach the API at ${apiBase() || "this origin"}. Is it running? ` +
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

/**
 * People AND which of them is the account holder.
 *
 * Ownership direction is the product's differentiator (§7), so a surface that
 * cannot tell "you" from "Barkha" cannot render a commitment honestly.
 */
export async function fetchDirectory(): Promise<{
  readonly people: readonly Person[];
  readonly selfPersonId: string | null;
}> {
  return get<{ people: Person[]; selfPersonId: string | null }>("/api/people");
}

export async function fetchProjects(): Promise<readonly Project[]> {
  return (await get<{ projects: Project[] }>("/api/projects")).projects;
}

/** One saved upload (Phase 6) — `DocumentListItem` in packages/db, as JSON. */
export interface SavedDocument {
  readonly id: string;
  readonly filename: string;
  readonly kind: "pdf" | "docx" | "xlsx" | "text" | "image";
  readonly byte_size: number;
  /** The Read stage's description; null when the file could not be read. */
  readonly reading: DocumentReading | null;
  readonly read_failure: string | null;
  readonly text_truncated: boolean;
  readonly t_created: string;
  readonly links: readonly { readonly kind: string; readonly id: string; readonly name: string }[];
}

export async function fetchDocuments(): Promise<readonly SavedDocument[]> {
  return (await get<{ documents: SavedDocument[] }>("/api/documents")).documents;
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

// ---------------------------------------------------------------------------
// Meetings, Thoughts, Google Calendar
// ---------------------------------------------------------------------------

export interface Meeting {
  readonly id: string;
  readonly title: string;
  readonly starts_at: string;
  readonly ends_at: string | null;
  readonly location: string | null;
  readonly on_google_calendar: boolean;
}

export async function fetchMeetings(): Promise<{ readonly timeZone: string; readonly meetings: readonly Meeting[] }> {
  return get<{ timeZone: string; meetings: Meeting[] }>("/api/meetings");
}

export type ThoughtPriority = "high" | "mid" | "low";

export interface Thought {
  readonly id: string;
  readonly body: string;
  readonly priority: ThoughtPriority;
  readonly created_at: string;
}

export async function fetchThoughts(): Promise<readonly Thought[]> {
  return (await get<{ thoughts: Thought[] }>("/api/thoughts")).thoughts;
}

export interface GoogleStatus {
  /** The server has OAuth credentials. */
  readonly configured: boolean;
  readonly connected: boolean;
  readonly email: string | null;
  /** The connection includes Gmail's send permission. */
  readonly canSendEmail: boolean;
}

/** A held email (GET /api/email-drafts, or a turn's `drafts`). */
export interface EmailDraft {
  readonly pendingActionId: string;
  readonly personId: string | null;
  readonly toName: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export async function fetchEmailDrafts(): Promise<readonly EmailDraft[]> {
  return (await get<{ drafts: EmailDraft[] }>("/api/email-drafts")).drafts;
}

export async function fetchGoogleStatus(): Promise<GoogleStatus> {
  return get<GoogleStatus>("/api/google");
}
