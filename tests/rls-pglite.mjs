/* Independent execution of the v4 migration in a REAL PostgreSQL
   engine (PGlite = PostgreSQL compiled to WebAssembly).
   Fictional accounts only; no external service is touched.
   Run:  cd tests && npm run test:rls
   Exercises, against the unmodified migration file:
     - report_path_info() / can_write_subject() decision matrix
     - the settings-year trigger
     - actual RLS INSERT/UPDATE/DELETE enforcement as a
       least-privileged (non-superuser) role              */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';

let fails = 0;
const report = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fails++;
};

const db = new PGlite();
const mig = fs.readFileSync(new URL('../supabase-migration-2026-10-20-v4-year-scoped-permissions.sql', import.meta.url), 'utf8');

// Minimal Supabase-like environment: auth.uid() reads a one-row
// state table (harness only), plus the v3-era base objects the
// migration expects to find.
await db.exec(`
  create schema auth;
  create table public.app_state (uid uuid);
  insert into public.app_state values (null);
  create or replace function auth.uid() returns uuid language sql stable
    as $$ select uid from public.app_state $$;
  create table public.profiles (id uuid primary key, username text unique not null,
    display_name text, role text not null default 'teacher' check (role in ('admin','teacher')),
    created_at timestamptz not null default now());
  create table public.report_files (path text primary key, content jsonb not null,
    updated_at timestamptz not null default now(), updated_by uuid);
  create table public.subject_teachers (subject_id text not null, user_id uuid not null,
    created_at timestamptz not null default now(), primary key (subject_id, user_id));
  create or replace function public.is_admin() returns boolean language sql security definer
    set search_path = public stable
    as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') $$;
  create or replace function public.is_staff() returns boolean language sql security definer
    set search_path = public stable
    as $$ select exists (select 1 from public.profiles p where p.id = auth.uid()) $$;
  create role anon nologin;
  create role authenticated nologin;
  create role fic_tester nologin;
  alter table public.report_files enable row level security;
  alter table public.subject_teachers enable row level security;
  create policy "staff read report data" on public.report_files
    for select to authenticated using (public.is_staff());
  grant authenticated to fic_tester;
  grant select, insert, update, delete on public.report_files to fic_tester;
  grant select on public.profiles, public.subject_teachers to fic_tester;
  grant update on public.app_state to fic_tester;
`);

// Apply the migration file unmodified.
try { await db.exec(mig); report('v4 migration applies cleanly in PostgreSQL', true); }
catch (e) { report('v4 migration applies cleanly in PostgreSQL', false, e.message); process.exit(1); }

const A = '00000000-0000-0000-0000-0000000000a1', T1 = '00000000-0000-0000-0000-0000000000b1', T2 = '00000000-0000-0000-0000-0000000000b2';
await db.exec(`
  insert into public.profiles (id, username, display_name, role) values
    ('${A}','fic-admin','Fictional Admin','admin'),
    ('${T1}','fic-teach-a','Fictional Teacher A','teacher'),
    ('${T2}','fic-teach-b','Fictional Teacher B','teacher');
  insert into public.workspace_years (academic_year, path_prefix, is_legacy)
    values (2028, 'years/2028/', false);
  insert into public.subject_teachers (academic_year, subject_id, user_id) values
    (2027,'sub_eald','${T1}'), (2028,'sub_mad','${T1}'),
    (2027,'sub_mad','${T2}'), (2028,'sub_eald','${T2}');
  insert into public.report_files (path, content) values
    ('data/reports/sub_mad.json', '{"marker":"original"}'),
    ('data/settings.json', '{"academicYear":"2027"}');
`);
await db.query(`grant execute on function public.can_write_subject(text) to fic_tester`);
await db.query(`grant execute on function public.report_path_info(text) to fic_tester`);

