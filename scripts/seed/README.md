# Forewarned seed data

A year of realistic delivery history for the demo site, so the Forewarned panel on the epic "Checkout v2 launch" finds real reasons instead of an empty state. Story: `docs/stories/001-seed-data.md` (backlog M1). It is labelled "seeded demo history" everywhere it appears (video, Devpost, space descriptions).

| File | What it is |
|---|---|
| `generate.mjs` | Writes `forewarned-demo.json` and `answer-key.json`. Node 22+, no npm dependencies, fixed random seed: every run is byte-identical. |
| `forewarned-demo.json` | The Jira JSON importer file: spaces CHK "Checkout" (162 work items) and PLT "Platform" (32), 177 parent links, 7 "Blocks" links. It names no users. |
| `answer-key.json` | The planted risks P1–P5, the decoys D1–D2, the comparable epics with their numbers, and the inventory queries with expected counts. Test oracle for stories 002 and 003. |
| `personas.json` | The 6 seed roles mapped to display names of existing demo-site users. No emails, account IDs or secrets. |
| `assign-personas.mjs` | The post-import step: assigns each role's work items to its user, adds any missing role label, then checks every inventory line (PASS or FAIL). |
| `test/` | `node --test` checks for every acceptance criterion that can be checked without a site. `fake-jira.mjs` stands in for Jira so the post-step runs end to end in a test. `helpers.mjs` turns the import file into plain records (reusable by story 002's tests). |

All commands below run from `codegeist/`.

```
npm run seed:generate      # rewrite forewarned-demo.json and answer-key.json
npm run seed:test          # 37 checks, a few seconds, no site needed
npm run seed:assign        # post-import step (needs the environment variables below)
```

Generator options: `--today YYYY-MM-DD` writes absolute dates counted from that day instead of relative ones; `--out DIR` writes somewhere else. The committed files are the default output, and a test fails if they are stale.

## Dates

Every date is relative to the import: `"P-150D"` is 150 days before the import and `"P42D"` is 42 days after it, so the history is always "the last 12 months". Both directions are proven with the Jira JSON importer: past dates in spike M0c, and future dates in the 31 Oct 2026 check (`docs/spikes/m1/fws-future-dates.json`: `created` "P-5D", `duedate` "P42D", unreleased version `releaseDate` "P30D" all landed on the right day). `--today` is kept only as a fallback.

## What the seed plants

People are roles, not users. Each external ID starts with a role prefix: `ll` launch lead, `bk` backend, `em` engineering manager, `mb` mobile and front end, `qa` QA, `pf` platform, `un` unassigned. Day numbers below count from the import day.

| ID | Planted for | Where (external IDs) | Expected numbers |
|---|---|---|---|
| P1 | Platform dependency repeats (dependencies) | `un-plt-e03-07` (open, unassigned, due day -5) blocks `bk-chk-e11-03`; past PLT blockers in 5 comparable epics | 5 days overdue; 4 of 5 PLT-blocked comparable epics finished late; Wallet top-up `ll-chk-e07` 42 days late, its blocker `pf-plt-e02-02` resolved 28 days after its own due date |
| P2 | Comparable epics usually finish late (slip) | 8 comparable epics, 6 with a due date | 5 of 6 late, median 21 days (12 to 42) |
| P3 | The plan is shorter than history (slip) | `ll-chk-e11` planned 56 days | median duration 77 days (8 epics, 2 without a due date); 7 of 8 took longer than 56 days |
| P4 | Scope keeps growing (scope) | `ll-chk-e11` and the 8 comparable epics | 15 at start, 6 added (40%); past median 40% (20% to 60%) |
| P5 | One person is spread thin (load) | backend: Checkout v2, Gift cards at checkout `em-chk-e12`, Payment gateway API v3 `pf-plt-e03` | 14 open, 6 in Checkout v2; median for the 5 people on the epic is 3 |
| D1 | Decoy: must not be flagged | `pf-plt-e03-02` blocked `bk-chk-e11-05` but is resolved | no open-blocker evidence for it |
| D2 | Decoy: must not be flagged | mobile role: 47 done, 2 open | no load reason about mobile |

Load numbers count seeded work items only; on a live site each user also has the open work items they already had. Day counts have a tolerance of ±1 because of time zones. The full expected evidence is in `answer-key.json`.

## Import on a site (target was 10 minutes or less; measured about 15)

Measured end to end: **about 15 minutes** on 7 Nov 2026, on a fresh developer site following the judge path in `JUDGES_SETUP.md` (two spaces, the import, the self-assign bulk edit and a run; the import itself took about 6 minutes). That run used no personas and no post-step (steps 5–7 below), which add a few minutes (AC 26).

Before the first recording, delete the M0c spike space **FWS** and its work items (it also holds the future-date check item).

1. **Note the user count.** admin.atlassian.com → Directory → Users. The import must not change it (AC 8).
2. **Create two spaces** (Jira → Create space → Scrum → choose the **company-managed** option). Names and keys exactly:
   - Checkout, key `CHK`
   - Platform, key `PLT`

   In each: Space settings → Details → paste the description `Seeded demo history generated by Forewarned's seed script. All dates are relative to the import date.` and check that Default assignee is **Unassigned**. The importer adds work items to existing spaces and may not set their description.
3. **Delete the template's sample work items.** The Scrum template adds 2 work items to each new space (CHK-1, CHK-2, PLT-1, PLT-2). Search `project in (CHK, PLT)`, select all 4 and delete them. Do this before importing.
4. **Import.** Settings (gear) → System → External System Import → **JSON**. If the page shows a new import experience without a JSON option, use "switch to the old experience". Upload `codegeist/scripts/seed/forewarned-demo.json` and start the import; there is nothing to map. Expected result: "0 projects and 194 work items imported successfully".
5. **Check `personas.json`.** Each display name must be the public name of an existing, active user on the site, each role a different user. On our demo site these are the developer's alias accounts named "‹Name› (demo)" plus Ada Isadora: set the alias accounts' public names first, or the post-step stops with "no active user with this exact name". On another site, replace the names (a `"TODO: …"` name makes the post-step refuse to run).
6. **Run the post-step** with a short-lived API token that you create and keep in your own terminal only:
   1. https://id.atlassian.com/manage-profile/security/api-tokens → **Create API token** (the classic token, not "with scopes") → name `forewarned-seed`, expiry 7 days → copy it.
   2. In PowerShell, from `codegeist/`:
      ```powershell
      $env:JIRA_SITE_URL = "https://one-atlas-yexa.atlassian.net"
      $env:JIRA_EMAIL = Read-Host "Atlassian email"
      $env:JIRA_API_TOKEN = [Net.NetworkCredential]::new("", (Read-Host "API token" -AsSecureString)).Password
      npm run seed:assign
      Remove-Item Env:JIRA_EMAIL, Env:JIRA_API_TOKEN
      ```
      (Git Bash: `read -rp "Email: " JIRA_EMAIL; read -rsp "Token: " JIRA_API_TOKEN; export JIRA_SITE_URL=https://one-atlas-yexa.atlassian.net JIRA_EMAIL JIRA_API_TOKEN`.)
   3. Revoke the token on the same page when you are done.

   The script prints each user's existing open work items outside CHK and PLT and stops if any has more than 5 (that would hide P5). Then it assigns about 187 work items (`un-` items stay unassigned), adds any role label from the file that the site lacks (only a site imported before the labels existed needs this), and runs every inventory line. It writes no file and never prints the token, the email or API responses. It is safe to run again.
7. **Check.** Every inventory line must say PASS (AC 27). Then check the user count from step 1 is unchanged, and open Wallet top-up in CHK: due date, resolution date 42 days later, and an "is blocked by" link to a PLT work item.

To import again, delete CHK and PLT and start from step 2. Importing into spaces that already hold the seed creates duplicates (the post-step detects this and stops).

## Role queries (AC 25)

Each role's work items can be found without the post-step, for example to self-assign them with one bulk edit:

| Role | Persona | Query | Work items |
|---|---|---|---|
| Launch lead | Ayesha | `project in (CHK, PLT) AND labels = seed-role-launch-lead` | 11 |
| Backend engineer | Bilal | `project in (CHK, PLT) AND labels = seed-role-backend` | 67 |
| Engineering manager | Sana | `project in (CHK, PLT) AND labels = seed-role-engineering-manager` | 5 |
| Mobile and front-end engineer | Omar | `project in (CHK, PLT) AND labels = seed-role-mobile` | 49 |
| QA engineer | Hira | `project in (CHK, PLT) AND labels = seed-role-qa` | 16 |
| Platform engineer | Danish | `project in (CHK, PLT) AND labels = seed-role-platform` | 24 |

The 7 `un-` work items stay unassigned. Role labels are on child work items only, never on epics: the evidence engine matches comparable epics on components and labels, so the role's epics aren't in these queries. A prefix search on the importer's field (`"External issue ID" ~ "bk*"`) doesn't work: Jira rejects it with HTTP 400 (M1); the importer creates the field with the exact-text searcher.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Import fails at "Retrieving projects" | A space is missing or its key differs. The importer can't create spaces: create CHK and PLT first (step 2), company-managed, exactly these keys. |
| `chk-work-items` or `plt-work-items` FAIL, 2 too many | The template's sample work items are still there (step 3). The post-step also prints a note about work items that aren't in `forewarned-demo.json`. |
| Counts about twice too high, or the post-step says items exist more than once | The file was imported twice. Delete CHK and PLT, recreate them and import once. |
| Post-step: "N of 194 seeded work items were not found by space and summary" | The file isn't imported yet, or a seeded work item's summary was edited. Import once, or undo the edit. |
| `chk-blocked-work-items` or `plt-blocking-work-items` FAIL | Cross-space "Blocks" links did not import, or the site's link type is renamed. Cross-space links are proven on the demo site (M1, 31 Oct 2026: 7 of 7). The linking page in Jira settings (issue or work item linking) must list a type named "Blocks" (blocks / is blocked by); if it has another name, the generator's link name must change. |
| `role-query-*` lines FAIL with 0 or too few | The spaces were imported from a file without role labels. Run the post-step again: it adds the missing labels. |
| Post-step: "no active user with this exact name" or "N active users have this name" | Fix the display name in `personas.json`, or pick another user. |
| Post-step: users have more than 5 open work items | Pick other users. Fallback from story 001 open question 1: invite up to 5 accounts on the developer's own email aliases (used on our demo site with the developer's yes, 31 Oct). |
| HTTP 401 | Wrong email or token, or a token with scopes (those work only through the api.atlassian.com gateway, not the site URL). Use a classic API token. |
| Seeded work items are assigned to the space lead right after the import | The space's Default assignee is not Unassigned. The post-step unassigns the `un-` work items anyway; set Default assignee to Unassigned for next time. |
| `open-*` or `role-query-*` lines FAIL right after the edits | Search counts can lag a few seconds; the script retries 3 times. Run it again: it skips work items that are already right. |
| `chk-description` or `plt-description` FAIL | The importer didn't set the description of the existing space. Paste it in Space settings → Details (step 2). |
| A day count is off by one | Time zone. The answer key allows ±1 day; the video shows whatever the panel shows. |

## Notes

- **"External issue ID" field.** The JSON importer adds a site custom field "External issue ID" and fills it with each work item's `externalId`. It is harmless, and nothing here uses it: on the demo site the REST API doesn't return the field and Jira rejects prefix searches on it (M1). The post-step finds seeded work items by space and summary instead (don't edit their summaries before running it), and the role queries use labels.
- **FWS spike space.** The M0c spike space FWS (3 work items, plus the 31 Oct future-date check item) must be deleted before the first recording (AC 30).
- **Not in the app bundle.** Forge packages only the code reachable from the handlers and resources in `manifest.yml` (all under `src/`), plus `app.package.extraFiles`, which the app doesn't use. Nothing in `src/` imports from `scripts/`, and a test checks that. No ignore file is needed.
- **What the file may contain.** The file uses only import keys proven on a real import (M0c, including `labels`, and `components` in M1), plus `description` (documented by the importer). Role labels come with the import, so a judge's site has them without the post-step. It never contains `assignee`, `reporter`, `author`, `watchers`, `voters`, `users` or any person's name; the generator refuses to write such a file.
