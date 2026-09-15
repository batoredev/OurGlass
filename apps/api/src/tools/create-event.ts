/**
 * create_event — the tool the `events` table never had.
 *
 * ================================ READ THIS ================================
 * `events` has existed since Phase 1, with a repository, a `findOverlapping`
 * query, and `listUpcoming` powering the Today surface. NOTHING EVER WROTE TO
 * IT from a conversation.
 *
 * That made §24 conflict detection structurally unreachable: `detectTimeConflicts`
 * was built, unit-tested and correct, and it queried a table that could only
 * ever be empty. The Phase 4 demo — "Schedule Arun at 5 tomorrow" surfaces the
 * Hult conflict — could not fire, because nothing could put the Hult review
 * there in the first place.
 *
 * Another instance of the recorded "schema with no code path" class, and the
 * largest: a whole table, its repository, and a detector downstream of it.
 * ===========================================================================
 *
 * THIS IS AN INTERNAL EVENT, NOT A CALENDAR EVENT. It writes a row in our own
 * `events` table and reaches no external service. Google Calendar is §34 and
 * Phase 7, behind the permission model — "Create a calendar event" stays an
 * `execution` intent and is still honestly declined.
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { events } from "@ourglass/db";
import { registerInverseHandler } from "./inverses.js";

export interface CreateEventRawInput {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly starts_at?: unknown;
  readonly ends_at?: unknown;
  readonly location?: unknown;
  readonly notes?: unknown;
}

export interface CreateEventInput {
  readonly id: string | null;
  readonly title: string;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly location: string | null;
  readonly notes: string | null;
}

export interface CreateEventOutput {
  readonly id: string;
  readonly title: string;
  readonly startsAt: string | null;
}

/** create_event's inverse shape — invalidate the row it created. */
export interface CreateEventInversePatch {
  readonly id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** An ISO-8601 instant, or null. Never natural language — chrono resolves that. */
function readInstant(value: unknown, field: string, errors: ToolError[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    errors.push({
      field,
      code: "invalid_instant",
      // DECISIONS.md #4: the model never computes a timestamp. If a phrase
      // reaches this tool, the resolution step upstream was skipped.
      message: `${field} must be a resolved ISO-8601 timestamp, never natural language.`,
    });
    return null;
  }
  return value;
}

function readOptionalText(value: unknown, field: string, errors: ToolError[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    errors.push({ field, code: "invalid_text", message: `${field} must be a string, or omitted.` });
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function validate(raw: unknown): Promise<Result<CreateEventInput, ToolError[]>> {
  const errors: ToolError[] = [];
  const input = (raw ?? {}) as CreateEventRawInput;

  if (typeof input.title !== "string" || input.title.trim() === "") {
    errors.push({
      field: "title",
      code: "missing_title",
      message: "title is required and must be a non-empty string.",
    });
  }
  if (input.id !== undefined && input.id !== null && !isUuid(input.id)) {
    errors.push({ field: "id", code: "invalid_uuid", message: "id must be a UUID, or omitted." });
  }

  const startsAt = readInstant(input.starts_at, "starts_at", errors);
  const endsAt = readInstant(input.ends_at, "ends_at", errors);
  const location = readOptionalText(input.location, "location", errors);
  const notes = readOptionalText(input.notes, "notes", errors);

  // An end before its start is not a scheduling preference, it is a bug
  // upstream — and `findOverlapping` would silently never match such a row,
  // so the conflict detector would go quiet rather than loud.
  if (startsAt !== null && endsAt !== null && Date.parse(endsAt) < Date.parse(startsAt)) {
    errors.push({
      field: "ends_at",
      code: "ends_before_starts",
      message: "ends_at must not be earlier than starts_at.",
    });
  }

  if (errors.length > 0) return err(errors);

  return ok({
    id: isUuid(input.id) ? input.id : null,
    title: (input.title as string).trim(),
    startsAt,
    endsAt,
    location,
    notes,
  });
}

async function commit(
  input: CreateEventInput,
  ctx: ToolContext,
): Promise<{ output: CreateEventOutput; mutations: readonly LoggedMutation[] }> {
  const row = await events.createEvent(ctx.tx, {
    id: input.id,
    title: input.title,
    startsAt: input.startsAt === null ? null : new Date(input.startsAt),
    endsAt: input.endsAt === null ? null : new Date(input.endsAt),
    location: input.location,
    notes: input.notes,
    projectId: null,
  });

  return {
    output: {
      id: row.id,
      title: row.title,
      startsAt: row.starts_at === null ? null : row.starts_at.toISOString(),
    },
    mutations: [
      {
        targetTable: "events",
        targetId: row.id,
        forwardPatch: {
          title: row.title,
          startsAt: row.starts_at === null ? null : row.starts_at.toISOString(),
        },
        inversePatch: { id: row.id } satisfies CreateEventInversePatch,
        invertibility: "full",
      },
    ],
  };
}

export const createEventTool: ToolDefinition<CreateEventInput, CreateEventOutput> = {
  name: "create_event",
  description:
    "Schedule an internal event: a meeting or appointment at a resolved time. " +
    "starts_at and ends_at must be ISO-8601 instants, never natural language. " +
    "This does NOT touch an external calendar.",
  validate,
  commit,
};

// ---------------------------------------------------------------------------
// The inverse. INVALIDATE, never DELETE — the bitemporal rule holds here as
// everywhere else, so an undone event keeps its row with t_invalid set and
// stops appearing in `events_current`.
// ---------------------------------------------------------------------------
registerInverseHandler("events", async (tx, targetId, inversePatch) => {
  if (!targetId) return;
  if (inversePatch === null || typeof inversePatch !== "object" || !("id" in inversePatch)) {
    throw new Error(
      `Unrecognized events inverse_patch for target ${targetId}: ${JSON.stringify(inversePatch)}`,
    );
  }
  await events.invalidateEvent(tx, targetId);
});

export { validate as validateCreateEvent };