const as = uid => db.query(`update public.app_state set uid = '${uid}'`);
const can = async (uid, path) => {
  await as(uid);
  const r = await db.query('select public.can_write_subject($1) as ok', [path]);
  return r.rows[0].ok;
};
const cases = [
  [T1, 'data/reports/sub_eald.json', true,  'teacher assigned legacy subject'],
  [T1, 'data/reports/sub_mad.json', false, 'teacher unassigned legacy subject'],
  [T1, 'years/2028/data/reports/sub_mad.json', true,  'teacher assigned in 2028'],
  [T1, 'years/2028/data/reports/sub_eald.json', false, '2027 assignment does not carry into 2028'],
  [T1, 'years/2027/data/reports/sub_eald.json', false, 'years/2027/ is not the legacy location'],
  [T1, 'data/settings.json', false, 'teacher cannot write legacy settings'],
  [T1, 'years/2028/data/settings.json', false, 'teacher cannot write year settings'],
  [T1, 'data/roster.json', false, 'teacher cannot write roster'],
  [T1, 'years/2028/data/summaries.json', false, 'teacher cannot write summaries'],
  [T1, 'years/2029/data/reports/sub_eald.json', false, 'unregistered year denied'],
  [T1, 'etc/passwd.json', false, 'unknown path denied'],
  [T1, 'years/2028/data/reports/../settings.json', false, 'traversal denied'],
  [T1, 'years/2028/data/reports/sub_eald.json/extra', false, 'trailing segment denied'],
  [T1, '', false, 'empty path denied'],
  [T2, 'data/reports/sub_mad.json', true, 'second teacher own legacy subject'],
  [T2, 'years/2028/data/reports/sub_eald.json', true, 'second teacher own 2028 subject'],
  [A,  'data/reports/sub_mad.json', true, 'admin writes report files'],
  [A,  'years/2028/data/settings.json', true, 'admin writes year settings'],
  [A,  'data/settings.json', true, 'admin writes legacy settings'],
];
for (const [uid, path, want, label] of cases) {
  const got = await can(uid, path);
  report(`RLS gate: ${label}`, got === want, `can_write_subject('${path}') = ${got}`);
}

// Settings-year trigger (superuser inserts still hit the trigger).
await as(A);
try {
  await db.query(`insert into public.report_files(path, content) values ('years/2028/data/settings.json', '{"academicYear":"2027"}')`);
  report('trigger rejects settings whose year mismatches its path', false, 'insert succeeded');
} catch (e) { report('trigger rejects settings whose year mismatches its path', /does not match workspace year/.test(e.message), e.message.slice(0, 70)); }
try {
  await db.query(`insert into public.report_files(path, content) values ('years/2028/data/settings.json', '{"academicYear":"2028"}')`);
  report('trigger accepts settings whose year matches its path', true);
} catch (e) { report('trigger accepts settings whose year matches its path', false, e.message); }
try {
  await db.query(`insert into public.report_files(path, content) values ('staff/secrets.json', '{}')`);
  report('trigger rejects unknown paths', false, 'insert succeeded');
} catch (e) { report('trigger rejects unknown paths', /Unknown report file path/.test(e.message), e.message.slice(0, 70)); }

// Real RLS enforcement as the least-privileged role.
await db.exec(`set role fic_tester`);
await as(T1);
try {
  await db.query(`insert into public.report_files(path, content) values ('data/reports/sub_eald.json', '{}')`);
  report('RLS INSERT allowed: teacher into own assigned legacy subject', true);
} catch (e) { report('RLS INSERT allowed: teacher into own assigned legacy subject', false, e.message.slice(0, 70)); }
try {
  await db.query(`insert into public.report_files(path, content) values ('years/2028/data/reports/sub_eald.json', '{}')`);
  report('RLS INSERT denied: teacher into subject not assigned that year', false, 'insert succeeded');
} catch (e) { report('RLS INSERT denied: teacher into subject not assigned that year', /row-level security/i.test(e.message), e.message.slice(0, 70)); }
try {
  await db.query(`insert into public.report_files(path, content) values ('years/2028/data/settings.json', '{"academicYear":"2028"}')`);
  report('RLS INSERT denied: teacher into shared settings document', false, 'insert succeeded');
} catch (e) { report('RLS INSERT denied: teacher into shared settings document', /row-level security/i.test(e.message), e.message.slice(0, 70)); }
const upd = await db.query(`update public.report_files set content = '{"marker":"hacked"}' where path = 'data/reports/sub_mad.json'`);
report('RLS UPDATE denied: another teacher\u2019s subject affects 0 rows', upd.affectedRows === 0, `affectedRows=${upd.affectedRows}`);
const del = await db.query(`delete from public.report_files where path = 'data/reports/sub_mad.json'`);
report('RLS DELETE denied: another teacher\u2019s subject affects 0 rows', del.affectedRows === 0, `affectedRows=${del.affectedRows}`);
await db.exec(`reset role`);
const check = await db.query(`select content->>'marker' as m from public.report_files where path = 'data/reports/sub_mad.json'`);
report('denied UPDATE/DELETE left the file untouched', check.rows[0].m === 'original');

console.log(fails ? `\n${fails} RLS FAILURES` : '\nRLS EXECUTION: ALL PASSED (PostgreSQL via PGlite, fictional accounts)');
process.exit(fails ? 1 : 0);
