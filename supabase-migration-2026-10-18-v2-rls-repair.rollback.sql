-- ============================================================
-- ROLLBACK for supabase-migration-2026-10-18-v2-rls-repair.sql
--
-- Restores the reviewed PR #15 policy set (the state v1 of the
-- migration would have produced): own-row profile reads, admin
-- writes via the SECURITY DEFINER helpers, staff access to
-- report_files and the app_config registry.
--
-- IMPORTANT LIMIT: if the live project contained legacy
-- policies under names nobody recorded, their exact text
-- cannot be recreated from this repository. That is why the
-- deployment checklist (SUPABASE-RLS-INVENTORY.md) requires
-- saving the pg_policies inventory BEFORE running v2 — that
-- saved output is the authoritative before-state and can be
-- turned back into CREATE POLICY statements if an exact
-- restore is ever needed. Do NOT use the older v1 rollback
-- file to "restore" the original broken policies except as a
-- last-resort diagnostic: it reintroduces the 42P17 recursion.
-- Data rows are not touched in either direction.
-- ============================================================

begin;

-- Drop whatever v2 (or anything else) left on the three tables.
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

-- Helpers (same definitions as v1/v2; harmless if present).
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

-- PR #15 reviewed policy set.
create policy "staff read profiles" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "admin insert profiles" on public.profiles
  for insert to authenticated with check (public.is_admin());
create policy "admin update profiles" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin delete profiles" on public.profiles
  for delete to authenticated using (public.is_admin());

create policy "staff read app config" on public.app_config
  for select to authenticated using (public.is_staff());
create policy "admins write app config" on public.app_config
  for insert to authenticated with check (public.is_admin());
create policy "admins update app config" on public.app_config
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete app config" on public.app_config
  for delete to authenticated using (public.is_admin());

create policy "staff read report data" on public.report_files
  for select to authenticated using (public.is_staff());
create policy "staff write report data" on public.report_files
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

commit;

notify pgrst, 'reload schema';
