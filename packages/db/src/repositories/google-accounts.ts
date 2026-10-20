/**
 * google_accounts — the one connected Google account (migration 014).
 *
 * Stores the refresh token ENCRYPTED; this module never sees plaintext.
 * Encryption and the Google calls live in apps/api/src/integrations.
 */
import type { Queryable } from "../client.js";

export interface GoogleAccount {
  id: string;
  email: string | null;
  refresh_token_enc: string;
  scope: string;
  connected_at: Date;
}

export async function get(tx: Queryable): Promise<GoogleAccount | null> {
  const { rows } = await tx.query<GoogleAccount>(`SELECT * FROM google_accounts LIMIT 1`);
  return rows[0] ?? null;
}

/** Connecting again replaces the account (one per installation). */
export async function save(
  tx: Queryable,
  input: { email: string | null; refreshTokenEnc: string; scope: string },
): Promise<void> {
  await tx.query(`DELETE FROM google_accounts`);
  await tx.query(
    `INSERT INTO google_accounts (email, refresh_token_enc, scope) VALUES ($1, $2, $3)`,
    [input.email, input.refreshTokenEnc, input.scope],
  );
}

export async function remove(tx: Queryable): Promise<void> {
  await tx.query(`DELETE FROM google_accounts`);
}
