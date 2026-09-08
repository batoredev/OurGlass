/**
 * @ourglass/db — schema, migrations, and a thin repository layer over `pg`.
 *
 * No ORM (docs/DECISIONS.md #1): parameterised queries in hand-written SQL. This
 * schema is unusual exactly where a generator would fight it — bitemporal columns
 * applied by a plpgsql helper, a regclass-taking merge resolver, JSONB validated
 * against a runtime registry, and a DEFERRABLE unique index.
 *
 * CONFIG BOUNDARY: this package reads no `process.env`. Pass a connection string.
 *
 * Repositories are exported as NAMESPACES rather than flattened, because three of
 * them export a function called `list` that means "the current rows of MY table".
 * `people.list(tx)` reads correctly; a flattened `listPeople` would invite a fourth
 * caller to write their own.
 */
export { createPool, withTransaction } from "./client.js";
export type { Queryable, Transactable } from "./client.js";

export * as people from "./repositories/people.js";
export * as organizations from "./repositories/organizations.js";
export * as projects from "./repositories/projects.js";
export * as commitments from "./repositories/commitments.js";

export type { Person, CreatePersonInput } from "./repositories/people.js";
export type { Organization } from "./repositories/organizations.js";
export type { Project } from "./repositories/projects.js";
export type {
  Commitment,
  CurrentCommitment,
  CommitmentStatus,
  CreateCommitmentInput,
} from "./repositories/commitments.js";

export { truncateAll, TRUNCATABLE_TABLES } from "./testing/truncate.js";
