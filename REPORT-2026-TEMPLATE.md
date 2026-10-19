# 2026 Individual Report Template — Update & Administrator Handoff

Code update only. **No live school data (settings, roster, overrides) was
read for content, changed, or published by this change.** Development and
tests used fictional records only. The 23 approved final reports were used
as a private reference for presentation rules and were not copied into the
repository.

## What changed in the app (`index.html`)

1. **Reporting staff (last page):** The old `rptCertification` section is now
   `rptReportingStaff`: it prints name + role for Class Teacher,
   **Head of HSC** (stored under the existing `staff.hscCoordinator` key —
   the key was deliberately *not* renamed, so old backups and cloud JSON
   still load), and Deputy Principal. Signature lines (`.sig-line`) and all
   certification wording were removed; names are printed only, nothing
   implies signing. The admin card "Report signatories" is renamed
   **Reporting staff**, its HSC field is labelled **Head of HSC**, and the
   final-check message and teacher-guide wording match. Subject-teacher
   names are untouched.
2. **Class Teacher overrides:** Admin → School & staff now lists every
   student whose per-student `classTeacher` override differs from the
   default ("Class Teacher overrides to review"). Overrides are flagged,
   never overwritten; an override still prints on that student's report
   until an admin deliberately edits it in the Students tab.
3. **Issue date:** Still a single editable `type=date` setting, now
   validated on save (must be a real `YYYY-MM-DD` calendar date). It prints
   via `fmtDate` on the cover and on the final Reporting Staff page
   (e.g. ISO `2026-10-23` → "23 October 2026"). No year-specific date is
   hard-coded; future years keep their own date. Nothing in the report
   claims the report has been sent to families.
4. **Units:** Cover line is now **"Total Preliminary Units Reported"**,
   summed from the student's actually enrolled courses (already the
   calculation; wording reconciled). 6×2-unit courses = 12; plus 1-unit
   Mathematics Extension 1 = 13.
5. **Course-by-Course Summary:** The four learner-profile columns now show
   words (Consistently / Often / Occasionally / Rarely; **Never** when no
   rating is recorded) instead of dot symbols. The **Profile Total**
   column, the `/16` score and the explanatory total footer are removed.
   Detailed per-subject learner profiles (word + dots) and the appendix
   Learner Profile Descriptors legend are unchanged. A–E academic grade
   distributions are unchanged, and cohort denominators are computed from
   actual course enrolments (no hard-coded cohort size).

## Administrator steps for the live 2026 workspace (requires approval)

Do **not** run these until a school approver signs off. They are one-time,
narrow, and reversible; no student records are touched.

1. **Backup first:** Admin → Data transfer → *Export all JSON* (private
   full backup), and in Supabase keep schema backup `backup_20261018`
   (already exists). Store the JSON privately, off GitHub.
2. **Reporting staff values:** Admin → School & staff → *Reporting staff*:
   set Class Teacher = **Ms. Wang Le**, Head of HSC = **Mr. Peter Paul
   Gabato**, Deputy Principal = **Ms. Qian Zhang**. Save settings (this
   writes only `data/settings.json` through the normal sync).
3. **Issue date:** set *Date of issue* to `2026-10-23` for the 2026 batch.
4. **Review the override flag:** if the "Class Teacher overrides to review"
   notice lists students, confirm each override is intended; change only
   via the Students tab. Do not bulk-edit.
5. **Spot-check:** preview one 12-unit and one 13-unit 2026 report; confirm
   the date in both places, the three names/roles, word-based summary, and
   no signature lines. Rollback = re-import the step-1 backup or re-enter
   the previous settings values.

## Test evidence

- `tests/smoke.mjs` gained a "2026 individual report template" section
  (fictional students only: one 6-course/12-unit, one 7-course/13-unit):
  issue date in ≥2 locations, exact staff names/roles, no signature lines
  or certification wording, word-only course summary without `/16`,
  detailed-profile dots retained, enrolment-based denominators (2/2 for a
  common subject, 1/1 for MEX), numbered multi-sheet preview, override
  honoured in print and flagged in admin, legacy `hscCoordinator` backup
  still loading.
- Full suite: **161 assertions, ALL TESTS PASSED** locally and in CI.
- A pixel-level PDF check needs a real browser (jsdom has no layout
  engine): the app already blocks printing when `paginateStudent` detects
  overflow; verify visually during step 5 above before release.
