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

First deployment without any token yet: run **`deploy.ps1`** in Windows PowerShell
(prompts for the Supabase URL, anon key and a GitHub token, then commits
`cloud-config.json`), or use **Download cloud-config.json** in the app and commit the file
manually.

## GitHub cloud data (optional)

The website code lives in this repository (public). **Student report data never does.**
When the GitHub backend is selected in Cloud sync, encoded JSON is written to a separate
**private** repository (default: `Petgabs/report-data`) through the GitHub Contents API,
using a fine-grained access token limited to that repository.
