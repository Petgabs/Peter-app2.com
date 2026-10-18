# Supabase RLS inventory & repair runbook (2026-10-18)

**Status: the production migration has NOT been run.** Publishing SQL in this
GitHub repository does not execute anything in Supabase. GitHub Pages only
serves the website. The live project will keep returning HTTP 500 / 42P17
until a school project owner runs the v2 migration in the Supabase SQL Editor
following this runbook. Nothing in this document requires or contains student
data, passwords, JWTs, service-role keys or GitHub tokens. The app's local
"Admin login" is **not** database-admin access and cannot apply this fix.

## Root cause (what is known, and what is not)

Known from the published history of `supabase-setup.sql`: an earlier revision
created `"admin manage profiles"` on `public.profiles` as a **FOR ALL** policy
whose USING/WITH CHECK contained
`EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')`,
plus `"admins write app config"` on `public.app_config` with the same
self-referencing subquery. A FOR ALL policy also governs SELECT, so every
`GET /rest/v1/profiles` and `GET /rest/v1/app_config` re-entered RLS on
`profiles` and PostgreSQL aborted with **42P17 "infinite recursion detected in
policy for relation 'profiles'"**. Authenticated `report_files` reads kept
working (their policies never referenced `profiles`).

**Unverified assumption:** the exact policy names currently live in the
project are not known from outside. The live project may (a) still run the old
setup unchanged, (b) have a partially applied v1 migration, or (c) carry
legacy policies under different names. Step 1 below resolves this before
anything is changed.

Also observed: `rpc/is_staff` and `rpc/is_admin` return **404 / PGRST202**.
That means the helper functions either do not exist in the live database yet
(expected if no migration was ever applied) or PostgREST's schema cache has
not picked them up. The v2 migration ends with the supported cache-refresh
statement `notify pgrst, 'reload schema';`.

## Step 1 — Read-only inventory (school owner, Supabase SQL Editor)

Run all of these and **save the output** — it is the authoritative
before-state used by the rollback. These inspect metadata only.

```sql
-- Policies on the three tables (names, commands, expressions)
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'app_config', 'report_files')
order by tablename, policyname;

-- RLS enabled? (relrowsecurity must be true for all three)
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relname in ('profiles', 'app_config', 'report_files');

-- Helper functions: definition, owner, SECURITY DEFINER, grants
select p.proname,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       p.proconfig as settings,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('is_admin', 'is_staff');

select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public' and routine_name in ('is_admin', 'is_staff')
order by routine_name, grantee;
```

What to look for: any policy whose `qual` or `with_check` mentions
`FROM public.profiles` / `FROM profiles` (a recursive candidate — especially
any `cmd = ALL` policy on `profiles`), any policy names that do not appear in
the published files, and missing/grant-less helper functions.

## Step 2 — Backup

In the Supabase Dashboard: Database → Backups (or export a schema dump), and
confirm the Step 1 output is saved alongside this runbook. The migration
touches policies and functions only, but the backup is what makes the
rollback real.

## Step 3 — Apply (owner-approved window)

Run `supabase-migration-2026-10-18-v2-rls-repair.sql` in the SQL Editor.
It is idempotent and name-agnostic: it drops **every** policy currently on
`profiles`, `app_config`, `report_files` (by actual name, discovered at run
time), recreates the reviewed set below, defines the helpers with
`SECURITY DEFINER`, `set search_path = public`, schema-qualified references,
EXECUTE revoked from `PUBLIC`/`anon` and granted only to `authenticated`, and
finishes with `notify pgrst, 'reload schema';`.

## Before / after policy & privilege matrix

