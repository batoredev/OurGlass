/**
 * Everything stored about one person, for the person model (ROADMAP Stage 2).
 *
 * READ ONLY, and only the owner's own data: rows this app already holds that
 * refer to the person by id. Nothing is looked up elsewhere — the Machine's
 * world model, over the owner's own data only (docs/reference/THE-MACHINE.md).
 * The derivation (what the rows MEAN, each with its source) lives in
 * apps/api/src/people/profile.ts, where it is unit-tested on fixtures.
 */
import type { Queryable } from "../client.js";

export interface ProfileCommitmentRow {
  id: string;
  owner_id: string | null;
  recipient_id: string | null;
  object_text: string;
  status: string;
  expected_at: Date | null;
  completed_at: Date | null;
  t_created: Date;
}

export interface ProfileMemoryRow {
  id: string;
  kind: "fact" | "preference" | "pattern";
  body: string;
  inference_level: string;
  source_message_id: string | null;
  t_created: Date;
}

export interface ProfileRelationshipRow {
  id: string;
  rel_type: string;
  object_kind: string;
  object_name: string | null;
  inference_level: string;
  t_created: Date;
}

export interface ProfileFileRow {
  document_id: string;
  filename: string;
  t_created: Date;
}

export interface ProfileEmailRow {
  subject: string;
  sent_at: Date;
}

export interface PersonProfileData {
  readonly person: {
    id: string;
    display_name: string;
    email: string | null;
    organization_name: string | null;
    t_created: Date;
  };
  /** The person's id and any duplicate merged into them. */
  readonly ids: readonly string[];
  readonly commitments: readonly ProfileCommitmentRow[];
  readonly memories: readonly ProfileMemoryRow[];
  readonly relationships: readonly ProfileRelationshipRow[];
  readonly files: readonly ProfileFileRow[];
  readonly emails: readonly ProfileEmailRow[];
}

/** Null when there is no current person with this id. */
export async function loadPersonProfile(tx: Queryable, personId: string): Promise<PersonProfileData | null> {
  const head = await tx.query<PersonProfileData["person"]>(
    `SELECT p.id, p.display_name, p.email, o.name AS organization_name, p.t_created
       FROM people_current p
       LEFT JOIN organizations_current o ON o.id = p.organization_id
      WHERE p.id = $1`,
    [personId],
  );
  const person = head.rows[0];
  if (!person) return null;

  const idRows = await tx.query<{ id: string }>(
    `WITH RECURSIVE everyone(id) AS (
       SELECT id FROM people WHERE id = $1
       UNION
       SELECT p.id FROM people p JOIN everyone e ON p.merged_into_id = e.id
     ) SELECT id FROM everyone`,
    [personId],
  );
  const ids = idRows.rows.map((row) => row.id);

  const commitments = await tx.query<ProfileCommitmentRow>(
    `SELECT id, owner_id, recipient_id, object_text, status::text AS status, expected_at, completed_at, t_created
       FROM commitments_current
      WHERE owner_id = ANY($1::uuid[]) OR recipient_id = ANY($1::uuid[])
      ORDER BY t_created`,
    [ids],
  );
  const memories = await tx.query<ProfileMemoryRow>(
    `SELECT id, kind::text AS kind, body, inference_level::text AS inference_level, source_message_id, t_created
       FROM memories_current
      WHERE subject_kind = 'person' AND subject_id = ANY($1::uuid[])
      ORDER BY t_created`,
    [ids],
  );
  const relationships = await tx.query<ProfileRelationshipRow>(
    `SELECT r.id, r.rel_type, r.object_kind, r.inference_level::text AS inference_level, r.t_created,
            COALESCE(o.name, pr.name, pe.display_name) AS object_name
       FROM relationships_current r
       LEFT JOIN organizations_current o ON r.object_kind = 'organization' AND o.id = r.object_id
       LEFT JOIN projects_current pr ON r.object_kind = 'project' AND pr.id = r.object_id
       LEFT JOIN people_current pe ON r.object_kind = 'person' AND pe.id = r.object_id
      WHERE r.subject_id = ANY($1::uuid[])
      ORDER BY r.t_created`,
    [ids],
  );
  const files = await tx.query<ProfileFileRow>(
    `SELECT d.id AS document_id, d.filename, d.t_created
       FROM document_links_current l
       JOIN documents_current d ON d.id = l.document_id
      WHERE l.target_kind = 'person' AND l.target_id = ANY($1::uuid[])
      ORDER BY d.t_created`,
    [ids],
  );
  const emails = await tx.query<ProfileEmailRow>(
    `SELECT subject, sent_at FROM sent_emails WHERE person_id = ANY($1::uuid[]) ORDER BY sent_at`,
    [ids],
  );

  return {
    person,
    ids,
    commitments: commitments.rows,
    memories: memories.rows,
    relationships: relationships.rows,
    files: files.rows,
    emails: emails.rows,
  };
}

/**
 * People with something still open between you and nothing recorded about
 * them since `since` — the weekly review's "quiet for a while" (Stage 5).
 * Interaction here means a commitment, a memory or an email: what this app
 * holds, never anything looked up elsewhere.
 */
export async function quietPeople(
  tx: Queryable,
  since: Date,
  selfPersonId: string,
): Promise<{ id: string; display_name: string; last: Date }[]> {
  const { rows } = await tx.query<{ id: string; display_name: string; last: Date }>(
    `WITH open_with AS (
       SELECT CASE WHEN owner_id = $2 THEN recipient_id ELSE owner_id END AS person_id
         FROM commitments_current
        WHERE status IN ('pending', 'in_progress', 'waiting', 'waiting_on_someone', 'blocked')
          AND (owner_id = $2 OR recipient_id = $2)
     ),
     last_seen AS (
       SELECT person_id, max(at) AS last FROM (
         SELECT owner_id AS person_id, t_created AS at FROM commitments_current
         UNION ALL SELECT recipient_id, t_created FROM commitments_current
         UNION ALL SELECT subject_id, t_created FROM memories_current WHERE subject_kind = 'person'
         UNION ALL SELECT person_id, sent_at FROM sent_emails
       ) seen GROUP BY person_id
     )
     SELECT p.id, p.display_name, l.last
       FROM people_current p JOIN last_seen l ON l.person_id = p.id
      WHERE p.id IN (SELECT person_id FROM open_with) AND p.id <> $2 AND l.last < $1
      ORDER BY l.last`,
    [since, selfPersonId],
  );
  return rows;
}
