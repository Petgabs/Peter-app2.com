# Peter-app2.com

Year 11 Preliminary Student Report Studio — a single-page app published on GitHub Pages.

## How the site is built

```
index.html              the whole application (UI, data model, cloud sync)   ~58 KB gzipped
vendor/pdf-libs.js      html2canvas + jsPDF + pako — fetched only when a PDF is
                        downloaded, so it is never paid for on a normal visit
sw.js                   service worker: caches the app shell so a computer that
                        has visited once can reopen the app with no network
assets/*.png            school emblem, school-name image and report watermark
cloud-config.json       published Supabase URL/anon key + repository settings
supabase-setup.sql      run once in the Supabase SQL editor
deploy.ps1              first-time publish helper for Windows
tests/smoke.mjs         the app booted in jsdom against mocked clouds
supabase-migration-2026-10-18-fix-rls-recursion.sql
                        reviewed fix for the 42P17 RLS recursion (NOT yet
                        applied to the live project) + its rollback file;
                        see REPAIR-2026-10-18.md
```

Nothing is bundled or transpiled — the files are served exactly as they are committed.

## Safety nets for everyday use

- **Recovery snapshots:** before any import, student/subject deletion or local reset,
  the current workspace is snapshotted in the browser (Admin -> Data transfer, newest
  five). "Snapshot now" takes one manually; restoring a snapshot snapshots the
  current workspace first, so a restore can itself be undone. Export the full JSON
  backup as well before major changes — snapshots live in the same browser.
- **Draft autosave:** while typing a report entry, a draft is kept on this device and
  restored if the browser is closed before Save. Saving the entry clears its draft.
- **Last edited:** subject rosters show when an entry was saved and by whom.
- **Idle lock:** after 45 minutes without activity the app signs itself out on that
  computer (work is already saved). Override for tests with `window.__IDLE_LOCK_MS__`.
- **Error banner:** an unexpected error shows a red banner explaining that data is
  still saved, instead of a blank page.
- **CSV roster import:** Admin -> Students -> Import CSV roster with columns
  `pinyin,english,classTeacher,subjects` (subjects = subject codes separated by `;`).
  Existing students are skipped. The roster lists also have a name search.

## Working without a connection, and staying current

- **Offline:** a red banner appears at the top of the screen. Everything a teacher types is
  still saved in that browser; when the connection returns the app syncs automatically.
- **Staying current:** while a device is signed in, the cloud is re-read every **3 minutes**,
  whenever the tab is opened again, and immediately after a reconnection. If another computer
  has newer work, it is merged in (newer entry wins) and a toast says so. A refresh never
  interrupts an open entry form or unsaved changes.

## Cloud data

The website code lives in this repository (public). **Student report data never does.**
When Cloud sync is enabled in the app, encoded JSON is written to a separate **private** repository
(default: `Petgabs/report-data`) through the GitHub Contents API, using each teacher's own
fine-grained access token limited to that repository.

Layout of the private data repository:

```
data/settings.json            school and signatory settings
data/roster.json              student roster
data/subjects.json            courses and learning criteria
data/summaries.json           optional profile summaries
data/reports/<subject>.json   grades, learner profile and comment per subject
```

## School cloud (recommended)

Teachers sign in with **school-issued usernames and passwords** — no GitHub accounts required.
Data is stored in the school's **Supabase** project (free tier) with row-level security.

One-time setup (coordinator):

