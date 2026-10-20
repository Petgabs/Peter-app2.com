-- ============================================================
-- ROLLBACK for v4 (2026-10-20) year-scoped permissions.
-- Restores the v3 behaviour exactly:
--   * can_write_subject() recognises only legacy paths and
--     returns TRUE for non-report paths; unassigned subjects
--     are open to all staff (the known v3 weakness returns -
--     only run this rollback to escape a broken v4 deploy,
--     then re-apply a fixed v4 promptly);
--   * subject_teachers loses its academic_year dimension
--     (non-2027 assignment rows are DELETED: export them
--     first if any were created under v4);
--   * workspace_years and the settings-year trigger are
--     removed. report_files rows (incl. any years/... files)
--     are NOT deleted by this rollback.
-- ============================================================

begin;

drop trigger if exists report_files_year_check on public.report_files;
drop function if exists public.check_report_file_year();
drop function if exists public.report_path_info(text);

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
  if sid = p_path then return true; end if;
  if not exists (select 1 from public.subject_teachers t where t.subject_id = sid) then
    return true;
  end if;
  return exists (
    select 1 from public.subject_teachers t
    where t.subject_id = sid and t.user_id = auth.uid()
  );
end;
$$;
revoke execute on function public.can_write_subject(text) from public, anon;
grant execute on function public.can_write_subject(text) to authenticated;

-- Policies keep the v3/v4 gated names; they call the function
-- above, so no policy change is needed. Make sure no blanket
-- staff-write policy has reappeared:
drop policy if exists "staff write report data" on public.report_files;

delete from public.subject_teachers where academic_year <> 2027;
alter table public.subject_teachers
  drop constraint if exists subject_teachers_pkey;
alter table public.subject_teachers
  add primary key (subject_id, user_id);
alter table public.subject_teachers
  drop constraint if exists subject_teachers_academic_year_fk;
alter table public.subject_teachers drop column if exists academic_year;

drop policy if exists "workspace years staff read" on public.workspace_years;
drop policy if exists "workspace years admin insert" on public.workspace_years;
drop policy if exists "workspace years admin update" on public.workspace_years;
drop policy if exists "workspace years admin delete" on public.workspace_years;
drop table if exists public.workspace_years;

commit;

notify pgrst, 'reload schema';