| Table | Before (legacy, from published history) | After (v2) |
|---|---|---|
| `profiles` SELECT | `true` for all authenticated, **plus recursive FOR ALL policy** | own row only: `id = auth.uid()` |
| `profiles` INSERT/UPDATE/DELETE | recursive `EXISTS(… FROM profiles …)` admin policy | `public.is_admin()` (definer helper) — no self-elevation |
| `app_config` SELECT | `true` for all authenticated (+ recursive write policy present) | staff only: `public.is_staff()`; never anon |
| `app_config` INSERT/UPDATE/DELETE | recursive admin policy | `public.is_admin()` |
| `report_files` SELECT/WRITE | `true` for all authenticated | staff (profile holders) only: `public.is_staff()` — tightened, not weakened |
| anon role | no policies (unchanged) | no policies — receives 401/403 and no rows |
| `is_admin()` / `is_staff()` | absent (PGRST202) or unreliably granted | `SECURITY DEFINER`, `search_path = public`, EXECUTE: `authenticated` only |

Note on `app_config`: by the school's earlier design the shared registry can
carry a shared GitHub repository token readable by signed-in staff devices.
That is **not** public exposure (anon gets nothing), but any staff account can
read it — rotate the token if a staff account is compromised, and do not put
anything more sensitive than that shared token in the registry. No
service-role key must ever be stored there or in site files.

## Step 4 — Verify the live API (status codes only, no payloads needed)

With isolated test accounts (one teacher, one school admin; no real student
edits):

| # | Request | Expected after repair |
|---|---|---|
| 1 | `GET /rest/v1/profiles?id=eq.<own uid>` (teacher & admin) | 200, correct `role`; **no 42P17** |
| 2 | `GET /rest/v1/profiles` (teacher, other users' rows) | 200 with only own row visible |
| 3 | `PATCH /rest/v1/profiles` role change (teacher) | denied (401/403 or 0 rows) |
| 4 | `GET /rest/v1/app_config` (teacher) | 200, **no 42P17** |
| 5 | `POST /rest/v1/app_config` (teacher) | 401/403 |
| 6 | `POST /rest/v1/app_config` (admin) | 201 |
| 7 | `GET /rest/v1/report_files` (teacher) | 200 (unchanged from before) |
| 8 | `GET /rest/v1/report_files` (no JWT / anon key only) | 401/403, no rows |
| 9 | `POST /rest/v1/rpc/is_staff`, `…/is_admin` (authenticated) | 200 boolean; if still PGRST202, functions/grants are missing — re-check Step 1 function inventory; the migration's `notify pgrst, 'reload schema'` should have refreshed the cache |
| 10 | App: sign in → badge healthy only when 1, 4, 7 all pass; "Test connection" fails loudly if any required probe returns non-2xx | pass |
| 11 | App: refresh session, let a session expire, sign out | session restores; expired → clean re-login prompt; sign-out clears local session |

Then re-run the Step 1 policy query and confirm exactly the 9 v2 policies
exist and no policy expression references `public.profiles` outside the two
helper functions.

## Step 5 — Rollback (if verification fails)

1. Run `supabase-migration-2026-10-18-v2-rls-repair.rollback.sql` — restores
   the reviewed PR #15 policy set (recursion-free).
2. If an exact restoration of previously-unknown legacy policies is ever
   required, recreate them from the **saved Step 1 inventory**; that output,
   not this repository, is the record of those definitions. (Restoring the
   legacy set reintroduces 42P17 by design and is only a diagnostic step.)
3. App-side rollback, if ever needed: revert the merge commit of the
   corresponding PR on GitHub; Pages redeploys automatically.

## Regression coverage in this repository

`tests/smoke.mjs` (jsdom, synthetic accounts only): 42P17 profile/app_config
failures keep the user teacher-level with a "Cloud: error" badge and no fatal
banner; the repaired happy path returns the correct role; and the "Test
connection" honesty section proves `app_config` HTTP 500 and `profiles`
HTTP 500 both make the test **fail with a pointer to this migration** instead
of claiming the database is fully set up.

## Unverified assumptions (explicit)

- The live policy inventory is unknown until Step 1 is run by the owner;
  policy names quoted above come from this repository's published history.
- Whether any real account's `profiles.role` is `admin` cannot be known
  until profiles are readable again — do not assume the test account is one.
- Sandbox tooling used for this repair cannot reach the live Supabase
  project, so no live HTTP status in this document was re-measured here;
  Step 4 is the school's verification record to fill in.
