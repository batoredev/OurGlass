-- 016 — email: people's addresses, and a record of every email sent (§34).
--
-- ADDITIVE ONLY: one nullable column, one new table.

-- A person's email address, set by set_person_email ("Moorthy's email is …",
-- or typed once into an email draft). Nullable: most people have none yet.
ALTER TABLE people ADD COLUMN email text
  CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- people_current is `SELECT *`, expanded when CREATED (see migration 007's
-- note): recreated so the new column is visible through it.
CREATE OR REPLACE VIEW people_current AS SELECT * FROM people WHERE t_invalid IS NULL;

-- ---------------------------------------------------------------------------
-- sent_emails — what send_email sent, kept for "what did I email Moorthy?".
-- ---------------------------------------------------------------------------
-- Written once, by send_email after Gmail accepts the message. An email cannot
-- be unsent, so this is a log, not state: never invalidated, never undone.
CREATE TABLE sent_emails (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        uuid REFERENCES people(id),
  to_address       text NOT NULL,
  subject          text NOT NULL,
  body             text NOT NULL,
  gmail_message_id text NOT NULL,
  sent_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sent_emails_person_idx ON sent_emails(person_id, sent_at DESC);
