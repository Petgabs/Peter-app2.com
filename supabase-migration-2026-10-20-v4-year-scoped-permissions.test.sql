-- ============================================================
-- v4 RLS verification script — FICTIONAL ACCOUNTS ONLY.
-- Run ONLY in a disposable Supabase project (or a local
-- Postgres loaded with supabase-setup.sql as updated by the
-- v4 migration), NEVER against production data. Everything
-- runs inside one transaction and is rolled back.
--
-- Before running: create three fictional Auth users in the
-- disposable project (Authentication -> Users) and paste
-- their UUIDs below:
--   ADMIN  00000000-0000-0000-0000-0000000000a1
--   TEACH_A 00000000-0000-0000-0000-0000000000b1  (assigned
--           sub_eald for 2027 and sub_mad for 2028)
--   TEACH_B 00000000-0000-0000-0000-0000000000b2  (assigned
--           sub_mad for 2027 and sub_eald for 2028)
-- The DO block asserts the can_write_subject() decision
-- matrix; the policy statements after it exercise real RLS
-- INSERT/UPDATE/DELETE attempts as the fictional teacher.
-- ============================================================

begin;

insert into public.profiles (id, username, display_name, role) values
  ('00000000-0000-0000-0000-0000000000a1','fic-admin','Fictional Admin','admin'),
  ('00000000-0000-0000-0000-0000000000b1','fic-teach-a','Fictional Teacher A','teacher'),
  ('00000000-0000-0000-0000-0000000000b2','fic-teach-b','Fictional Teacher B','teacher')
on conflict (id) do nothing;

insert into public.workspace_years (academic_year, path_prefix, is_legacy)
values (2028, 'years/2028/', false)
on conflict (academic_year) do nothing;

insert into public.subject_teachers (academic_year, subject_id, user_id) values
  (2027,'sub_eald','00000000-0000-0000-0000-0000000000b1'),
  (2028,'sub_mad', '00000000-0000-0000-0000-0000000000b1'),
  (2027,'sub_mad', '00000000-0000-0000-0000-0000000000b2'),
  (2028,'sub_eald','00000000-0000-0000-0000-0000000000b2')
on conflict do nothing;

-- Decision matrix at the gate used by every write policy.
do $$
declare
  admin_id  uuid := '00000000-0000-0000-0000-0000000000a1';
  teach_a   uuid := '00000000-0000-0000-0000-0000000000b1';
  teach_b   uuid := '00000000-0000-0000-0000-0000000000b2';
  procedure_ok boolean;
begin
  -- helper inline: we emulate auth.uid() through JWT claims
  create or replace function pg_temp.as_user(uid uuid) returns void
  language plpgsql as $f$
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', uid::text)::text, true);
  end $f$;

  perform pg_temp.as_user(teach_a);
  assert public.can_write_subject('data/reports/sub_eald.json') = true,
    'A: assigned legacy subject must be writable';
  assert public.can_write_subject('data/reports/sub_mad.json') = false,
    'A: another teacher''s legacy subject must be denied';
  assert public.can_write_subject('years/2028/data/reports/sub_mad.json') = true,
    'A: subject assigned for 2028 must be writable in 2028';
  assert public.can_write_subject('years/2028/data/reports/sub_eald.json') = false,
    'A: 2027 assignment must NOT carry into 2028';
  assert public.can_write_subject('years/2027/data/reports/sub_eald.json') = false,
    'years/2027/... is not the legacy location and must be denied';
  assert public.can_write_subject('data/settings.json') = false,
    'teachers must not write shared settings (legacy)';
  assert public.can_write_subject('years/2028/data/settings.json') = false,
    'teachers must not write shared settings (year-prefixed)';
  assert public.can_write_subject('data/roster.json') = false,
    'teachers must not write the roster';
  assert public.can_write_subject('years/2028/data/summaries.json') = false,
    'teachers must not write summaries';
  assert public.can_write_subject('years/2029/data/reports/sub_eald.json') = false,
    'unregistered year must be denied';
  assert public.can_write_subject('etc/passwd.json') = false,
    'unknown path must be denied';
  assert public.can_write_subject('years/2028/data/reports/../settings.json') = false,
    'path traversal must be denied';
  assert public.can_write_subject('years/2028/data/reports/sub_eald.json/extra') = false,
    'trailing segments must be denied';
  assert public.can_write_subject('') = false, 'empty path must be denied';

  perform pg_temp.as_user(teach_b);
  assert public.can_write_subject('data/reports/sub_mad.json') = true,
    'B: own legacy subject writable';
  assert public.can_write_subject('years/2028/data/reports/sub_eald.json') = true,
    'B: own 2028 subject writable';

  perform pg_temp.as_user(admin_id);
  assert public.can_write_subject('data/reports/sub_mad.json') = true,
    'admin may write report files';
  assert public.can_write_subject('years/2028/data/settings.json') = true,
    'admin may write shared settings';
  assert public.can_write_subject('data/settings.json') = true,
    'admin may write legacy settings';

  raise notice 'can_write_subject decision matrix: ALL OK';
end;
$$;

-- Real RLS attempts as fictional Teacher A (expect the first
-- to succeed and the rest to be rejected by policy/trigger;
-- run each statement separately in the SQL editor and note
-- the outcome, or wrap individually in DO blocks catching
-- insufficient_privilege / raise_exception):
--   set local role authenticated;
--   select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b1"}',true);
--   insert into public.report_files(path,content) values ('data/reports/sub_eald.json','{}');               -- ALLOWED
--   insert into public.report_files(path,content) values ('years/2028/data/reports/sub_eald.json','{}');    -- DENIED (not assigned in 2028)
--   insert into public.report_files(path,content) values ('years/2028/data/settings.json','{"academicYear":"2028"}'); -- DENIED (teacher, shared doc)
--   update public.report_files set content='{}' where path='data/reports/sub_mad.json';                     -- DENIED (0 rows / policy)
--   delete from public.report_files where path='data/reports/sub_mad.json';                                 -- DENIED (0 rows / policy)
--   insert into public.report_files(path,content) values ('years/2028/data/settings.json','{"academicYear":"2027"}'); -- as ADMIN: DENIED by year trigger (content/path mismatch)
--   insert into public.report_files(path,content) values ('staff/secrets.json','{}');                        -- DENIED as teacher; admin-only by design

rollback;
