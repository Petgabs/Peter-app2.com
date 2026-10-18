-- ============================================================
-- MIGRATION 2026-10-18: fix 42P17 "infinite recursion detected
-- in policy for relation 'profiles'" and enforce staff/admin
-- rights in Postgres.
--
-- ROOT CAUSE: the policy "admin manage profiles" on
-- public.profiles, and "admins write app config" on
-- public.app_config, contained
--   EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() ...)
-- Evaluating a policy on profiles that itself SELECTs from
-- profiles re-enters RLS on profiles, which PostgreSQL rejects
-- with SQLSTATE 42P17. Every GET /rest/v1/profiles and
-- GET /rest/v1/app_config therefore returned HTTP 500, the app
-- could not verify roles, and admins silently appeared as
-- teachers while the badge still read "Cloud: school".
--
-- FIX: route every role check through SECURITY DEFINER helper
-- functions (owned by the migration role, fixed search_path,
-- execute revoked from PUBLIC/anon). The helpers read profiles
-- WITHOUT re-entering its policies, so no recursion is possible.
-- No policy is disabled and RLS stays enabled on all tables.
--
-- BEFORE RUNNING: export a backup (Dashboard -> Database ->
-- Backups, or copy the contents of report_files / app_config /
-- profiles). This migration changes policies and functions
-- only; it does not touch data rows.
-- ROLLBACK: supabase-migration-2026-10-18-fix-rls-recursion.rollback.sql
-- ============================================================

begin;

-- 1) Privileged role helpers ---------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
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
  select exists (select 1 from public.profiles p where p.id = auth.uid())
$$;
revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- 2) profiles: own row readable; only admins may write ---------
drop policy if exists "staff read profiles" on public.profiles;
create policy "staff read profiles" on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "admin manage profiles" on public.profiles;
drop policy if exists "admin insert profiles" on public.profiles;
drop policy if exists "admin update profiles" on public.profiles;
drop policy if exists "admin delete profiles" on public.profiles;
create policy "admin insert profiles" on public.profiles
  for insert to authenticated with check (public.is_admin());
create policy "admin update profiles" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin delete profiles" on public.profiles
  for delete to authenticated using (public.is_admin());

-- 3) report_files: staff (profile holders) only --------------
drop policy if exists "staff read report data" on public.report_files;
create policy "staff read report data" on public.report_files
  for select to authenticated using (public.is_staff());

drop policy if exists "staff write report data" on public.report_files;
create policy "staff write report data" on public.report_files
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 4) app_config: staff read, admin write ----------------------
drop policy if exists "admins manage app config" on public.app_config;
drop policy if exists "staff read app config" on public.app_config;
create policy "staff read app config" on public.app_config
  for select to authenticated using (public.is_staff());

drop policy if exists "admins write app config" on public.app_config;
drop policy if exists "admins update app config" on public.app_config;
drop policy if exists "admins delete app config" on public.app_config;
create policy "admins write app config" on public.app_config
  for insert to authenticated with check (public.is_admin());
create policy "admins update app config" on public.app_config
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete app config" on public.app_config
  for delete to authenticated using (public.is_admin());

commit;

-- 5) Verification (run after committing; expect no 42P17) ----
--   As an admin test account:    GET /rest/v1/profiles?select=role  -> 200, role=admin
--   As a teacher test account:   GET /rest/v1/profiles?select=role  -> 200, role=teacher
--   As a teacher test account:   GET /rest/v1/app_config            -> 200
--   As a teacher test account:   POST /rest/v1/app_config           -> 401/403 (RLS)
--   As anon (no JWT):            GET /rest/v1/report_files          -> 401/403, no rows
--   In SQL as a signed-in test user:  select public.is_admin(), public.is_staff();
