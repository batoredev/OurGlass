-- 015 — checklist_marks: ticking a meeting or reminder on Today's checklist.
--
-- ADDITIVE ONLY. A commitment's tick is its own status (complete_commitment);
-- meetings and reminders have no "done" of their own, so the user's tick is
-- recorded here and OVERRIDES the automatic reading (a meeting is done once it
-- has begun, a reminder once it has fired) — in either direction.
--
-- Bitemporal: a new tick invalidates the previous mark and inserts a new one,
-- so undo restores exactly what was there (set_checklist_mark).

CREATE TABLE checklist_marks (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_kind text NOT NULL CHECK (item_kind IN ('meeting', 'reminder')),
  item_id   uuid NOT NULL,
  done      boolean NOT NULL
);
SELECT add_bitemporal_columns('checklist_marks');

-- One current mark per item.
CREATE UNIQUE INDEX checklist_marks_current_key
  ON checklist_marks(item_kind, item_id)
  WHERE t_invalid IS NULL;
