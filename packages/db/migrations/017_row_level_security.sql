-- 017 — Row Level Security on every table (ROADMAP Stage 0; Phase 6 security review).
--
-- WHY. On Supabase, the Data API (PostgREST) serves the `public` schema to
-- anyone holding the project's publishable key, as the `anon` role. A project
-- old enough to grant `public` tables to `anon` would let that key read
-- `documents.extracted_text`, `messages.body` and every other row. The app
-- never ships that key, which limits exposure; this closes it.
--
-- WHAT. Three layers, each enough on its own:
--   1. RLS ENABLED, NO POLICIES, on every table: a role that is not the
--      table's owner sees no rows and can write none.
--   2. Every view runs with the CALLER's rights (`security_invoker`). A view
--      runs as its owner by default, and the owner bypasses RLS — so without
--      this, `messages_current` would read `messages` for `anon` as if layer 1
--      did not exist. (Postgres 15+; this project runs 17.)
--   3. Where Supabase's `anon` / `authenticated` roles exist, their grants on
--      this schema are revoked outright. (They do not exist in CI or local
--      Postgres, so that step is skipped there.)
--
-- THE APP IS UNAFFECTED. It connects as the role that ran these migrations —
-- the tables' owner — and an owner bypasses RLS unless it is FORCEd, which
-- this does not do. The integration suite runs every query the app makes
-- against the migrated schema, and `rls.integration.test.ts` checks that no
-- table or view is left out — including ones a FUTURE migration adds, which
-- must enable RLS in the same migration that creates them.
--
-- ADDITIVE in effect: no data, column or constraint changes.

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.tablename);
  END LOOP;

  FOR item IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', item.viewname);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
  END IF;
END
$$;
