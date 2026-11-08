-- 019 — how much the owner changed a draft before sending it (ROADMAP Stage 4).
--
-- The measure Stage 4 names for "replies tailored to each person": a draft
-- the owner sends unchanged is a good draft. Words changed between the held
-- draft and what was sent, and the draft's length to read it against. NULL
-- for emails sent before this existed, or sent without a draft card.
--
-- ADDITIVE: two nullable columns.
ALTER TABLE sent_emails
  ADD COLUMN draft_edit_distance integer CHECK (draft_edit_distance IS NULL OR draft_edit_distance >= 0),
  ADD COLUMN draft_words integer CHECK (draft_words IS NULL OR draft_words >= 0);
