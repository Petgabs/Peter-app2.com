# Year-Workspace Security Fix — Review Pack (v4)

**Status: code + SQL prepared and tested with fictional records only.
NOTHING has been applied to the production database, and no real student
data has been used, imported or synced anywhere for this work.**
Production remains exactly as inventoried below until the approval
checkpoint at the end is completed. Until then, **do not use, import or
sync real student records into newly created year workspaces** — in the
live database, year-prefixed report writes are still governed by the
flawed v3 gate described next. As an interim control, the deployed
website now **fails closed**: it refuses to write `years/<year>/...` to
the school cloud unless the v4 registry has been positively verified
for that year (§3), and tells the admin why.

## 1. Read-only inventory (verified 2026-10-20, no writes)

Live Supabase project "Year 11 Report" (`sdjuojttlxciispgttwx`),
aggregate counts only — no file contents, credentials or tokens read:

| Item | Value |
|---|---|
| `public.report_files` rows | 11 |
| Year-prefixed rows (`years/...`) | **0** |
| Legacy settings academic year (`data/settings.json`) | **2027** |
| `public.subject_teachers` rows | 7 (no year dimension yet) |
| `public.profiles` | 10 (1 admin) |
| `public.workspace_years` table | does not exist (v4 not applied) |
| `report_files` RLS policies | 4 (v3 gated insert/update/delete + staff read) |

Confirmed flaw: live `can_write_subject(path)` only recognises
`^data/reports/(.+)\.json$` and **returns true for every other path**, so
`years/<YYYY>/data/reports/<subject>.json` bypasses the subject-assignment
test for any signed-in staff user, and shared documents
(settings/roster/subjects/summaries) are staff-writable. Client-side
checks do not repair this.

GitHub mirror destination privacy: **could not be verified from this
environment** (the sandbox GitHub integration has no access to
`Petgabs/report-data` metadata; HTTP 403). Mitigation in code (§3): the
app now verifies the destination repository is private at runtime before
mirroring and disables mirroring otherwise. An admin must still confirm
`Petgabs/report-data` shows **Private** in the GitHub UI before any real
records are mirrored.

## 2. SQL migration (prepared, not applied)

- `supabase-migration-2026-10-20-v4-year-scoped-permissions.sql`
- `supabase-migration-2026-10-20-v4-year-scoped-permissions.rollback.sql`
- `supabase-migration-2026-10-20-v4-year-scoped-permissions.test.sql`
  (fictional-account RLS decision matrix + policy attempts; disposable
  project only, everything rolled back)
- `supabase-setup.sql` updated to the same design for fresh installs.

Design (fail-closed):

- **`public.workspace_years`** — explicit server-side registry. The
  unprefixed `data/...` location is registered as the legacy workspace,
  academic year **2027** (the verified value above), prefix `''`. Any
  other year must be registered with prefix `years/<year>/` before files
  under it can be written. Staff may read the registry; only admins may
  change it.
- **`public.report_path_info(path)`** validates the *full* path: legacy
  or `years/<YYYY>/`, one of the four shared documents or
  `reports/<subjectId>.json` with a strict subject-id charset. Malformed,
  unexpected, traversal or unregistered-year paths yield no row → denied.
  (Parser and gate are `LANGUAGE sql` so they can be executed verbatim
  in the automated PostgreSQL test below.)
- **`can_write_subject()`**: admins may write everything; a teacher may
  write a subject-report file **only if assigned to that subject for that
  academic year**; teachers may not write shared documents in any year
  (admin operations); everything else is denied.
- **`subject_teachers.academic_year`** added; existing rows become 2027
  assignments (primary key becomes `(academic_year, subject_id,
  user_id)`), so reusing subject IDs across years cannot leak access.
- **Trigger `report_files_year_check`**: a settings document whose
  `content.academicYear` disagrees with its path year is rejected.
