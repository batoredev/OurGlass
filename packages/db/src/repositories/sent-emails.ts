/**
 * sent_emails — what send_email sent (migration 016). A log: an email cannot
 * be unsent, so rows are never invalidated.
 */
import type { Queryable } from "../client.js";

export interface SentEmail {
  id: string;
  person_id: string | null;
  to_address: string;
  subject: string;
  body: string;
  gmail_message_id: string;
  sent_at: Date;
}

export async function record(
  tx: Queryable,
  input: { personId: string | null; to: string; subject: string; body: string; gmailMessageId: string },
): Promise<SentEmail> {
  const { rows } = await tx.query<SentEmail>(
    `INSERT INTO sent_emails (person_id, to_address, subject, body, gmail_message_id)
     VALUES ($1::uuid, $2, $3, $4, $5) RETURNING *`,
    [input.personId, input.to, input.subject, input.body, input.gmailMessageId],
  );
  return rows[0]!;
}

export async function listRecent(tx: Queryable, limit = 50): Promise<SentEmail[]> {
  const { rows } = await tx.query<SentEmail>(`SELECT * FROM sent_emails ORDER BY sent_at DESC LIMIT $1`, [limit]);
  return rows;
}
