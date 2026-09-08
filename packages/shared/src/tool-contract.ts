/**
 * The tool contract — shared between apps/api's tool registry/executor and
 * (from Phase 2 onward) apps/api/src/assistant, which drives tools from
 * model output. No LLM exists in Phase 1; this file is the interface both
 * sides build against.
 *
 * Spec: docs/PHASE-1-DESIGN.md §4.1.
 *
 * LOAD-BEARING DESIGN CHOICE: `validate` on ToolDefinition is a FUNCTION,
 * not a static schema object. Do not change this to `{ name, schema: ZodType }`
 * with the executor calling `schema.parse()`. A static schema cannot express
 * `define_entity_type`, whose valid inputs depend on rows in `entity_types`
 * that must be queried at call time — the schema literally does not exist
 * until the DB is read. As a function, a dynamic tool queries the DB inside
 * its own `validate` with no special-casing in the executor. Static tools
 * simply close over a Zod (or similar) schema inside their `validate` body.
 *
 * This property is worth keeping even if dynamic entity types are ever
 * withdrawn — it is the better registry design independently
 * (see docs/PHASE-1-DESIGN.md §4.1, final paragraph).
 */

// ---------------------------------------------------------------------------
// Result — a minimal, dependency-free Result type. Not neverthrow/fp-ts:
// this repo has no other functional-programming dependency and one generic
// type does not justify adding one (CLAUDE.md: no new framework without a
// concrete requirement).
// ---------------------------------------------------------------------------

export type Result<TValue, TError> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly errors: TError };

export function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

export function err<TError>(errors: TError): Result<never, TError> {
  return { ok: false, errors };
}

// ---------------------------------------------------------------------------
// actor_kind / invertibility — mirror the Postgres enums exactly
// (docs/PHASE-1-DESIGN.md §2.7). Kept as string literal unions here rather
// than importing from packages/db, per §5's config boundary: packages/db
// takes an explicit connection string and this package must stay free of
// any DB dependency so apps/web can import it too.
// ---------------------------------------------------------------------------

export type ActorKind = "user_turn" | "system_derived" | "scheduled_job" | "undo";

export type Invertibility = "full" | "lossy" | "none";

// ---------------------------------------------------------------------------
// ToolContext — what every tool receives. Tools never open their own
// transaction; they receive ctx.tx (docs/PHASE-1-DESIGN.md §4.2 invariants).
//
// DatabaseTransaction is intentionally a minimal structural interface here,
// not `pg.PoolClient` or `pg.ClientBase` imported directly — packages/shared
// must not depend on `pg` (it is consumed by apps/web too, which has no
// business importing a Postgres driver). apps/api's executor is responsible
// for constructing a value that satisfies this shape from whatever
// packages/db exposes as its transaction handle.
// ---------------------------------------------------------------------------

/**
 * Structurally mirrors `pg.QueryResult<R>` WITHOUT importing `pg` — this
 * package must stay free of a Postgres driver dependency (it is consumed by
 * apps/web too). packages/db's `Queryable.query` returns the real
 * `pg.QueryResult<R>`, which has `command`/`rowCount`/`oid`/`fields` in
 * addition to `rows`; declaring only `{ rows }` here would make
 * `DatabaseTransaction` NOT assignable to `Queryable` (a narrower return
 * type is not a supertype of a wider one), so anything typed as `pg.Pool` /
 * `pg.PoolClient` — which is what packages/db actually hands the executor
 * as `ctx.tx` — would fail to satisfy `ToolContext.tx`. Keep this shape in
 * sync with `pg`'s `QueryResultBase` if that ever changes upstream.
 */
export interface QueryResultLike<TRow = unknown> {
  rows: TRow[];
  command: string;
  rowCount: number | null;
  oid: number;
  // `any[]`, not `unknown[]`: pg's own `FieldDef[]` is a concrete object-array
  // type, and `unknown[]` is not assignable to it (element-type variance).
  // `any[]` is structurally assignable both ways without this package
  // importing `pg` for `FieldDef`. This field carries no data any Phase 1
  // tool reads — its only job is making `DatabaseTransaction` assignable to
  // packages/db's `Queryable`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields: any[];
}

