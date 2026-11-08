# Planned: four separate accounts

**Status: agreed in outline 2026-11-08, NOT STARTED.** The owner will say when to build it. Until
then OurGlass stays single-user (one shared `OURGLASS_ACCESS_TOKEN`, one set of data).

## What the owner asked for

Four logins, **completely separate from each other**:

| Login | Starts with |
|---|---|
| `test` | the current data (the demo / test data in Supabase today) |
| `adharsh` | nothing — a new, empty account |
| `srinivaas` | nothing |
| `arjun` | nothing |

- Each person has their own password and **can change it themselves**.
- No account can see, search, change, undo, export or delete anything of another: people,
  commitments, memories, messages, files, meetings, summaries, the activity log, Google
  connections.
- The Supabase changes are part of the job (database, secrets, deploy steps), handed to the owner
  as web-only steps like the earlier ones (SQL Editor script, Edge Functions zip, secrets list).

## The design agreed in outline

1. **One private part of the database per account** — a Postgres schema each (`acct_test`,
   `acct_adharsh`, `acct_srinivaas`, `acct_arjun`), each with the full set of tables.
   - Every request runs inside its account's schema (`SET LOCAL search_path` in the
     transaction). The app's queries do not name a schema, so they cannot reach another
     account's tables even if a check is forgotten.
   - A database role per account, with rights only on its own schema, as a second lock.
   - Rejected: an owner column on all ~25 tables. One missed filter in hundreds of queries
     would leak data between people.
   - The current data moves into `acct_test`; migrations then run per schema.
2. **Accounts instead of the shared token.**
   - A small accounts table outside the four schemas: username, a PBKDF2 password hash (never
     the password), which schema.
   - Sign-in returns a session tied to the account; repeated wrong passwords are slowed down.
   - **Change password** in Settings: needs the current password, signs out the account's
     other sessions.
   - First passwords: a one-time SQL script the owner runs creates the accounts and shows each
     first password once; each person changes it at first sign-in.
   - A new secret `SESSION_SECRET`; `OURGLASS_ACCESS_TOKEN` is retired.
3. **Everything else per account.**
   - The reminders job loops over all four schemas.
   - Morning and evening summaries go to each account.
   - Files are stored under the account's own folder; "Delete all my data" only touches its own.
   - Each person connects their own Google account.
   - The message limits (10 a minute, 200 a day) apply per person.
   - The AI keys are shared, on one bill.
4. **Proof before merge:** tests that one account cannot read, write, undo, export or delete
   another's data, run against Postgres in CI.

## Questions still open (ask the owner before building)

1. Is **all** the current Supabase data test data, or is some of it real data of one of the three?
2. A forgotten password reset by a one-line SQL command run by the owner — enough, or is an email
   reset needed (that needs an email sender)?
3. Plain usernames (`adharsh`, `srinivaas`, `arjun`, `test`) or email addresses?
4. Should anyone be able to reset others' passwords from inside the app, or only via Supabase?
