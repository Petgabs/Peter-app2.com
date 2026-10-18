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
  for select to authenticated using (public.is_staff());

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
create policy "staff write report data" on public.report_files
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

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