export interface DatabaseTransaction {
  /**
   * Parameterised query only. No raw SQL string interpolation anywhere in a
   * tool's commit() — see .claude/rules/security.md (treat all external
   * input as untrusted) and docs/PHASE-1-DESIGN.md §5 (pg directly with
   * parameterised queries in a thin repository layer, no ORM).
   *
   * `TRow extends Record<string, unknown>` (rather than unconstrained
   * `TRow = unknown`) deliberately mirrors packages/db's
   * `Queryable.query<R extends pg.QueryResultRow>` constraint
   * (`pg.QueryResultRow` is `{ [column: string]: any }`). Generic method
   * signatures are compared including their constraints for assignability,
   * so an unconstrained `TRow` here would make `DatabaseTransaction` NOT
   * assignable to `Queryable` — which breaks passing `ctx.tx` (or a
   * callback typed `(tx: DatabaseTransaction) => ...`) anywhere
   * packages/db's `withTransaction(pool, fn: (tx: Queryable) => ...)` is
   * expected, exactly the case in the integration tests.
   */
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResultLike<TRow>>;
}

/**
 * Test helper: builds a full QueryResultLike from just `rows`, since most
 * fakes only care about rows. Exported from the shared package so every
 * package's tests construct fakes the same way rather than each inventing
 * its own partial shape (which is exactly how the QueryResultLike/plain
 * `{rows}` mismatch happened in the first place).
 */
export function fakeQueryResult<TRow>(rows: TRow[]): QueryResultLike<TRow> {
  return { rows, command: "", rowCount: rows.length, oid: 0, fields: [] };
}

export interface ToolContext {
  /** The open transaction for this turn. Tools never open their own. */
  readonly tx: DatabaseTransaction;
  /** One per orchestrator turn — the action_log grain (§2.7, §4.2). */
  readonly turnId: string;
  /** Order of this tool call within the turn (action_log.seq). */
  readonly seq: number;
  readonly actorKind: ActorKind;
}

// ---------------------------------------------------------------------------
// ToolError — user-facing, no SQL, no stack. Codes are stable strings a
// caller (Phase 2's model loop, or a test) can switch on.
// ---------------------------------------------------------------------------

export interface ToolError {
  readonly field?: string;
  readonly code: string; // e.g. 'unknown_person' | 'unsupported_field_kind' | ...
  readonly message: string;
}

// ---------------------------------------------------------------------------
// LoggedMutation — what a tool's commit() reports back to the executor for
// action_log. The executor appends one action_log row per LoggedMutation,
// stamping turn_id/seq/tool_name/actor_kind itself — a tool never writes to
// action_log directly.
// ---------------------------------------------------------------------------

export interface LoggedMutation {
  readonly targetTable: string;
  readonly targetId: string | null;
  /** What was applied — enough to reconstruct/display the forward change. */
  readonly forwardPatch: unknown;
  /** How to reverse it. Ignored by the executor when invertibility is 'none'. */
  readonly inversePatch: unknown;
  readonly invertibility: Invertibility;
}

// ---------------------------------------------------------------------------
// ToolDefinition — the registry entry. See the module-level note: validate
// is a function, never a static schema object.
// ---------------------------------------------------------------------------

export interface ToolDefinition<TInput, TOutput> {
  readonly name: string;
  readonly description: string;

  /**
   * Validation is a FUNCTION, not a static schema object. Static tools close
   * over a Zod schema and call it here. Dynamic tools (e.g. define_entity_type,
   * or a future tool validating against a runtime-loaded entity_type) query
   * the DB via ctx.tx inside this function and build the check at call time.
   * Same interface either way — no branch in the executor.
   *
   * Must not perform any write. The executor calls validate() for every tool
   * call in a turn before calling commit() on any of them, and rolls back
   * writing nothing at all if any call fails validation.
   */
  validate(raw: unknown, ctx: ToolContext): Promise<Result<TInput, ToolError[]>>;

  /**
   * Perform the mutation(s) using ctx.tx. Must not open a transaction. Must
   * never DELETE — invalidate via t_invalid. Must return an inverse for
   * every mutation, or declare that mutation's invertibility as 'none'
   * rather than logging an inverse that would not actually reverse it.
   */
  commit(
    input: TInput,
    ctx: ToolContext,
  ): Promise<{
    output: TOutput;
    mutations: readonly LoggedMutation[];
  }>;
}

// ---------------------------------------------------------------------------
// Registry-facing helper types used by the executor (apps/api/src/tools).
// Kept here because ai-agent-engineer (Phase 2+, apps/api/src/assistant)
// will also need to describe a ToolCall shape when building calls from
// model output — this is the seam.
// ---------------------------------------------------------------------------

export interface ToolCall {
  readonly name: string;
  readonly input: unknown;
}

export interface TurnResult {
  readonly ok: true;
  readonly turnId: string;
  readonly results: readonly unknown[];
}

export interface TurnFailure {
  readonly ok: false;
  readonly errors: readonly ToolError[];
}

export type ExecuteTurnResult = TurnResult | TurnFailure;

export interface UndoResult {
  readonly undone: number;
}
