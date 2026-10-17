# Peter-app2.com

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
auto-configuration, role gating, conflict merging and the status messages above.

First deployment without any token yet: run **`deploy.ps1`** in Windows PowerShell
(prompts for the Supabase URL, anon key and a GitHub token, then commits
`cloud-config.json`), or use **Download cloud-config.json** in the app and commit the file
manually.

## GitHub cloud data (optional)

The website code lives in this repository (public). **Student report data never does.**
When the GitHub backend is selected in Cloud sync, encoded JSON is written to a separate
**private** repository (default: `Petgabs/report-data`) through the GitHub Contents API,
using a fine-grained access token limited to that repository.
