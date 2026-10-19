# Keeping Academic Years Separate — Investigation & Proposal

Status: **proposal only**. Nothing in the live workspace, Supabase project or
GitHub data repository was changed by this investigation (read-only code
review; all tests use fictional records). Implementing this requires
separate school approval, because it changes shared sync paths.

## What the read-only check found (architecture, not live data)

The app keeps **exactly one workspace**, with no year dimension anywhere:

- Browser storage: one local key
  (`bzgfls-year11-preliminary-report-studio-v1`) holds the whole `data`
  object (settings, roster, subjects, summaries, per-subject entries).
- Cloud sync (`syncFileList()` in `index.html`) always uses the same paths,
  whatever the academic year:
  `data/settings.json`, `data/roster.json`, `data/subjects.json`,
  `data/summaries.json`, and `data/reports/<subjectId>.json` per subject —
  mirrored identically to Supabase `report_files` and the GitHub data repo.
- `saveSettings` treats a year change as *relabeling the same records* (it
  warns and asks for confirmation). The blank template defaults to
  `SEED.defaultYear` (currently 2027).

Consequences: typing 2026 values into the live settings would (a) overwrite
the 2027 configuration, (b) relabel the existing roster/entries as 2026,
and (c) sync those values over the shared cloud files for every teacher.
That is why the approved 2026 staff names and `2026-10-23` must **not** be
typed into the current workspace. A new read-only **Shared settings
inventory** card (Admin → School & staff) now shows the year, stored/printed
issue date, the three reporting-staff values and workspace size actually in
force, so this can be verified at a glance without changing anything.

## Proposed design (requires approval before any implementation)

Year-namespaced workspaces, switched explicitly, never implicitly:

1. **Storage layout:** prefix every path with the academic year —
   `years/2026/data/settings.json`, `years/2026/data/roster.json`,
   `years/2026/data/subjects.json`, `years/2026/data/summaries.json`,
   `years/2026/data/reports/<subjectId>.json` (same for `years/2027/...`),
   and suffix the browser storage key with the year. Subject report files
   already key by subject ID, so per-year separation carries through.
2. **Workspace switcher:** Admin → School & staff gains "Report workspace:
   2026 / 2027". Switching never merges or relabels: it loads that year's
   namespaced files (or a fresh, empty workspace for a new year) after
   snapshotting the current one. The active year is shown in the top bar.
3. **Migration procedure (per year, in order, all reversible):**
   a. Export a private full JSON backup of the current workspace; verify it
      re-imports in a disposable browser profile. Keep the existing
      Supabase schema backup.
   b. Deploy the namespacing code with a one-time, admin-triggered
      "copy current workspace into years/<current year>" action — a copy,
      not a move; the old `data/...` paths stay untouched until the school
      confirms the new paths load correctly.
   c. Create the 2026 workspace only from the school's privately held 2026
      records (never via this public repo), then set the values below.
   d. Rollback at any point: switch back to the previous workspace, or
      restore the step-(a) backup; the old paths and backup schema remain
      intact until the school explicitly retires them.
4. **Exact proposed 2026 workspace values** (for the authorised 2026
   workspace only; the 2027 workspace keeps its current values):
   - Academic year: `2026`; Reporting period: `Academic Year 2026`
   - Issue date: `2026-10-23` (prints "23 October 2026")
   - Class Teacher: **Ms. Wang Le**
   - Head of HSC: **Mr. Peter Paul Gabato** (stored under the backward-
     compatible `hscCoordinator` key)
   - Deputy Principal: **Ms. Qian Zhang**
   - Roster/subjects/entries: loaded from the school's private 2026
     records; subject teachers as recorded there (not inferred from
     reporting-staff names).

Alternative considered: a separate Supabase project and data repository per
cohort. Stronger isolation, but more accounts, more sign-in confusion for
teachers, and duplicated publishing setup — not recommended unless the
school wants hard separation.

## What is already handled in code (this change)

- A per-student `classTeacher` override that differs from the default now
  produces an explicit **Class Teacher override conflict** in the report
  preflight (Reports view), keeps that report DRAFT, and is also listed in
  Admin → School & staff. The student record is never silently altered;
  resolution must be an explicit admin edit.
- Missing/empty learner-profile ratings print **Not set**, never "Never"
  (see REPORT-2026-TEMPLATE.md corrections).

## What cannot be verified without authorised access

- The real 2026 roster, settings history, and any live per-student
  overrides (their existence is exactly what the new preflight will surface
  once a 2026 workspace exists).
- Pixel-level A4 PDF output in a real browser (automated tests run in
  jsdom, which has no layout engine; the app blocks printing on detected
  overflow, and a visual spot-check remains an admin step).
- Any claim about the 2026 cohort beyond the presentation rules above.
