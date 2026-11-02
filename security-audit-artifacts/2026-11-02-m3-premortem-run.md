# Security review: M3 pre-mortem run (branch `m3-premortem-run`)

Date: 2 Nov 2026. Reviewer: Claude with the `forge-security-review` skill (manual, code-based, rule-based). Scope: `git diff master..HEAD` in `codegeist/`: `manifest.yml`, `src/premortem/*.js`, `src/actions/index.js`, `src/resolvers/index.js`, `src/frontend/index.jsx`, the M3 changes in `src/engine/*.js`, `package.json` and `package-lock.json` (tests read for intent only). Rules loaded: `_global-forge`, `forge-authn-authz` (index, prefer-context-authz, missing-resolver-authz), `forge-rovo-agents` (index, agent-privilege-escalation), `forge-tenant-isolation` (index, global-state-warmstart), `forge-injection` (index, prototype-pollution), `forge-manifest-config` (index, permission-scopes), `forge-secrets-storage` (index), `forge-auditing` (index).

**Result: three confirmed findings (two Medium, one Low), all about who can read or write the stored pack and report.** The impersonation design holds: the queue consumer can only act as the user who clicked Run or asked the agent. Eight concerns need validation; one dependency note.

## Attack surface and entry points

| Entry point | Module | Input | Calls Jira as | Writes |
|---|---|---|---|---|
| `resolver` `getPremortem` | `jira:issuePanel` | `context.extension.issue.key`, `context.accountId` | `asUser()` | nothing |
| `resolver` `startRun` | `jira:issuePanel` | same | `asUser()` | KVS `run:<KEY>`, queue push |
| `resolver` `getRunStatus` | `jira:issuePanel` | `context.extension.issue.key` | no Jira call (KVS only) | nothing |
| `run-premortem-fn` (`runPremortem`) | Rovo action, TRIGGER | `epicKey` (LLM), `context.principal.accountId` | `asUser()` | KVS, queue push |
| `get-evidence-fn` (`getEvidence`) | Rovo action, GET | `epicKey` (LLM) | `asUser()` | nothing |
| `submit-premortem-fn` (`submitPremortem`) | Rovo action, UPDATE | `epicKey`, `reasonsJson`, `packId` (LLM) | `asUser()` | property `forewarned-premortem` |
| `get-premortem-fn` (`getPremortem`) | Rovo action, GET | `epicKey` (LLM) | `asUser()` | nothing |
| `premortem-run-fn` (`premortem/consumer.handler`) | queue consumer `premortem-run`, 300 s | `event.body` `{ runId, epicKey, accountId }` written by `startRun` | `asUser(event.body.accountId)` (offline impersonation) | KVS; properties `forewarned-evidence`, `forewarned-premortem` |

No web triggers, scheduled triggers, remotes, external fetch or SQL. No `asApp()` anywhere (`grep -rn "asApp(" src` is empty); the only `asUser(<id>)` is `src/premortem/consumer.js:106`.

## Authentication and authorization

- Identity always comes from the platform: resolvers use `context.accountId` (`src/resolvers/index.js:24,41`), Rovo actions use `context.principal.accountId` (`src/actions/index.js:53,56,66`). No payload field or agent input carries an account ID (`prefer-context-authz`).
- Impersonation: the only queue producer is `startRun` (`src/premortem/run.js:45`). Its event body is `{ runId: randomUUID(), epicKey: issue.key (Jira's canonical key), accountId (from the context) }`; no field comes from the user. Forge queues accept pushes only from the app's own functions, so no user can place another account ID in an event. The consumer impersonates exactly that account (`consumer.js:106`) and stops when the platform names a different principal (`consumer.js:49-52`; see concern 2). A run therefore acts only as the user who started it.
- Before queueing, `startRun` reads the epic as the user (404 means no access), checks `hierarchyLevel === 1` and checks `EDIT_ISSUES` through `/rest/api/3/mypermissions` (`run.js:22-33`). The consumer's and `submit-premortem`'s property writes go through `asUser`, so Jira enforces Browse and Edit again (`actions.js:55-56` maps a 403 to a message).
- The epics-only display condition is not relied on: `startRun` and the consumer (`fetchSnapshot`) check the hierarchy level themselves.
- Duplicate and retried events: a stale `runId`, a finished run, a `running` status or `event.retryContext` ends the event without work (`consumer.js:37-58`); the consumer never throws back to the queue.
- Gap (findings 1 to 3): reading and writing the stored pack and report is governed by Jira's entity property permissions, not by the app's visibility filter or validator.

