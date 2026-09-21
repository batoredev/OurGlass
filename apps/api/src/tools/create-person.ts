/**
 * create_person — designed in Phase 1, referenced by three documents, never built.
 *
 * ================================ READ THIS ================================
 * PHASE-1-DESIGN §3 and DECISIONS.md #5 both specify it: `create_commitment`
 * naming an unknown person FAILS rather than auto-creating, and Resolve emits
 * `create_person` → `create_commitment(owner_id: <new uuid>)` in one turn so
 * undo reverses the pair. The executor's own header cites that sequence as
 * the reason it validates per call.
 *
 * The tool did not exist, so the sequence could not be emitted, and every
 * person the assistant had not met became "Who's Karthik?" — a question it
 * had no way to act on, because answering it produced the same question. The
 * product's thesis is that the user never has to organise anything for the
 * assistant; a new colleague's name was a dead end.
 *
 * Another instance of the recorded "schema with no code path" class: a
 * repository function (`people.createPerson`), a design, and a caller's
 * comment, with no tool between them.
 * ===========================================================================
 *
 * WHO DECIDES THAT A NAME IS A NEW PERSON: Resolve, not this tool. The
 * three-band entity-resolution policy (DECISIONS.md #6) has already rejected
 * every existing candidate before this is called, and the name-shape check
 * that keeps "the plumber" a question lives there too. This tool validates
 * STRUCTURE only — an empty or absurd name is a bug upstream, not a person.
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { people } from "@ourglass/db";
import { registerInverseHandler } from "./inverses.js";

export interface CreatePersonRawInput {
  readonly id?: unknown;
  readonly display_name?: unknown;
}

export interface CreatePersonInput {
  readonly id: string | null;
  readonly displayName: string;
}

export interface CreatePersonOutput {
  readonly id: string;
  readonly displayName: string;
}

/** create_person's inverse shape — invalidate the row it created, if nothing else needs it. */
export interface CreatePersonInversePatch {
  readonly id: string;
}

/** Longer than any real display name; short enough that a pasted paragraph fails loudly. */
export const MAX_DISPLAY_NAME_LENGTH = 80;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Words that are never a new person, whatever Resolve concluded.
 *
 * First-person mentions resolve to the user's own row before scoring
 * (resolve.ts). If one reaches here, the user's person link is missing and
 * creating a person called "me" would be the worst possible repair.
 */
const NEVER_A_NAME = new Set(["me", "i", "myself", "you", "yourself", "we", "us"]);

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

async function validate(raw: unknown): Promise<Result<CreatePersonInput, ToolError[]>> {
  const errors: ToolError[] = [];
  const input = (raw ?? {}) as CreatePersonRawInput;

  const name = typeof input.display_name === "string" ? input.display_name.trim() : "";
  if (name === "") {
    errors.push({
      field: "display_name",
      code: "missing_display_name",
      message: "display_name is required and must be a non-empty string.",
    });
  } else if (name.length > MAX_DISPLAY_NAME_LENGTH) {
    errors.push({
      field: "display_name",
      code: "display_name_too_long",
      message: `display_name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`,
    });
  } else if (NEVER_A_NAME.has(name.toLowerCase())) {
    errors.push({
      field: "display_name",
      code: "not_a_person_name",
      message: `"${name}" refers to a participant in the conversation, not a new person.`,
    });
  } else if (/[\p{Cc}]/u.test(name)) {
    errors.push({
      field: "display_name",
      code: "invalid_characters",
      message: "display_name must not contain control characters.",
    });
  }

  if (input.id !== undefined && input.id !== null && !isUuid(input.id)) {
    errors.push({ field: "id", code: "invalid_uuid", message: "id must be a UUID, or omitted." });
  }

  if (errors.length > 0) return err(errors);
  return ok({ id: isUuid(input.id) ? input.id : null, displayName: name });
}

async function commit(
  input: CreatePersonInput,
  ctx: ToolContext,
): Promise<{ output: CreatePersonOutput; mutations: readonly LoggedMutation[] }> {
  const row = await people.createPerson(ctx.tx, { id: input.id, displayName: input.displayName });

  return {
    output: { id: row.id, displayName: row.display_name },
    mutations: [
      {
        targetTable: "people",
        targetId: row.id,
        forwardPatch: { displayName: row.display_name },
        inversePatch: { id: row.id } satisfies CreatePersonInversePatch,
        invertibility: "full",
      },
    ],
  };
}

export const createPersonTool: ToolDefinition<CreatePersonInput, CreatePersonOutput> = {
  name: "create_person",
  description:
    "Record a person the user has mentioned for the first time. Resolve calls this only " +
    "after entity resolution has rejected every existing person, and only for a mention " +
    "that is a proper name. Never used to rename or merge an existing person.",
  validate,
  commit,
};

// ---------------------------------------------------------------------------
// The inverse. INVALIDATE, never DELETE — and only if nothing else needs them.
//
// undoTurn applies inverses in DESCENDING seq, so the same turn's
// create_commitment has already been invalidated when this runs: anything
// still pointing at the person came from a DIFFERENT turn. Any turn can be
// undone, not only the latest, so that is a real state, and PHASE-1-DESIGN §3
// names it as the reason auto-create was rejected. Invalidating the person
// then would leave live commitments owned by nobody.
//
// So a person who has acquired a life of their own is KEPT. That is the
// conservative direction DECISIONS.md #9 prescribes: a surviving person row is
// visible and harmless; an orphaned commitment silently corrupts the one list
// this product exists to get right.
//
// Idempotent, as undoTurn's re-application-then-rollback path requires: the
// count is a read, and invalidatePerson sets t_invalid via COALESCE.
// ---------------------------------------------------------------------------
registerInverseHandler("people", async (tx, targetId, inversePatch) => {
  if (!targetId) return;
  if (inversePatch === null || typeof inversePatch !== "object" || !("id" in inversePatch)) {
    throw new Error(
      `Unrecognized people inverse_patch for target ${targetId}: ${JSON.stringify(inversePatch)}`,
    );
  }
  if ((await people.countCurrentReferences(tx, targetId)) > 0) return;
  await people.invalidatePerson(tx, targetId);
});

export { validate as validateCreatePerson };
