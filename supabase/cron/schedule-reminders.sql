-- Schedule the `reminders` Edge Function once a minute (pg_cron + pg_net).
--
-- RUN ONCE, BY HAND, in the Supabase SQL Editor, after the function is
-- deployed and CRON_SECRET is set (`supabase secrets set CRON_SECRET=...`).
-- Not a packages/db migration: it carries project-specific values, and
-- `pnpm db:migrate` must stay runnable against any database.
--
-- The URL and the secret go into Supabase Vault, so neither appears in the
-- job's command text (cron.job is readable by anyone with database access).
--
-- Replace the two <...> values before running. CRON_SECRET must be the SAME
-- value given to `supabase secrets set`.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(
  'https://<PROJECT-REF>.supabase.co/functions/v1/reminders',
  'ourglass_reminders_url'
);
select vault.create_secret('<CRON_SECRET>', 'ourglass_cron_secret');

select cron.schedule(
  'ourglass-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ourglass_reminders_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ourglass_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Check it is running (a row per minute, status 'succeeded'):
--   select status, return_message, start_time
--   from cron.job_run_details order by start_time desc limit 5;
-- And what the function answered (expect 200 and {"ok":true}):
--   select status_code, content from net._http_response order by created desc limit 5;
--
-- To stop it:  select cron.unschedule('ourglass-reminders');
