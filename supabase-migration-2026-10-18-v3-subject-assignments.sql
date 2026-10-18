-- ============================================================
-- MIGRATION v3 (2026-10-18): teacher assignment per subject.
--
-- Adds public.subject_teachers (which staff account may enter
-- reports for which subject) and enforces it in Postgres for
-- report_files writes:
--   * admins (is_admin) may write everything;
--   * a subject with NO assignments is open to all staff
--     (so nothing breaks before the coordinator assigns anyone);
--   * once a subject has assignments, only assigned teachers
--     (and admins) may write data/reports/<subjectId>.json;
--   * reads are unchanged: every staff member may still READ
--     all report data (needed for whole-student reports and
--     cohort distributions);
--   * non-report files (settings, roster, subjects, summaries)
--     keep the v2 staff write rule.
-- Also lets admins READ the staff profile list (needed by the
-- assignment screen); teachers still see only their own row.
-- RLS stays enabled everywhere. Idempotent. Rollback:
-- supabase-migration-2026-10-18-v3-subject-assignments.rollback.sql
-- ============================================================

begin;

create table if not exists public.subject_teachers (
  subject_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (subject_id, user_id)
);

alter table public.subject_teachers enable row level security;

drop policy if exists "subject teachers staff read" on public.subject_teachers;
create policy "subject teachers staff read" on public.subject_teachers
  for select to authenticated using (public.is_staff());
drop policy if exists "subject teachers admin insert" on public.subject_teachers;
create policy "subject teachers admin insert" on public.subject_teachers
  for insert to authenticated with check (public.is_admin());
drop policy if exists "subject teachers admin delete" on public.subject_teachers;
create policy "subject teachers admin delete" on public.subject_teachers
  for delete to authenticated using (public.is_admin());

-- Admins may read the staff list (assignment screen); the
-- own-row policy from v2 still covers everyone else.
drop policy if exists "profiles admin read" on public.profiles;
create policy "profiles admin read" on public.profiles
  for select to authenticated using (public.is_admin());

-- Write gate for one report_files path.
create or replace function public.can_write_subject(p_path text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare sid text;
begin
  if public.is_admin() then return true; end if;
  sid := regexp_replace(p_path, '^data/reports/(.+)\.json$', '\1');
  if sid = p_path then return true; end if; -- not a per-subject report file
  if not exists (select 1 from public.subject_teachers t where t.subject_id = sid) then
    return true; -- unassigned subject: open to all staff
  end if;
  return exists (
    select 1 from public.subject_teachers t
    where t.subject_id = sid and t.user_id = auth.uid()
  );
end;
$$;
revoke execute on function public.can_write_subject(text) from public, anon;
grant execute on function public.can_write_subject(text) to authenticated;

-- Replace the v2 blanket staff-write on report_files with
-- insert/update/delete policies gated per subject.
drop policy if exists "report files staff write" on public.report_files;
drop policy if exists "report files gated insert" on public.report_files;
create policy "report files gated insert" on public.report_files
  for insert to authenticated
  with check (public.is_staff() and public.can_write_subject(path));
drop policy if exists "report files gated update" on public.report_files;
create policy "report files gated update" on public.report_files
  for update to authenticated
  using (public.is_staff() and public.can_write_subject(path))
  with check (public.is_staff() and public.can_write_subject(path));
drop policy if exists "report files gated delete" on public.report_files;
create policy "report files gated delete" on public.report_files
  for delete to authenticated
  using (public.is_staff() and public.can_write_subject(path));

commit;

notify pgrst, 'reload schema';
