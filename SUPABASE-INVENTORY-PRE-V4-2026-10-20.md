# Pre-v4 Read-Only Inventory — Year 11 Report (production)

Captured **2026-10-20** via read-only queries (aggregate counts and
catalog metadata only — no student contents, comments, credentials or
token values were read). Project: **Year 11 Report**
(`sdjuojttlxciispgttwx`, PostgreSQL 17, ACTIVE_HEALTHY). The unrelated
**MAdv** project was not touched.

## Row counts (no contents)

| Item | Value |
|---|---|
| `public.report_files` rows | 11 |
| Year-prefixed rows (`years/...`) | 0 |
| `data/settings.json` → `academicYear` | `2027` (legacy workspace) |
| `public.subject_teachers` rows | 7 |
| `public.profiles` | 10 (1 admin) |
| `public.app_config` rows | 1 |

## Schema / policy state relevant to v4

- `public.workspace_years`: **does not exist**.
- `public.subject_teachers.academic_year`: **does not exist**
  (columns are `subject_id`, `user_id`, `created_at`; PK
  `(subject_id, user_id)`).
- `public.can_write_subject(path)`: v3 body — recognises only
  `^data/reports/(.+)\.json$`, returns **true** for all other paths
  (the audited flaw).
- `report_files` policies (16 policies across the four tables below;
  37 in the schema overall), all `TO authenticated`:
  `report files gated insert/update/delete`, `report files staff read`,
  `subject teachers admin insert/delete`, `subject teachers staff read`,
  `profiles admin insert/update/delete/read`, `profiles read own`,
  `app config admin insert/update/delete`, `app config staff read`.
- RLS is enabled on all app tables.
- Applied migrations on production: `20261018145726`
  (v2_rls_repair_fix_42p17), `20261018153934` (v3_subject_assignments),
  plus the two 2026-10-19 account/table migrations. **No v4.**
- In-database backup schema **`backup_20261018` is present**
  (created during the 2026-10-18 RLS repair).

## Backup & restore position (before any production write)

1. **In-database schema backup:** `backup_20261018` (existing). Before
   applying v4, the approving admin should snapshot the affected
   objects again (e.g. `create schema backup_pre_v4_20261020` +
   `create table ... as table` copies of `subject_teachers` and the
   policy/function definitions printed from `pg_policies` /
   `pg_get_functiondef`) — see the deployment plan in
   `YEAR-WORKSPACE-SECURITY.md`.
2. **Admin JSON backup:** Admin → Data transfer → Export backup of the
   current (2027) workspace, stored **privately off-repo** (never in
   public GitHub). Restore = import that JSON into the same-year
   workspace. This export can only be taken by a signed-in admin; it
   has **not** been taken by this review (no production data access).
3. **Code rollback:** `supabase-migration-2026-10-20-v4-*.rollback.sql`
   restores the v3 gate verbatim — an emergency escape hatch only,
   because v3 is the known insecure gate and the rollback deletes
   non-2027 assignment rows (export them first).

## Disposable-environment attempt (2026-10-20)

- Supabase **branch**: rejected — *"Branching is supported only on the
  Pro plan or above"* (entitlement_required).
- **Disposable project**: rejected — the organisation's members are at
  the Free-plan limit of **2 active projects** (Year 11 Report + MAdv).
  Pausing or deleting either existing project was **not** done (one is
  production, the other unrelated).

Consequence: the real Supabase Auth/JWT/RLS run of
`supabase-migration-2026-10-20-v4-year-scoped-permissions.test.sql`
cannot be executed from this environment today. It remains a mandatory
pre-production gate for the school owner (upgrade to Pro for a branch,
free a project slot, or run it in another organisation). Engine-level
execution of the unmodified migration already passed 29/29 in real
PostgreSQL (PGlite, `tests/rls-pglite.mjs`) — that does not substitute
for the Supabase Auth/JWT run.
