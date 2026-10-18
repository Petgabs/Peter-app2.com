-- ============================================================
-- ROLLBACK for supabase-migration-2026-10-18-v3-subject-assignments.sql
-- Removes teacher-assignment enforcement and returns
-- report_files writes to the v2 rule (any staff member may
-- write). Assignment rows are dropped with the table; export
-- public.subject_teachers first if you may re-apply v3.
-- ============================================================

begin;

drop policy if exists "report files gated insert" on public.report_files;
drop policy if exists "report files gated update" on public.report_files;
drop policy if exists "report files gated delete" on public.report_files;
drop policy if exists "report files staff write" on public.report_files;
create policy "report files staff write" on public.report_files
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "profiles admin read" on public.profiles;

drop function if exists public.can_write_subject(text);
drop table if exists public.subject_teachers;

commit;

notify pgrst, 'reload schema';
