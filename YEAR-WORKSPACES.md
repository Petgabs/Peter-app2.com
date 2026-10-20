# Keeping Academic Years Separate — Implemented Workspaces

Status: **implemented in the app** (Admin → School & staff → *Report
workspace — academic year*). No live workspace, Supabase row or GitHub data
file was changed while building this: the existing shared workspace keeps its
original cloud location (see "Backward compatibility"), all automated tests
use fictional records, and creating/populating a real 2026 workspace remains
an **admin-only action requiring separate approval** (steps below).

## How year workspaces behave

- Every academic year owns its **settings, roster, subjects, summaries and
  subject entries**. Years are switched explicitly, never merged and never
  relabelled: choosing another year saves the current workspace exactly as
  it is and opens the selected year; returning restores it unchanged.
- The Settings **Academic year** field can no longer relabel the open
  workspace — it refuses with guidance to use the workspace switcher.
- **New years** start empty of students with the standard subject template
  and `Academic Year <year>` as the reporting period.
- **Backups:** exporting produces a backup of the open year. Importing a
  backup whose year differs from the open workspace **files it into that
  year's workspace** and leaves the open workspace untouched; a same-year
  backup imports as before. Open the imported year from the workspace
  switcher when you want to work in it.
- **Reset local data** clears only the open year's workspace.

## Backward compatibility (why the live 2027 workspace is untouched)

- Browser storage: the active workspace keeps the original key
  (`bzgfls-year11-preliminary-report-studio-v1`); each year is additionally
  archived under that key + `:y<year>`, with a small year index alongside.
- Cloud paths: the **verified legacy year — 2027**, confirmed read-only
  against the shared server settings (never whichever year a browser
  happened to open first) keeps syncing to the original paths
  `data/settings.json`, `data/roster.json`, `data/subjects.json`,
  `data/summaries.json`, `data/reports/<subjectId>.json`, so nothing moves
  and no migration of the shared workspace is needed. Every additional year
  syncs under `years/<year>/data/...` in both Supabase `report_files` and
  the GitHub data repository, and pulls ignore files belonging to other
  years.
- Rollback for the code change itself: revert the app release. Because the
  legacy year never changed location, all existing devices and cloud files
  keep working exactly as before; `years/<year>/...` files and the local
  per-year archives are simply ignored by older code.

> **Security note (2026-10-20):** server-side permissions for
> year-prefixed paths are fixed by the prepared v4 migration, which is
> **not yet applied to production**. See `YEAR-WORKSPACE-SECURITY.md`
> for the inventory, migration, fictional RLS tests and the admin
> approval checkpoint. Do not put real records into new year workspaces
> until that checkpoint is complete.

## Before any real single-workspace migration (unchanged gate)

No real configuration write happens without, in order:

1. The read-only **Shared settings inventory** (Admin → School & staff)
   confirming the year, issue date and reporting staff actually in force.
2. A private full JSON backup of the current workspace (Admin → Data
   transfer → Export backup), stored off the public repo, plus the existing
   Supabase schema backup.
3. A written migration map (affected paths, exact proposed values) and
   **separate school approval**.

## Admin-only: setting up the real 2026 workspace (when approved)

1. Confirm the inventory card still shows the current (2027) shared
   settings; export and keep a private backup of it.
2. Admin → School & staff → *Report workspace — academic year*: enter
   `2026` under "Create a workspace for a new year" and create it. (If a
   private 2026 full backup already exists, import it instead — it will be
   filed into the 2026 workspace automatically.)
3. With the 2026 workspace open, set **only** these settings values:
   - Academic year: `2026`; Reporting period: `Academic Year 2026`
   - Issue date: `2026-10-23` (prints **23 October 2026**)
   - Class Teacher: **Ms. Wang Le**
   - Head of HSC: **Mr. Peter Paul Gabato** (stored under the backward-
     compatible `hscCoordinator` key)
   - Deputy Principal: **Ms. Qian Zhang**
   - Printed names/roles only — the template has no signature lines.
4. Load the roster/subjects/entries from the school's privately held 2026
   records; keep subject teachers as recorded there (never inferred from
   the reporting-staff names above).
5. Run the Reports preflight: resolve any **Class Teacher override
   conflict** explicitly (edit the student or accept the override) — a
   conflicted report stays DRAFT and is never silently altered or finalised.
6. Switch back to 2027 and confirm its settings/records are unchanged.

## Also handled in code

- A per-student `classTeacher` override that differs from the default
  produces an explicit **Class Teacher override conflict** in the report
  preflight (Reports view), keeps that report DRAFT, and is also listed in
  Admin → School & staff. The student record is never silently altered.
- Learner-profile ratings are exactly `Consistently`, `Often`,
  `Occasionally`, `Rarely`. Missing/empty/unrecognised ratings print
  **Not set** and keep the report DRAFT; "Never" is not an option and is
  never used as a fallback.
- Automated coverage (all fictional): importing a 2026 backup while 2027 is
  open files it away without touching 2027; switching among 2026 / 2027 /
  newly created 2028 restores each year's roster, staff and date exactly;
  year-scoped cloud paths with the legacy year keeping `data/...`
  (184 assertions, `tests/smoke.mjs`).

## What cannot be verified without authorised access

- The real 2026 roster, settings history, and any live per-student Class
  Teacher overrides (the new preflight surfaces them once a real 2026
  workspace exists).
- Pixel-level A4 PDF output in a real browser (automated tests run in
  jsdom, which has no layout engine; the app blocks printing on detected
  overflow, and a visual spot-check remains an admin step).
- That the real 2027 workspace is untouched end-to-end (only its read-only
  inventory values were checked); the 2026 workspace is **not** claimed
  verified end to end.