- Migration map: only the objects above change. No `report_files` rows
  are created, moved or edited; no real year-prefixed files are created
  by the migration. Rollback restores the v3 gate verbatim (and thereby
  its known weakness — treat rollback as an escape hatch, then re-apply
  a fixed v4 promptly).

## 3. Client fixes (this change)

- **Legacy year identification**: the unprefixed cloud location is now
  pinned to the verified legacy year (`LEGACY_CLOUD_YEAR = '2027'`),
  never to whichever year a browser opened first. A device carrying old
  local 2026 data opens it as the `years/2026/` workspace and cannot
  claim or merge into the shared 2027 paths (tested, §4).
- **Sync isolation**: every pull/push/GitHub-mirror captures a fixed
  `{year, prefix, epoch}` context at start and re-checks it after each
  await; switching years bumps the epoch and cancels in-flight work
  before it can write or apply anything. Before any cloud write, the
  remote settings document at the workspace's own prefix must carry the
  same academic year; on mismatch sync **stops**, overwrites nothing,
  and tells the admin to back up both workspaces and resolve explicitly.
  Sync caches are keyed by physical (year-prefixed) path, drafts are
  stored per year, and snapshots keep their year with them.
- **Import/snapshot protection**: importing a backup for a year that
  already has a local workspace now requires an explicit replacement
  choice, after a recovery copy of the destination is snapshotted;
  declining keeps the existing workspace. Restoring a snapshot from a
  different year files it into that year's workspace instead of
  overwriting the open one.
- **Guidance corrected**: the Admin "Shared settings inventory" now
  explains per-year workspaces and distinguishes the 2027 legacy
  location (`data/...`) from `years/<year>/data/...`.
- **Mirroring privacy**: `mirrorToGitHub()` verifies via the GitHub API
  that the destination repository is private (checked once per repo)
  and disables mirroring with an explicit error otherwise.
- **Fail-closed while v4 is missing (new)**: before any cloud write
  (Supabase push or GitHub mirror) for a non-legacy year, the app queries
  `workspace_years` for a row whose `academic_year` and `path_prefix`
  match the open workspace. Table missing (pre-v4 404), no row, or any
  read failure ⇒ the write is refused with an explicit *BLOCKED*
  message; admins also get that message when opening an unverified
  new-year workspace. There is no silent fallback to the permissive v3
  behaviour. The legacy 2027 workspace is unaffected. (Fictional test:
  smoke §16 — with no registry, a created 2026 workspace stays
  device-only, nothing reaches `years/...`, and the legacy workspace
  keeps syncing.)
- **Year-aware assignments in the app**: assignment reads prefer the v4
  `academic_year` column and filter to the open year, falling back to
  the legacy shape on pre-v4 databases so nothing breaks before the
  migration is approved; admins registering a new year in the app also
  register it in `workspace_years` (tolerated no-op pre-v4).

## 4. Fictional test evidence

`tests/smoke.mjs` sections 14–15 (no real records anywhere): SQL
structure and rollback review; legacy-year pinning; the old-2026-browser
device keeping its own workspace; import-conflict decline/accept with
recovery snapshot; a teacher starter for another year rejected without
touching the open workspace; cloud sync writing a new year only under
`years/2026/...` while legacy 2027 settings/roster stay intact; a
tampered remote year stopping sync with nothing overwritten; and a
**slow in-flight sync cancelled by a year switch** writing nothing
further to the old year's paths.

**RLS execution (new):** `tests/rls-pglite.mjs` (`npm run test:rls`,
also in CI) applies the *unmodified* v4 migration in a real PostgreSQL
engine (PGlite) with fictional Admin/Teacher accounts and executes:
the 19-case `can_write_subject` decision matrix (assigned/unassigned ×
legacy/year × shared/report × unknown/traversal/empty paths), the
settings-year trigger (mismatch rejected, match accepted, unknown path
rejected), and actual RLS enforcement as a least-privileged role —
INSERT allowed only into the teacher's own assigned subject, INSERT
into another year's/unassigned/shared paths denied by policy, UPDATE
and DELETE of another teacher's file affecting 0 rows with the file
left untouched. **Result: 29/29 PASSED.** The same matrix is scripted
for a disposable Supabase project (real Auth accounts + JWT claims) in
the `.test.sql` file, which remains part of the sign-off below.

