-- 018 — at most one of each brief per day (ROADMAP Stage 5, the proactive loop).
--
-- A brief is an assistant message whose trace carries a key like
-- "morning:2026-11-09". The scheduled pass runs every minute, possibly twice
-- at once; this index is what makes delivery idempotent — the second insert
-- of the same key does nothing (messages.createBriefOnce), whatever the race.
--
-- ADDITIVE: one partial unique index, no new table (so no RLS change; 017
-- covers `messages`).
CREATE UNIQUE INDEX messages_brief_once_idx ON messages ((trace->>'brief'))
  WHERE trace->>'brief' IS NOT NULL;
