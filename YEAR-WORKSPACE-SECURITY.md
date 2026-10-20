# Year-Workspace Security Fix — Review Pack (v4)

**Status: code + SQL prepared and tested with fictional records only.
NOTHING has been applied to the production database, and no real student
data has been used, imported or synced anywhere for this work.**
Production remains exactly as inventoried below until the approval
checkpoint at the end is completed. Until then, **do not use, import or
sync real student records into newly created year workspaces** — in the
live database, year-prefixed report writes are still governed by the
flawed v3 gate described next.

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
- **Year-aware assignments in the app**: assignment reads prefer the v4
  `academic_year` column and filter to the open year, falling back to
  the legacy shape on pre-v4 databases so nothing breaks before the
  migration is approved; admins registering a new year in the app also
  register it in `workspace_years` (tolerated no-op pre-v4).

## 4. Fictional test evidence

`tests/smoke.mjs` section 14 (no real records anywhere): SQL structure
and rollback review; legacy-year pinning; the old-2026-browser device
keeping its own workspace; import-conflict decline/accept with recovery
snapshot; cloud sync writing a new year only under `years/2026/...`
while legacy 2027 settings/roster stay intact; a tampered remote year
stopping sync with nothing overwritten. The RLS decision matrix
(assigned/unassigned × legacy/year × shared/report × unknown/traversal
paths, teacher vs admin) is scripted for a disposable database in the
`.test.sql` file above and must be run there before production sign-off.

Full suite: **200 assertions, ALL TESTS PASSED** (local; CI runs the
same suite on the PR). Report rules regression-checked as before:
exactly four ratings (`Consistently/Often/Occasionally/Rarely`; "Never"
is never an option or fallback), missing ratings print **Not set** and
keep the report DRAFT, CAL A–D map to the four words, no signature
lines, **Head of HSC** label with `hscCoordinator` storage,
**Preliminary Units Reported**, word-based Course-by-Course Summary.

## 5. ⛔ Admin approval checkpoint (required before any production write)

1. Review this pack, the v4 migration and its rollback.
2. Take a private backup: export the current workspace JSON (Admin →
   Data transfer) and keep the existing Supabase schema backup
   (`backup_20261018` + a fresh one if available).
3. In a **disposable** Supabase project (or a Supabase branch), apply
   `supabase-setup.sql`, then the v4 migration, create the three
   fictional accounts listed in the `.test.sql`, and run it — record the
   "ALL OK" notice and the expected policy denials.
4. Confirm `Petgabs/report-data` is **Private** in the GitHub UI.
5. Only then, with explicit school approval recorded, apply the v4
   migration to production (Supabase SQL editor / migration tooling),
   re-run the read-only inventory query, and confirm counts are
   unchanged and `workspace_years` holds exactly the 2027 legacy row.
6. Keep real records out of newly created year workspaces until steps
   1–5 are complete and the fictional RLS run has passed.

**Not claimed:** year workspaces are not production-safe until the
disposable-database RLS run (step 3) and the post-migration inventory
(step 5) have passed. No production schema or data write was made for
this review pack.
