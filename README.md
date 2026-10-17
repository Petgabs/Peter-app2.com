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