1. Create a free project at [supabase.com](https://supabase.com).
2. Run [`supabase-setup.sql`](./supabase-setup.sql) in the project's SQL editor.
3. Authentication → Users → **Add user** for each teacher, with user metadata
   `{"username":"hsc-wang","display_name":"Ms Wang","role":"teacher"}`
   (`"role":"admin"` for the coordinator). Turn **off** "Confirm email" so accounts work immediately.
4. Copy the **Project URL** and **anon key** (Settings → API) into the app's **Cloud sync** page
   (or the first-time setup on the sign-in page) on each computer.

Teachers then sign in on the website with their school account; every save is stored in the
school database with their name attached (`updated_by`), and the browser keeps only a cache.

### The GitHub cloud turns on automatically

After a staff sign-in, the app reads the shared registry from the school database
(`app_config`) and enables the GitHub connection by itself:

- **Signed in with a school account** — the school cloud stays the primary store and every
  save is **mirrored to the GitHub repository** in the background (newer entry wins if the
  repository copy has changed). The badge reads **Cloud: school + GitHub**.
- **Signed in with a local account** on a device that already holds the repository token —
  GitHub becomes the active backend immediately, so reporting still syncs.

Nothing needs to be opened or configured by teachers.

> This requires `supabase-setup.sql` to be re-run once: the `app_config` table is now
> readable by every signed-in staff member (writes remain admin-only) so their devices can
> receive the repository token. If you prefer to keep the token admin-only, remove the
> `staff read app config` policy — teachers then stay on the school cloud only.

### Set up every computer at once (admin)

Sign in, open **Cloud sync** (admins only), and press **Save and publish everywhere** in the
*Shared device setup* card:

- **`cloud-config.json`** is committed to this website repository with the Supabase URL,
  anon key and data-repository name — public values only.
- The **full registry** (including the GitHub repository token) is written to the school
  database table `app_config`, readable **only by admin accounts** (row-level security).

Every computer that opens the website then:

1. reads `cloud-config.json` on start-up, so **School account login is already configured**
   (no manual URL/key entry);
2. receives the repository token automatically after an **admin** signs in.

Teachers never see the token and never need GitHub. Cloud sync itself now asks for the
admin login when a teacher opens it.

> Already ran `supabase-setup.sql` before this update? Run it again — it adds the
> `app_config` table and admin policy (safe to re-run).

### What the cloud badges mean

| Badge | Meaning | What to do |
| --- | --- | --- |
| **Cloud: school / GitHub** | Connected and syncing | Nothing |
| **Cloud: sign in** | The cloud is configured on this device, but no school account is signed in **or** the session ended | Sign in with the school account (or sign out of the local account and choose *School account*) |
| **Cloud: off** | No backend is configured on this device | Admin: open **Cloud sync** → enter URL + anon key (or publish `cloud-config.json`) |
| **Cloud: error** | Connected, but the last sync failed | The reason is shown on **Cloud sync**; press *Test connection* or *Sync now* |

The dashboard shows the same explanation as a notice, and **Cloud sync** shows a banner with
the exact next step. A failed publish to the website repository or a missing `app_config`
table is *not* treated as a cloud failure — report sync keeps working.

### If the badge says "Cloud: off"

That means this computer has no cloud address at all — normally because
`cloud-config.json` has not been published to this repository yet, so nothing
can configure itself. Fix it once, as the coordinator:

1. Sign in (local Admin account works) → **Cloud sync**
2. Press **Check setup** — it reports exactly what is missing: the website file,
   the Supabase URL/key, the GitHub token, and the read/write permission on each repository
3. Enter the Supabase **project URL + anon key**, and the GitHub token, then
   **Save and publish everywhere**

The token must include **both** repositories:

| Repository | Permission | Why |
| --- | --- | --- |
| `Petgabs/report-data` (or your data repo) | Contents: Read and write | stores the report data |
| `Petgabs/Peter-app2.com` (this website) | Contents: Read and write | lets the app commit `cloud-config.json` |

If the token only covers the data repository, press **Download cloud-config.json** and
commit that file to this repository with GitHub's web editor. Publishing is verified by
reading the file back, and **Check setup** tells you when the file is present.

### Troubleshooting

- **"School database: the app_config table is missing"** — re-run `supabase-setup.sql`.
  Report data still syncs; only sharing settings between computers needs the table.
- **"Data repository … is not available to this token"** — the private data repository does not
  exist yet or was not included in the token. Create it at
  `https://github.com/new?name=report-data&visibility=private`, then edit the token →
  *Repository access* → add the repository with *Contents: Read and write*. GitHub sync is
  optional: the school cloud already stores the report data, so you can simply disconnect GitHub.
- **"Website repository: not published"** — the GitHub token must have *Contents: Read and
  write* on `Petgabs/Peter-app2.com`. Use **Download cloud-config.json** and commit the file
  instead.
- **A computer keeps showing an old Supabase project** — the published `cloud-config.json`
  is the source of truth; fix it (or delete it) and reload.

### Tests

```bash
cd tests && npm install && npm test
```

The suite boots the real `index.html` in jsdom against a simulated Supabase (auth, REST,
RLS-style rules), GitHub Contents API and website file, covering sign-in, publish,
auto-configuration, role gating, conflict merging, the status messages above, the offline
banner, the background refresh and the page-weight limits (external libraries, image files).

**210 assertions**, including recovery snapshots, CSV import, draft restore across a
restart, modal Escape/focus behaviour, the idle lock, the error banner, the
42P17 role-failure behaviour, CAL A-D mapping (imported and already-stored)
and the first-login preview/PDF race. They also run automatically on every push and pull request through
`.github/workflows/tests.yml`, which additionally parses the app script and checks that
`vendor/pdf-libs.js` and the image files are still present.

> Note: one-click PDFs are page images, so their text is not selectable. Use
> **Generate PDF / Print** when a parent or the school needs selectable text.

The browser PDF path (Download PDF) cannot be exercised in jsdom, because jsdom does not
fetch external scripts. To check it in a browser: open a report preview, press **Download
PDF**, and confirm `vendor/pdf-libs.js` appears in the network tab at that moment — not on
the initial page load.

First deployment without any token yet: run **`deploy.ps1`** in Windows PowerShell
(prompts for the Supabase URL, anon key and a GitHub token, then commits
`cloud-config.json`), or use **Download cloud-config.json** in the app and commit the file
manually.

## GitHub cloud data (optional)

The website code lives in this repository (public). **Student report data never does.**
When the GitHub backend is selected in Cloud sync, encoded JSON is written to a separate
**private** repository (default: `Petgabs/report-data`) through the GitHub Contents API,
using a fine-grained access token limited to that repository.
