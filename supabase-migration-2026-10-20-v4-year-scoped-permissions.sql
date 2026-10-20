-- ============================================================
-- MIGRATION v4 (2026-10-20): year-scoped, fail-closed write
-- permissions for public.report_files.  *** DO NOT APPLY ***
-- until the approval checkpoint in YEAR-WORKSPACE-SECURITY.md
-- is signed off. No production data is touched by preparing
-- this file.
--
-- Problem: v3 can_write_subject() only recognises the legacy
-- path form ^data/reports/<subject>.json$ and returns TRUE for
-- every other path. Year-prefixed files such as
-- years/2028/data/reports/sub_eald.json therefore bypass the
-- subject-assignment test for any signed-in staff user, and
-- non-report files (settings/roster/subjects/summaries) are
-- writable by all staff.
--
-- Design (fail-closed):
--   * public.workspace_years is the explicit server-side
--     registry of academic-year workspaces. The unprefixed
--     data/... location is the LEGACY workspace, verified
--     read-only against the live settings as academic year
--     2027. Every other year must be registered with prefix
--     years/<year>/ before any file under it can be written.
--   * public.report_path_info() parses and validates the FULL
--     path (legacy or years/<YYYY>/..., shared document or
--     per-subject report, subject id charset). Anything else
--     yields no row and is therefore NOT writable.
--   * can_write_subject(): admins may write everything;
--     teachers may write a per-subject report file ONLY when
--     assigned to that subject FOR THAT ACADEMIC YEAR
--     (subject_teachers becomes year-specific; existing rows
--     become 2027 assignments). Teachers may NOT write shared
--     documents (settings/roster/subjects/summaries) in any
--     year - those are admin operations. Unknown, malformed or
--     unregistered-year paths are denied for everyone except
--     admins.
--   * A BEFORE INSERT/UPDATE trigger additionally requires a
--     settings document's content.academicYear to match the
--     year of its path, so data cannot be filed under the
--     wrong year even by a buggy client.
-- Reads are unchanged. RLS stays enabled. Idempotent.
-- Rollback: supabase-migration-2026-10-20-v4-year-scoped-permissions.rollback.sql
-- ============================================================

begin;

-- 1) Explicit registry of year workspaces -------------------
create table if not exists public.workspace_years (
  academic_year integer primary key
    check (academic_year between 2000 and 2100),
  path_prefix text not null unique,
  is_legacy boolean not null default false,
  created_at timestamptz not null default now(),
  constraint workspace_years_prefix_shape
    check (path_prefix = '' or path_prefix = 'years/' || academic_year || '/')
);
create unique index if not exists workspace_years_one_legacy
  on public.workspace_years (is_legacy) where is_legacy;

-- The original shared workspace: verified academic year 2027.
insert into public.workspace_years (academic_year, path_prefix, is_legacy)
values (2027, '', true)
on conflict (academic_year) do nothing;

alter table public.workspace_years enable row level security;
drop policy if exists "workspace years staff read" on public.workspace_years;
create policy "workspace years staff read" on public.workspace_years
  for select to authenticated using (public.is_staff());
drop policy if exists "workspace years admin insert" on public.workspace_years;
create policy "workspace years admin insert" on public.workspace_years
  for insert to authenticated with check (public.is_admin());
drop policy if exists "workspace years admin update" on public.workspace_years;
create policy "workspace years admin update" on public.workspace_years
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "workspace years admin delete" on public.workspace_years;
create policy "workspace years admin delete" on public.workspace_years
  for delete to authenticated using (public.is_admin());

-- 2) Teacher assignments become year-specific ---------------
alter table public.subject_teachers
  add column if not exists academic_year integer;
update public.subject_teachers
  set academic_year = 2027 where academic_year is null;
alter table public.subject_teachers
  alter column academic_year set not null;
alter table public.subject_teachers
  drop constraint if exists subject_teachers_academic_year_fk;