## Injection and input validation (source → validation → sink)

- `epicKey` (LLM, Rovo context or panel context) → `ISSUE_KEY` regex (`actions/index.js:13-26`, `run.js:19`, `consumer.js:31`) → `route` path segments (`forge-jira.js:23,30-36`) and the KVS key `run:<KEY>` (`store.js:10`). The run status is always written under Jira's canonical `issue.key` (`run.js:28,43`). An over-long key only makes `kvs.get` throw, which ends in the generic action error.
- `reasonsJson` (LLM) → type check, 20,000-character cap, `JSON.parse` in a try block, an array of at most 20 (`validator.js:35-47`) → each reason rebuilt field by field: text trimmed and cut to 120/600/200 characters, likelihood from a fixed map, evidence IDs kept only if they exist in the stored pack, numbers and keys checked against the cited evidence (`validator.js:62-92`). Extra fields are copied only for Forewarned's own rule-based reasons (`keep`, `validator.js:90`; `actions.js:44` passes none) → report with a 24,000-byte check (`report.js:11-16,39-41`) → entity property → UI Kit `Text` (escaped; no `dangerouslySetInnerHTML`, `render: native`).
- Prototype pollution: none. Parsed objects are only read field by field, and object spreads of stored JSON (`report.js:24,40`, `visibility.js:22,29-33`) copy a `__proto__` key as an own property. No deep merge.
- `packId` (LLM) → trimmed string, only compared with `pack.packId` (`actions/index.js:62`, `actions.js:42`). No sink.
- The `validator.js` regexes are linear (the lookbehind pins each number match to one start position), and agent text is capped before `numbersIn` runs on it.
- No new JQL; M2's patterns and quoting are unchanged.

## Tenant isolation

- Forge KVS and queues are per installation, so `run:<KEY>` and queue events can't cross sites or environments.
- Module-level state is limited to `new Queue({ key: 'premortem-run' })` (`actions/index.js:16`, `resolvers/index.js:12`) and the imported `kvs` client, both stateless. Ports, senders, packs and reports are created per invocation; there is no cache.

## Secrets, PII and logging

- No secrets in source, manifest or config (a grep of the diff for token, secret, password, Authorization, Bearer and Basic credentials is empty).
- Logs carry codes and counts only (`consumer.js:45,77,96`, `actions/index.js:46`, `resolvers/index.js:27`, `engine/index.js:26-28`), except `resolvers/index.js:46` (concern 7).
- User-facing errors are fixed sentences; `JiraError` messages carry only the HTTP status and the request name (`jira.js:18-22`).
- Stored data holds account IDs (`builtFor`, `pack.js:36`; `runBy`, `report.js:33`) and display names inside facts. Finding 1 covers who can read them.

## Confirmed findings

### 1. Medium (4.3): anyone who can browse the epic reads the full stored pack and report through Jira's REST API, which bypasses the visibility filter

