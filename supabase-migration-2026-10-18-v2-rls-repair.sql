-- ============================================================
-- MIGRATION v2 (2026-10-18): definitive RLS repair for
-- profiles / app_config / report_files.
--
-- WHY v2 EXISTS: v1 dropped recursive policies by their known
-- names only ("admin manage profiles", "admins write app
-- config"). If the live project carries a legacy policy under
-- ANY other name (e.g. created in the dashboard, or from an
-- older setup revision), v1 would leave it in place and the
-- 42P17 recursion would persist. v2 therefore removes EVERY
-- policy currently attached to the three tables — discovered
-- by name from pg_policies at run time — and recreates exactly
-- the reviewed set below. It is idempotent: running it twice
-- produces the same result.
--
-- DO NOT RUN until the school project owner has:
--   1. run the inventory queries in SUPABASE-RLS-INVENTORY.md
--      and saved the output (that output IS the before-state);
--   2. backed up the project (Dashboard -> Database -> Backups
--      or a schema+policy dump);
--   3. reviewed this file and the rollback file.
-- This migration changes policies and functions only; it never
-- reads or writes student/report rows.
-- ROLLBACK: supabase-migration-2026-10-18-v2-rls-repair.rollback.sql
-- ============================================================

begin;

-- 0) Helpers: privileged role checks that cannot recurse.
-- SECURITY DEFINER so the function reads public.profiles as
-- its owner, bypassing the very policies being repaired.
-- Locked-down search_path, schema-qualified references, and
-- EXECUTE revoked from PUBLIC and anon.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
  )
$$;
revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- 1) Remove EVERY existing policy on the three tables, by its
-- actual name, whatever it is. This is what makes the repair
-- effective against unknown legacy policies (including FOR ALL
-- policies that also govern SELECT and therefore recurse).
do $$
declare pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'app_config', 'report_files')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- 2) profiles: a signed-in user reads ONLY their own row
-- (the app only ever requests ?id=eq.<own uid>). Only admins
-- may insert/update/delete, via the non-recursive helper, so
-- no user can elevate their own role.
create policy "profiles read own" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles admin insert" on public.profiles
  for insert to authenticated with check (public.is_admin());
create policy "profiles admin update" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "profiles admin delete" on public.profiles
  for delete to authenticated using (public.is_admin());

-- 3) app_config: readable by signed-in staff only (the shared
-- device registry; it is never exposed to anon). The registry
-- may carry the school's shared GitHub repository token by the
-- school's own design decision — treat every staff account as
-- able to read it, and rotate that token if a staff account is
-- compromised. Only admins may write.
create policy "app config staff read" on public.app_config
  for select to authenticated using (public.is_staff());
create policy "app config admin insert" on public.app_config
  for insert to authenticated with check (public.is_admin());
create policy "app config admin update" on public.app_config
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "app config admin delete" on public.app_config
  for delete to authenticated using (public.is_admin());

-- 4) report_files: unchanged in spirit — signed-in staff
-- (profile holders) may read and write report data; anon and
-- authenticated users without a profile row get nothing.
create policy "report files staff read" on public.report_files
  for select to authenticated using (public.is_staff());
create policy "report files staff write" on public.report_files
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

commit;

-- 5) Make PostgREST pick up new functions/policies in its
-- schema cache (supported procedure; fixes PGRST202 for
-- rpc/is_admin and rpc/is_staff if they were created after the
-- cache last loaded).
notify pgrst, 'reload schema';

-- 6) Post-migration inventory (run manually; compare with the
-- before-state saved in step 1 of SUPABASE-RLS-INVENTORY.md):
--   select tablename, policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('profiles','app_config','report_files')
--   order by tablename, policyname;
-- Expected: exactly the 9 policies created above, and no
-- policy whose qual/with_check contains "from public.profiles"
-- outside the two helper functions.