alter table public.subject_teachers
  add constraint subject_teachers_academic_year_fk
  foreign key (academic_year) references public.workspace_years(academic_year);
alter table public.subject_teachers
  drop constraint if exists subject_teachers_pkey;
alter table public.subject_teachers
  add primary key (academic_year, subject_id, user_id);

-- 3) Full-path parser/validator ------------------------------
create or replace function public.report_path_info(p_path text)
returns table (academic_year integer, is_report boolean, subject_id text)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  m text[];
  y integer;
begin
  -- Legacy shared documents: data/settings.json etc.
  if p_path ~ '^data/(settings|roster|subjects|summaries)\.json$' then
    select w.academic_year into y from public.workspace_years w
      where w.is_legacy limit 1;
    if y is null then return; end if;
    return query select y, false, null::text;
    return;
  end if;
  -- Legacy per-subject reports: data/reports/<subjectId>.json
  m := regexp_match(p_path, '^data/reports/([A-Za-z0-9_-]+)\.json$');
  if m is not null then
    select w.academic_year into y from public.workspace_years w
      where w.is_legacy limit 1;
    if y is null then return; end if;
    return query select y, true, m[1];
    return;
  end if;
  -- Year-prefixed shared documents: years/<YYYY>/data/settings.json etc.
  m := regexp_match(p_path,
    '^years/([0-9]{4})/data/(settings|roster|subjects|summaries)\.json$');
  if m is not null then
    y := m[1]::integer;
    if exists (select 1 from public.workspace_years w
               where w.academic_year = y
                 and w.path_prefix = 'years/' || y || '/') then
      return query select y, false, null::text;
    end if;
    return;
  end if;
  -- Year-prefixed per-subject reports.
  m := regexp_match(p_path,
    '^years/([0-9]{4})/data/reports/([A-Za-z0-9_-]+)\.json$');
  if m is not null then
    y := m[1]::integer;
    if exists (select 1 from public.workspace_years w
               where w.academic_year = y
                 and w.path_prefix = 'years/' || y || '/') then
      return query select y, true, m[2];
    end if;
    return;
  end if;
  return; -- malformed / unexpected path: no information, no write
end;
$$;
revoke execute on function public.report_path_info(text) from public, anon;
grant execute on function public.report_path_info(text) to authenticated;

-- 4) Fail-closed write gate ----------------------------------
create or replace function public.can_write_subject(p_path text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  info record;
begin
  if public.is_admin() then return true; end if;
  if not public.is_staff() then return false; end if;
  select * into info from public.report_path_info(p_path) limit 1;
  if not found then return false; end if;  -- unknown/malformed path
  if not info.is_report then return false; end if; -- shared docs: admin only
  return exists (
    select 1 from public.subject_teachers t
    where t.academic_year = info.academic_year
      and t.subject_id = info.subject_id
      and t.user_id = auth.uid()
  );
end;
$$;
revoke execute on function public.can_write_subject(text) from public, anon;
grant execute on function public.can_write_subject(text) to authenticated;

-- 5) Settings content must match the year of its path --------
create or replace function public.check_report_file_year()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  info record;
begin
  select * into info from public.report_path_info(NEW.path) limit 1;
  if not found then
    raise exception 'Unknown report file path: %', NEW.path;
  end if;
  if NEW.path like '%/data/settings.json' or NEW.path = 'data/settings.json' then
    if (NEW.content ? 'academicYear')
       and coalesce(NEW.content ->> 'academicYear', '') <> info.academic_year::text then
      raise exception 'Settings academicYear % does not match workspace year % for path %',
        NEW.content ->> 'academicYear', info.academic_year, NEW.path;
    end if;
  end if;
  return NEW;
end;
$$;
drop trigger if exists report_files_year_check on public.report_files;
create trigger report_files_year_check
  before insert or update on public.report_files
  for each row execute function public.check_report_file_year();

-- 6) report_files policies: gated insert/update/delete -------
drop policy if exists "staff write report data" on public.report_files;
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