- CVSS v3.1: `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N`, base score 4.3, Medium. AV:N: Jira REST over the network. AC:L: one GET; the only precondition (a pack built by someone who can see more) is normal use. PR:L: any user with Browse on the epic. UI:N. S:U. C:L: keys, shortened summaries, statuses, assignee names and counts from spaces the reader can't browse. I:N, A:N.
- CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor), CWE-863 (Incorrect Authorization: the check exists only in the app's own read path).
- Source → sink:
  - The consumer builds the pack with the starter's permissions and writes it, and the report, as issue entity properties: `consumer.js:83-84` → `store.js:22` → `forge-jira.js:31-35` (`PUT /rest/api/3/issue/{key}/properties/forewarned-evidence` and `.../forewarned-premortem`).
  - The pack holds other-space data: open-blocker facts `${b.key} ${shorten(b.summary)} (${b.space}, ${b.statusName}, ${assignee}, …) blocks …` (`dependencies.js:39-40`), every link's key and summary (`pack.js:57`), other epics' keys in load facts (`load.js:50`). The report quotes them in the dependency reasons (`rules.js:58-60`).
  - The app hides that evidence from other readers only in its own read path (`visibility.js:1-4,12-34`, used at `actions.js:31,68`). Jira returns an issue property to any user with Browse projects (and issue-security access) on the issue; there is no app-only mode for issue properties.
- Exploit: lead A (browses CHK and PLT) runs a pre-mortem on CHK-12, which has an open blocker in PLT. Reader B browses CHK but not PLT. The panel correctly hides the dependency reason from B, but B requests the property directly and reads the PLT work item's key, summary, status and assignee, plus the full report.
- PoC (not run in this review; run it only on the demo site with the developer's OK; the token is B's own, set as an environment variable in B's own terminal and never written to a file):
  1. Setup on https://one-atlas-yexa.atlassian.net: user A with Browse on CHK and PLT; user B with Browse on CHK only (remove B from PLT's Browse projects permission). A clicks Run pre-mortem on CHK-12 and waits for the report.
  2. As B, open CHK-12: the panel says some reasons are hidden and shows no PLT key. This is the app path working as intended.
  3. As B:
     ```
     curl -s -u "$READER_EMAIL:$READER_TOKEN" -H "Accept: application/json" "https://one-atlas-yexa.atlassian.net/rest/api/3/issue/CHK-12/properties/forewarned-evidence"
     curl -s -u "$READER_EMAIL:$READER_TOKEN" -H "Accept: application/json" "https://one-atlas-yexa.atlassian.net/rest/api/3/issue/CHK-12/properties/forewarned-premortem"
     ```
     (Opening the same URLs in B's logged-in browser works too.)
  4. Vulnerable: `value.evidence[]` contains an `open-blocker` item whose `fact` and `links` name the PLT work item, and `value.builtFor` is A's account ID; the report's dependency reason names it too. Secure: no route gives B a PLT key or summary.
- Smallest fix: keep the pack and the report in Forge KVS (app-only, per installation) under the epic's issue ID (`pack:<issueId>`, `report:<issueId>`), and return them only after an `asUser()` read of the epic succeeds (the `port.issue(key, ['issuetype'])` call `startRun` already makes; it also returns the ID). `submit-premortem` then needs an explicit `EDIT_ISSUES` check (`port.myPermissions`) before its KVS write, because Jira no longer enforces it. Side effects: the consumer stops writing to Jira, so `write:jira-work` no longer needs `allowImpersonation` (concern 3); story 010's privacy line ("everything stays in Jira (entity properties)") changes. KVS reads and writes of values under 24 KB fit the free allowance at the planned run cap; confirm in the Billing Console on Friday.

### 2. Medium (4.3): the visibility filter checks a stale agent write-up against the new pack's evidence numbers, and skips filtering for the new pack's builder

- CVSS v3.1: `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N`, base score 4.3, Medium. PR:L: Edit on the epic for the shortest path (clicking Run). AC:L: needs only an earlier agent write-up, which is normal use. C:L: text from evidence the reader can't see.
- CWE-863 (Incorrect Authorization), CWE-200.
- Source → sink:
  - A new run keeps the previous agent write-up and only marks it stale (`report.js:24`). Its `evidenceIds` refer to the old pack, and evidence IDs are positions in each pack (`pack.js:51-52`), so they change from run to run.
  - `getPremortemAction` computes the hidden set from the current pack only (`actions.js:67-68`), and `reportForReader` filters `agent.reasons` with it (`visibility.js:26-34`).
  - `hiddenEvidenceIds` returns an empty set when the reader built the current pack (`visibility.js:13`), although the stale write-up was validated against another user's pack. The same line returns an empty set when the pack is missing, and nothing compares `report.packId` with `pack.packId`, so a report left over from another pack (the consumer writes the pack first and the report second, `consumer.js:83-84`) is filtered with the wrong IDs as well.
- Exploit: A (sees CHK and PLT) runs a pre-mortem on CHK-12 and saves an agent write-up whose reason names the PLT blocker (allowed, because the key is in the cited evidence). B (Edit on CHK-12, no Browse on PLT) clicks Run pre-mortem. B's pack has no PLT item and `builtFor` is B, so B's panel and B's `get-premortem` show A's stale write-up unfiltered, PLT key and words included. A reader without Edit gets the same leak whenever someone else's re-run shifts the numbering so that the old ID now points to an item the reader can see.
- PoC (manual UI steps on the demo site):
  1. As A: click Run pre-mortem on CHK-12; in Rovo chat say "Run a pre-mortem on this epic" and confirm the save; check that the panel shows an agent reason naming a PLT key.
  2. As B (Edit on CHK, no Browse on PLT): open CHK-12, click Run pre-mortem, wait for the report.
  3. Vulnerable: the section "Pre-mortem from the Forewarned agent" (with the stale warning) shows the PLT key and words; asking the agent "What does the saved pre-mortem say?" returns them too. Secure: B doesn't see the stale reasons (or sees only a note that the write-up is out of date).
- Smallest fix (fail closed in `getPremortemAction` / `reportForReader`): for every reader, drop `agent.reasons` when `report.agent.stale` is true, and drop all reasons when the pack is missing or `pack.packId !== report.packId`. A sturdier alternative: store the cited link keys with each saved reason at submit time and filter by keys with `readVisible`, independent of numbering and builder. Add a test for a re-run by a second user who can't see a blocker.

### 3. Low (3.5): users with Edit on the epic can forge the "validated" report and the evidence pack

- CVSS v3.1: `CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:U/C:N/I:L/A:N`, base score 3.5, Low. PR:L: Edit on the epic. UI:R: a victim must open the panel or ask the agent. I:L: the app's checked output can be replaced.
- CWE-345 (Insufficient Verification of Data Authenticity).
- Source → sink: Jira lets any user with Browse and Edit on the epic PUT or DELETE its properties. The report is read back and shown as Forewarned's output with no check (`actions.js:64-68`, `resolvers/index.js:24`, panel headings at `frontend/index.jsx:47-64`); a forged `agent` part is carried into every later report (`report.js:24`); a forged pack is served to other users' agents by `get-evidence` (`actions.js:29-31`), becomes the reference for `submit-premortem`'s validator (`actions.js:40-44`), and its `links[].key` list drives `bulkfetch` requests for every other reader (`visibility.js:14-15`; about one request per 100 keys, bounded by the 32,768-byte property limit).
- Exploit: an editor writes a report whose reasons say anything (a fake High risk, a phishing link, instructions aimed at the agent) without passing the validator. Every viewer's panel and Rovo agent present it as Forewarned's checked result, and through `get-premortem` and `get-evidence` the text reaches other users' agents, which can call `run-premortem` and `submit-premortem` as those users (stored prompt injection).
- PoC (writes to the demo site, so only with the developer's OK; undo by clicking Run pre-mortem, which rewrites both properties):
  ```
  curl -s -X PUT -u "$EDITOR_EMAIL:$EDITOR_TOKEN" -H "Content-Type: application/json" "https://one-atlas-yexa.atlassian.net/rest/api/3/issue/CHK-12/properties/forewarned-premortem" --data '{"version":2,"epicKey":"CHK-12","packId":"forged","status":"ok","checks":{},"ruleBased":{"generatedAt":"2026-11-02T00:00:00.000Z","reasons":[{"title":"Forged reason","likelihood":"High","explanation":"This text never passed the validator.","evidenceIds":["E1"],"mitigation":"None"}]},"agent":null,"runBy":"forged","runAt":"2026-11-02T00:00:00.000Z"}'
  ```
  Open CHK-12 as another user. Vulnerable: "Forged reason" appears as High under "From your Jira history (rule-based, no AI)". Secure: what Forewarned shows can change only through its own validated paths.
- Smallest fix: the move to KVS from finding 1 (only the app can write KVS). Until then, the panel shouldn't call the stored text checked.

## Security concerns (needs validation)

1. **Validator oracle on hidden evidence.** `submit-premortem` validates against the full stored pack (`actions.js:40-44`), not the caller's filtered view, and returns per-reason drop codes (`actions.js:47`); a kept reason that can't be saved returns the 403 sentence instead (`actions.js:56`). A viewer can cite a hidden ID (E-numbers are easy to guess) with a guessed key or number and learn from `unknown-key` or `unknown-number` versus "kept" whether the hidden item contains it: keys and numbers only, never words, and only by steering the agent's inputs. Moot while finding 1 stands. Fix: validate against `packForReader(pack, await hiddenEvidenceIds(port, pack, accountId))` with the principal passed in at `actions/index.js:58-63`. Test lead: as B, ask the agent to submit `[{"title":"PLT-31 risk","likelihood":"Low","explanation":"x","evidenceIds":["E3"],"mitigation":"x"}]` with E3 hidden, once with the right key and once with a wrong one, and compare the answers.
2. **The consumer's principal check may never run.** `consumer.js:49` skips the check when `context.principal` is absent, and whether Forge passes the pusher's principal to queue consumers wasn't verified (see evidence gaps). Not exploitable today, because only app code can push, but impersonation safety then rests only on `startRun` being the sole producer. Test lead: log `Boolean(context?.principal)` (never the ID) once in a development run. Keep a test or review rule that fails if any other file calls `queue.push` or `asUser(` with an argument.
3. **The impersonated token can do more than the consumer needs.** `allowImpersonation: true` on classic `write:jira-work` (`manifest.yml:125-126`) lets impersonated calls make any write the user can (edit, transition or delete work items), while the consumer only writes two issue properties. With finding 1's fix the consumer writes nothing to Jira and `allowImpersonation` can come off `write:jira-work`; otherwise use a granular issue-property write scope for impersonation (check the exact scope name in the Forge docs first). Scope changes are a major-version upgrade. The Confluence scopes (`manifest.yml:128-129`) are still unused (M2 concern 2).
4. **Agent text is checked only for numbers and keys.** `check()` (`validator.js:62-92`) lets any words through, so a prompt-injected agent (instructions planted in a work item summary that becomes an evidence fact) can save links, instructions or words copied from hidden evidence while citing only visible IDs. The text is shown to every reader and returned to other users' agents by `get-premortem`. `run-premortem` (TRIGGER) also lets an injected agent start runs as the user on other epics they can edit, which with finding 1 widens what is stored. Bounded by Rovo's confirmation of UPDATE actions; whether TRIGGER is confirmed needs checking on the site. Fix: drop reasons containing `http://`, `https://`, `www.` or markdown link syntax in the validator (a new drop code), and keep M2's prompt-injection test lead.
5. **Run-status oracle.** `get-evidence` and `submit-premortem` read `run:<KEY>` from KVS before any Jira read (`actions.js:13,28,39`), and the `getRunStatus` resolver never reads Jira (`resolvers/index.js:51-54`). For an epic the caller can't see, "a run is in progress" versus "no evidence" reveals that it exists and was run in the last 10 minutes; `getRunStatus` would also return timestamps and the error text if a caller can set `context.extension.issue.key` (EPSP-300; not verified). Fix: in the two actions read the property first (404 for an invisible epic) and check the run status afterwards; for `getRunStatus`, accept the risk or add the same `asUser` read.
6. **No run cap yet (cost abuse).** Any user with Edit on an epic can start runs back to back (one at a time per epic, up to about 110 Jira requests and 300 s each) and in parallel across epics, through the panel, the agent or direct resolver calls. With a $0 budget this is the main abuse path. Story 009 (M8, 15 runs per site per day) is the planned control; until it ships, keep the app on the demo site and the judges' sites only.
7. **One log line prints `error.message`.** `resolvers/index.js:46` logs the message where every other handler logs `error.name`. KVS and Events errors carry server-provided messages (`@forge/kvs` `ForgeError`, `@forge/events` `InternalServerError`) that may include the key `run:<KEY>` or request details. Fix: log `error.name`, as `actions/index.js:46` does.
8. **No record of who saved the agent write-up.** `submit-premortem` doesn't receive the principal (`actions/index.js:58-63`) and the write-up stores no `savedBy` (`report.js:39-41`); Jira's history doesn't show property changes. Add `savedBy` from `context.principal.accountId` along with finding 1's storage move. Already logged in the backlog on 2 Nov and not repeated as findings: comparison epics and aggregate counts in a stored pack (for example "N elsewhere" in load facts, `load.js:48`) are not re-checked for other readers, and work-item-level security stays story 002 open question 1.

## Dependencies

M3 adds `@forge/events` 2.1.7 (with its own nested `@forge/api` 7.2.2, `@forge/auth` 0.0.9, `@forge/egress` 2.3.2, `@forge/manifest` 12.9.0, `ajv` 8.20.0, `glob` 13.0.6, `minimatch` 10.2.6) and `@forge/kvs` 2.1.1 (with `@forge/storage`). `npm audit` was not run in this review (see evidence gaps), so their advisory status is unknown; app code calls only `Queue.push`, `kvs.get` and `kvs.set`. M2's note on the `-next` UI packages still stands. Follow-up: run `npm audit --omit=dev` in `codegeist/` and compare with M2's 13 issues.

## Evidence gaps

- The skill's static analyzer (`fsrt.exe`, which `scripts/run_static_analysis.ps1` downloads from GitHub at run time) was **not run**. This review was limited to a manual, code-based reading with no binary downloaded or executed; Windows Smart App Control would also likely block an unsigned executable. Semgrep, Snyk, gitleaks and `npm audit` were not run for the same reason.
- No `forge` CLI command and no request to any Atlassian site was made, and the Forge docs MCP was not used. Platform behaviour is taken from Atlassian's REST and Forge documentation as known to the reviewer and needs confirming on the demo site: issue property read and write permissions and whether properties outlive an uninstall (findings 1 and 3), whether queue consumers get `context.principal` (concern 2), per-scope `allowImpersonation` semantics (concern 3), Rovo's confirmation of TRIGGER and UPDATE actions (concern 4), and whether a caller can set `context.extension.issue.key` (concern 5).
- None of the PoCs were executed. They use the tester's own API token in their own terminal; tokens never go into files or chat.

## Remediation (2 Nov 2026, same branch)

The developer chose to move the stored pre-mortem off the epic. Unit tests cover every change below (185 pass); the site check follows the next deploy.

| Finding | Status | Change |
|---|---|---|
| 1. Pack and report readable through Jira's REST API | Fixed | The pack and the report are one Forge KVS value, `premortem:<issue ID>` (`src/premortem/store.js`; by ID, so a moved epic or a recreated space key can't pick up another epic's data). The consumer writes nothing to Jira. Every action and the panel read the epic as the user (`GET issue`) before returning anything stored; a user who can't see it gets "doesn't exist, or you don't have permission to see it". |
| 2. Stale agent write-up filtered with the wrong evidence IDs | Fixed | `reportForReader` gives no reader a stale write-up's reasons, the builder included, and the panel asks for a new write-up. A report and a pack can no longer come from different runs, because they are written and read as one value. |
| 3. Report and pack forgeable by users with Edit | Fixed | Nothing is stored on the epic. `submit-premortem` checks `EDIT_ISSUES` itself before saving and records `savedBy`. |
| Concern: validator oracle | Fixed | `submit-premortem` validates against `packForReader` for the caller, so a reason citing hidden evidence is dropped as `no-history-evidence`, the same as an ID that doesn't exist. |
| Concern: impersonation scope too wide | Fixed | `write:jira-work` no longer has `allowImpersonation`; only `read:jira-work` keeps it. |
| Concern: links in agent text | Fixed | The validator drops a reason whose text holds a web address or a markdown link that the epic summary and its cited evidence don't already contain (code `link`), so Forewarned's own reasons on such summaries still pass. Other free text is logged as a known limit in `docs/backlog.md`. |
| Concern: run status read before any Jira read | Fixed | The actions read the epic as the user first. `getRunStatus` serves the panel's own issue from the signed Forge context. |
| Concern: `error.message` in a log line | Fixed | `resolvers/index.js` logs `error.name`. |
| Concern: no record of who saved a write-up | Fixed | `agent.savedBy` (account ID). |
| Concern: no reader ID fails open (re-review) | Fixed | The filter always runs as the user in session, the builder included (access can be taken away after a run); no account ID is involved. |
| Concern: load fact names more epics than it links (re-review, ponytail) | Fixed | The fact names only its linked epics ("in 12 other epics in progress, including …"). |
| Concern: principal check may never run | Open | Logged in `docs/backlog.md`; safe while `startRun` is the only producer. |
| Concern: no run cap yet | Open | Story 009 (M8). |

The old entity properties on the demo site (`forewarned-evidence` and `forewarned-premortem` on CHK-12 and PLAT-1) are no longer read or written. The developer deleted all four on 2 Nov 2026 (each DELETE returned 204; a GET now returns 404).