Full suite: **204 assertions, ALL TESTS PASSED** (local; CI runs both
suites on the PR). Report rules regression-checked as before:
exactly four ratings (`Consistently/Often/Occasionally/Rarely`; "Never"
is never an option or fallback), missing ratings print **Not set** and
keep the report DRAFT, CAL A–D map to the four words, no signature
lines, **Head of HSC** label with `hscCoordinator` storage,
**Preliminary Units Reported**, word-based Course-by-Course Summary.

## 5. Deployment plan & ⛔ explicit approval request

**Requested decision (school project owner):** approve (a) creating a
disposable Supabase test environment, (b) a controlled-window
application of the v4 migration to the Year 11 Report production
project, and (c) the post-change verification below. Nothing in (b)
runs before (a) passes and approval is recorded here.

### Pre-production (owner/admin actions)
1. Review this pack, the v4 migration and its rollback. Note the
   rollback warning: it restores the **known insecure v3 gate** and
   deletes non-2027 assignment rows — an emergency escape hatch only.
2. Private backups (off-repo, never in public GitHub): (i) Admin →
   Data transfer → Export backup of the current 2027 workspace;
   (ii) fresh in-database snapshot of `subject_teachers`,
   `report_files` policy/function definitions next to the existing
   `backup_20261018` schema. Current read-only inventory:
   `SUPABASE-INVENTORY-PRE-V4-2026-10-20.md`.
3. **Disposable Auth/JWT run (mandatory, currently blocked here):**
   branching requires Pro and the org is at the Free-plan 2-project
   limit (see the inventory file), so the owner must upgrade, free a
   project slot, or provide another organisation. Then: apply
   `supabase-setup.sql` + the unchanged v4 SQL, create the three
   fictional accounts from the `.test.sql` (Admin / assigned Teacher /
   unassigned Teacher), and run it — expected: all gate assertions OK;
   teacher INSERT/UPDATE/DELETE denied outside their year-subject;
   shared documents admin-only; mismatch settings rejected by the
   trigger. Record the output.
4. Confirm `Petgabs/report-data` is **Private** in the GitHub UI.

### Exact production change list (controlled window, after approval)
- Apply `supabase-migration-2026-10-20-v4-year-scoped-permissions.sql`
  unchanged to project `sdjuojttlxciispgttwx` only. It creates
  `workspace_years` (+2027 legacy row, RLS, staff-read/admin-write),
  adds `subject_teachers.academic_year` (existing 7 rows become 2027),
  replaces `report_path_info`/`can_write_subject` with fail-closed
  versions, adds the settings-year trigger, and recreates the three
  gated `report_files` policies. **No `report_files` row is edited or
  deleted; no year-prefixed files are created.**

### Post-change verification (read-only, then fictional writes only)
5. Re-run the inventory queries: `workspace_years` = exactly the 2027
   legacy row; `subject_teachers.academic_year` present (7 rows, all
   2027); `can_write_subject` is the new full-path logic; RLS enabled
   with the gated policies; counts unchanged (11 files, 0
   year-prefixed, settings still 2027).
6. With fictional accounts only, repeat the `.test.sql` matrix against
   production-shaped permissions; only then enable real-data use of
   new-year workspaces (the app verifies the registry per year before
   writing, §3).
7. If any check fails: stop syncing new-year workspaces, follow the
   rollback file's recovery steps, and do not claim success.

**Not claimed:** year workspaces are not production-safe until steps
3, 5 and 6 have passed. No production schema or data write was made
for this review pack.
