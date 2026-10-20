-- ============================================================
-- Student Report Studio — school cloud (Supabase) setup
-- Run this file ONCE in the Supabase project's SQL editor.
-- It creates: profiles, report_files, row-level security,
-- username sign-in helper, and new-user profile trigger.
-- ============================================================

-- 1) Profiles: one row per staff account, with role
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  role text not null default 'teacher' check (role in ('admin','teacher')),
  created_at timestamptz not null default now()
);

-- 2) Report data: one JSON document per app data path
create table if not exists public.report_files (
  path text primary key,
  content jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- 3) Row-level security: only signed-in staff can read/write.
-- IMPORTANT: never write a policy ON public.profiles that itself queries
-- public.profiles (e.g. EXISTS (SELECT ... FROM profiles ...)). PostgreSQL
-- evaluates that policy while reading profiles, which recurses and fails
-- with 42P17 "infinite recursion detected in policy". Role checks go
-- through the SECURITY DEFINER helpers below, which bypass RLS safely.
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

alter table public.profiles enable row level security;
alter table public.report_files enable row level security;

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

drop policy if exists "staff read report data" on public.report_files;
create policy "staff read report data" on public.report_files
  for select to authenticated using (public.is_staff());

drop policy if exists "staff write report data" on public.report_files;

-- Teacher assignment per subject (migration v3): admins assign
-- staff accounts to subjects; writes to a subject's report file
-- are then limited to its assigned teachers (admins always may;
-- a subject with no assignments stays open to all staff).
create table if not exists public.workspace_years (
  academic_year integer primary key check (academic_year between 2000 and 2100),
  path_prefix text not null unique,
  is_legacy boolean not null default false,
  created_at timestamptz not null default now(),
  constraint workspace_years_prefix_shape
    check (path_prefix = '' or path_prefix = 'years/' || academic_year || '/')
);
insert into public.workspace_years (academic_year, path_prefix, is_legacy)
values (2027, '', true) on conflict (academic_year) do nothing;
alter table public.workspace_years enable row level security;
drop policy if exists "workspace years staff read" on public.workspace_years;
create policy "workspace years staff read" on public.workspace_years
  for select to authenticated using (public.is_staff());
drop policy if exists "workspace years admin insert" on public.workspace_years;
create policy "workspace years admin insert" on public.workspace_years
  for insert to authenticated with check (public.is_admin());
drop policy if exists "workspace years admin update" on public.workspace_years;
create policy "workspace years admin update" on public.workspace_years
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "workspace years admin delete" on public.workspace_years;
create policy "workspace years admin delete" on public.workspace_years
  for delete to authenticated using (public.is_admin());

create table if not exists public.subject_teachers (
  subject_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  academic_year integer not null default 2027
    references public.workspace_years(academic_year),
  created_at timestamptz not null default now(),
  primary key (academic_year, subject_id, user_id)
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

drop policy if exists "profiles admin read" on public.profiles;
create policy "profiles admin read" on public.profiles
  for select to authenticated using (public.is_admin());

create or replace function public.report_path_info(p_path text)
returns table (academic_year integer, is_report boolean, subject_id text)
language sql
security definer
set search_path = public
stable
as $$
  select w.academic_year, false, null::text
    from public.workspace_years w
   where w.is_legacy
     and p_path ~ '^data/(settings|roster|subjects|summaries)\.json$'
  union all
  select w.academic_year, true,
         (regexp_match(p_path, '^data/reports/([A-Za-z0-9_-]+)\.json$'))[1]
    from public.workspace_years w
   where w.is_legacy
     and p_path ~ '^data/reports/([A-Za-z0-9_-]+)\.json$'
  union all
  select w.academic_year, false, null::text
    from public.workspace_years w
   where w.path_prefix = 'years/' || w.academic_year || '/'
     and p_path ~ ('^years/' || w.academic_year
                   || '/data/(settings|roster|subjects|summaries)\.json$')
  union all
  select w.academic_year, true,
         (regexp_match(p_path, '^years/([0-9]{4})/data/reports/([A-Za-z0-9_-]+)\.json$'))[2]
    from public.workspace_years w
   where w.path_prefix = 'years/' || w.academic_year || '/'
     and p_path ~ ('^years/' || w.academic_year
                   || '/data/reports/([A-Za-z0-9_-]+)\.json$')
     and (regexp_match(p_path, '^years/([0-9]{4})/data/reports/([A-Za-z0-9_-]+)\.json$'))[1]::integer
         = w.academic_year
$$;
revoke execute on function public.report_path_info(text) from public, anon;
grant execute on function public.report_path_info(text) to authenticated;

create or replace function public.can_write_subject(p_path text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_admin() or (
    public.is_staff() and exists (
      select 1
        from public.report_path_info(p_path) i
        join public.subject_teachers t
          on t.academic_year = i.academic_year
         and t.subject_id = i.subject_id
       where i.is_report
         and t.user_id = auth.uid()
    )
  )
$$;
revoke execute on function public.can_write_subject(text) from public, anon;
grant execute on function public.can_write_subject(text) to authenticated;

create or replace function public.check_report_file_year()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare info record;
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

create policy "report files gated insert" on public.report_files
  for insert to authenticated
  with check (public.is_staff() and public.can_write_subject(path));
create policy "report files gated update" on public.report_files
  for update to authenticated
  using (public.is_staff() and public.can_write_subject(path))
  with check (public.is_staff() and public.can_write_subject(path));
create policy "report files gated delete" on public.report_files
  for delete to authenticated
  using (public.is_staff() and public.can_write_subject(path));

-- 3b) Shared app configuration: the coordinator publishes the Supabase
--     URL/anon key, GitHub repository and repository token once. Every
--     signed-in device reads it. Admins only — never exposed to anon.
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.app_config enable row level security;

-- Signed-in staff may READ the registry: it carries the Supabase address and
-- the GitHub token so every teacher's device can turn the GitHub cloud on
-- automatically. Only admins may write it. Remove the read policy below if you
-- do not want staff devices to hold the repository token.
drop policy if exists "admins manage app config" on public.app_config;
drop policy if exists "staff read app config" on public.app_config;
drop policy if exists "admins write app config" on public.app_config;
create policy "staff read app config" on public.app_config
  for select to authenticated using (public.is_staff());
create policy "admins write app config" on public.app_config
  for insert to authenticated with check (public.is_admin());
drop policy if exists "admins update app config" on public.app_config;
create policy "admins update app config" on public.app_config
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete app config" on public.app_config;
create policy "admins delete app config" on public.app_config
  for delete to authenticated using (public.is_admin());

-- 4) Username sign-in helper (lets teachers log in with a username
--    instead of an email). Returns the account email for sign-in.
create or replace function public.email_for_username(u text)
returns text
language sql
security definer
set search_path = public
as $$
  select a.email from public.profiles p
  join auth.users a on a.id = p.id
  where lower(p.username) = lower(u)
  limit 1
$$;
revoke execute on function public.email_for_username(text) from public, anon;
grant execute on function public.email_for_username(text) to anon, authenticated;

-- 5) Auto-create a profile whenever the coordinator adds a user.
--    In Authentication -> Users -> Add user, set User Metadata:
--    { "username": "hsc-wang", "display_name": "Ms Wang", "role": "teacher" }
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'teacher')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6) Optional: disable email confirmation so accounts work immediately.
--    (Authentication -> Providers -> Email -> "Confirm email" = OFF)
