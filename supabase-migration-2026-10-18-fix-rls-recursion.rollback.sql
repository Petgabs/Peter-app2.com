-- ============================================================
-- ROLLBACK for supabase-migration-2026-10-18-fix-rls-recursion.sql
--
-- WARNING: this restores the ORIGINAL policies, including the
-- self-referencing EXISTS subqueries that caused SQLSTATE
-- 42P17. Only use it to return to the exact pre-migration
-- policy set while diagnosing a problem with the migration;
-- expect GET /rest/v1/profiles and /rest/v1/app_config to
-- return HTTP 500 again until the migration is re-applied.
-- Data rows are not touched in either direction.
-- ============================================================

begin;

drop policy if exists "staff read profiles" on public.profiles;
create policy "staff read profiles" on public.profiles
  for select to authenticated using (true);

drop policy if exists "admin insert profiles" on public.profiles;
drop policy if exists "admin update profiles" on public.profiles;
drop policy if exists "admin delete profiles" on public.profiles;
drop policy if exists "admin manage profiles" on public.profiles;
create policy "admin manage profiles" on public.profiles
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "staff read report data" on public.report_files;
create policy "staff read report data" on public.report_files
  for select to authenticated using (true);

drop policy if exists "staff write report data" on public.report_files;
create policy "staff write report data" on public.report_files
  for all to authenticated using (true) with check (true);

drop policy if exists "staff read app config" on public.app_config;
create policy "staff read app config" on public.app_config
  for select to authenticated using (true);

drop policy if exists "admins write app config" on public.app_config;
drop policy if exists "admins update app config" on public.app_config;
drop policy if exists "admins delete app config" on public.app_config;
create policy "admins write app config" on public.app_config
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop function if exists public.is_admin();
drop function if exists public.is_staff();

commit;
