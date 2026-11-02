// The fetch layer of the evidence engine (story 002): reads one epic and its space's history from
// Jira through the port (jira.js) and returns a plain-data Snapshot for compute (pack.js).
//
// Every list read has a cap and totals come from approximate counts (AC 32), and every value that
// goes into JQL is checked against a strict pattern first, so input from the Rovo chat can never
// change a query. All calls run as the requesting user (forge-jira.js), so Jira only returns work
// items from spaces that user can browse (AC 2).

import { selectComparable } from './comparable.js';
import { compareKeys, dayOf } from './format.js';
import { JiraError } from './jira.js';
import { rankPeople } from './load.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
const SPACE_KEY = /^[A-Z][A-Z0-9_]*$/;
const ACCOUNT_ID = /^[A-Za-z0-9:_-]+$/;
const TYPE_ID = /^\d+$/;

const CONCURRENCY = 5;
const MAX_CANDIDATES = 50;
const PAGE = 100;
const MAX_CHILD_PAGES = 5; // 500 open children (AC 18)
const MAX_PEOPLE_COUNTED = 25;
const MAX_PEOPLE_READ = 10; // whose other epics are read (AC 19)
const MAX_PERSON_PAGES = 2; // 200 open work items per person (AC 19)
const MAX_CHANGELOG_PAGES = 5;
const DAY_MS = 86400000;

const EPIC_FIELDS = ['summary', 'status', 'issuetype', 'project', 'duedate', 'created', 'resolutiondate', 'components', 'labels', 'assignee'];
const BLOCKER_FIELDS = ['summary', 'status', 'assignee', 'duedate', 'resolutiondate', 'project'];
const BLOCKED_BY = 'is blocked by';
const HIDDEN_NOTE = "Some links point to spaces you can't see.";

const quote = (value) => `"${value}"`;
const person = (user) => (user?.accountId ? { accountId: user.accountId, displayName: user.displayName ?? 'Former user' } : null);

// Runs fn over items with at most 5 requests in flight; the first failure stops the rest.
async function mapLimit(items, fn) {
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next;
      next += 1;
      try {
        results[i] = await fn(items[i], i);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

// Reads at most maxPages pages of a JQL search.
async function searchPages(port, body, maxPages) {
  const issues = [];
  let nextPageToken;
  for (let pageNo = 0; pageNo < maxPages; pageNo += 1) {
    const page = await port.search({ ...body, ...(nextPageToken ? { nextPageToken } : {}) });
    issues.push(...page.issues);
    if (page.isLast || !page.nextPageToken) break;
    nextPageToken = page.nextPageToken;
  }
  return issues;
}

const count = async (port, jql) => (await port.count(jql)).count;

// Reads work items by key in batches of 100. Keys the user can't see are simply not returned.
async function readVisible(port, keys, fields) {
  const chunks = [];
  for (let i = 0; i < keys.length; i += PAGE) chunks.push(keys.slice(i, i + PAGE));
  const pages = await mapLimit(chunks, (chunk) => port.bulkIssues({ issueIdsOrKeys: chunk, fields }));
  return pages.flatMap((p) => p.issues ?? []);
}

// Status changes per issue ID, oldest first, as { day, category }. A history item names its new
// status by ID; imported history may carry only the name, so the name is the fallback. No
// `fieldIds` filter is sent: imported history items have `field: 'status'` but no `fieldId`
// (seen on the demo site, M2 site run), and Jira's filter would drop them all.
async function statusMoves(port, issueIds, statuses) {
  const byId = new Map(statuses.map((s) => [String(s.id), s.statusCategory?.key]));
  const byName = new Map(statuses.map((s) => [String(s.name ?? '').toLowerCase(), s.statusCategory?.key]));
  const categoryOf = (item) => byId.get(String(item.to)) ?? byName.get(String(item.toString ?? '').toLowerCase());
  const moves = new Map();
  let nextPageToken;
  for (let pageNo = 0; pageNo < MAX_CHANGELOG_PAGES; pageNo += 1) {
    const page = await port.changelogs({ issueIdsOrKeys: issueIds, maxResults: 1000, ...(nextPageToken ? { nextPageToken } : {}) });
    for (const log of page.issueChangeLogs ?? []) {
      const list = moves.get(log.issueId) ?? [];
      for (const history of log.changeHistories ?? []) {
        const day = dayOf(history.created);
        for (const item of history.items ?? []) {
          if ((item.fieldId ?? item.field) === 'status' && day !== null) list.push({ day, category: categoryOf(item) });
        }
      }
      moves.set(log.issueId, list.sort((a, b) => a.day - b.day));
    }
    if (!page.nextPageToken) break;
    nextPageToken = page.nextPageToken;
  }
  return moves;
}

// One epic as compute needs it. Start: first move into an In Progress category status, else the
// created day (AC 9). Finish: the resolution date, else the last move into Done (AC 8). A missing
// or unreadable created date falls back to today (AC 28).
function toEpic(issue, moves, today) {
  const f = issue.fields;
  const own = moves.get(issue.id) ?? [];
  const created = dayOf(f.created) ?? today;
  const statusCategory = f.status?.statusCategory?.key ?? 'new';
  const started = own.find((m) => m.category === 'indeterminate');
  const doneMoves = own.filter((m) => m.category === 'done');
  const finish = statusCategory === 'done' ? dayOf(f.resolutiondate) ?? (doneMoves.length ? doneMoves.at(-1).day : null) : null;
  return {
    key: issue.key,
    summary: f.summary ?? '',
    space: f.project?.key ?? issue.key.split('-')[0],
    statusCategory,
    created,
    start: started ? started.day : created,
    due: dayOf(f.duedate),
    finish,
    components: (f.components ?? []).map((c) => c.name),
    labels: f.labels ?? [],
    assignee: person(f.assignee),
  };
}

// Keys of the work items that block this one ("is blocked by" links with an inward issue).
const blockerKeysOf = (issue) => [...new Set((issue.fields.issuelinks ?? [])
  .filter((l) => l.type?.inward === BLOCKED_BY && ISSUE_KEY.test(l.inwardIssue?.key ?? ''))
  .map((l) => l.inwardIssue.key))].sort(compareKeys);

const blockedList = (issues) => issues
  .map((i) => ({ key: i.key, summary: i.fields.summary ?? '', blockerKeys: blockerKeysOf(i) }))
  .filter((b) => b.blockerKeys.length);

// Children in total and children created on or before the start day (AC 16). The engine counts
// UTC days, but JQL reads a date like "2026-10-20" in the user's time zone, so the bound (midnight
// UTC after the start day) is sent as "created more than N minutes ago", which has no time zone.
async function childCounts(port, epic, now) {
  const minutesAgo = Math.ceil((now - (epic.start + 1) * DAY_MS) / 60000);
  const total = count(port, `parent = ${quote(epic.key)}`);
  if (minutesAgo <= 0) return { childCount: await total, childCountAtStart: await total }; // started today
  const [childCount, childCountAtStart] = await Promise.all([total, count(port, `parent = ${quote(epic.key)} AND created < "-${minutesAgo}m"`)]);
  return { childCount, childCountAtStart };
}

// Reads the Snapshot for one epic, or returns { error } with a message for the user. `now` is the
// run's start time in milliseconds; `today` is its UTC day number. `onStep` is told the name of each
// phase as it starts, for the run status the panel shows (story 003 AC 7).
export async function fetchSnapshot(port, requestedKey, { today, now, accountId, onStep = async () => {} }) {
  if (!ISSUE_KEY.test(requestedKey)) return { error: 'No valid epic key was given.' };

  // Phase 1: site, statuses, link types and the epic itself (AC 1).
  const [server, statuses, linkTypes] = await Promise.all([port.serverInfo(), port.statuses(), port.linkTypes()]);
  let issue;
  try {
    issue = await port.issue(requestedKey, EPIC_FIELDS);
  } catch (error) {
    if (error.status === 404) return { error: `${requestedKey} doesn't exist, or you don't have permission to see it.` };
    throw error;
  }
  // Jira follows a moved epic's old key; from here on only its current key is used.
  const epicKey = issue.key;
  if (!ISSUE_KEY.test(epicKey ?? '')) return { error: 'No valid epic key was given.' };
  if (issue.fields.issuetype?.hierarchyLevel !== 1) return { error: `${epicKey} is not an epic. Forewarned runs pre-mortems on epics only.` };
  const space = issue.fields.project?.key;
  if (!SPACE_KEY.test(space ?? '')) return { error: `${epicKey} is in a space Forewarned can't read.` };
  const linkTypeFound = (linkTypes.issueLinkTypes ?? []).some((t) => t.inward === BLOCKED_BY);

  await onStep('comparable epics');
  // Phase 2: finished epics of the same space and the status history they need.
  const epicTypeIds = (await port.projectIssueTypes(issue.fields.project.id))
    .filter((t) => t.hierarchyLevel === 1).map((t) => String(t.id)).filter((id) => TYPE_ID.test(id));
  const candidateIssues = epicTypeIds.length
    ? (await port.search({
      jql: `project = ${quote(space)} AND issuetype in (${epicTypeIds.join(', ')}) AND statusCategory = Done AND key != ${quote(epicKey)} AND (resolved >= -365d OR resolution is EMPTY) ORDER BY resolved DESC`,
      fields: EPIC_FIELDS,
      maxResults: MAX_CANDIDATES,
    })).issues
    : [];
  const moves = await statusMoves(port, [issue, ...candidateIssues].map((i) => i.id), statuses);
  const epic = toEpic(issue, moves, today);
  const candidates = candidateIssues.map((i) => toEpic(i, moves, today));

  await onStep('past epics');
  // Phase 3: details of the comparable epics only. comparison.epics holds the same objects as
  // candidates, so the details attached here become part of the Snapshot's candidates.
  const comparison = selectComparable(epic, candidates, today);
  await mapLimit(comparison.epics, async (e) => { e.details = { ...(await childCounts(port, e, now)), blocked: [] }; });
  const comparableKeys = comparison.epics.map((e) => e.key).filter((k) => ISSUE_KEY.test(k));
  if (linkTypeFound && comparableKeys.length) {
    const blockedChildren = await searchPages(port, {
      jql: `parent in (${comparableKeys.map(quote).join(', ')}) AND issueLinkType = ${quote(BLOCKED_BY)} ORDER BY key ASC`,
      fields: ['summary', 'parent', 'issuelinks'],
      maxResults: PAGE,
    }, 1);
    for (const e of comparison.epics) e.details.blocked = blockedList(blockedChildren.filter((c) => c.fields.parent?.key === e.key));
  }

  await onStep('scope');
  // Phase 4: the current epic's children, open work and blockers (AC 16, 18, 20, 23).
  const open = `parent = ${quote(epicKey)} AND statusCategory != Done`;
  const [counts, openTotal, unassignedTotal, openIssues, blockedIssues] = await Promise.all([
    childCounts(port, epic, now),
    count(port, open),
    count(port, `${open} AND assignee is EMPTY`),
    searchPages(port, { jql: `${open} ORDER BY key ASC`, fields: ['summary', 'assignee'], maxResults: PAGE }, MAX_CHILD_PAGES),
    linkTypeFound
      ? searchPages(port, { jql: `(key = ${quote(epicKey)} OR (${open})) AND issueLinkType = ${quote(BLOCKED_BY)} ORDER BY key ASC`, fields: ['summary', 'issuelinks'], maxResults: PAGE }, 1)
      : [],
  ]);
  const read = openIssues.map((i) => ({ key: i.key, summary: i.fields.summary ?? '', assignee: person(i.fields.assignee) }));
  const blocked = blockedList(blockedIssues);

  await onStep('load');
  // Phase 5: everyone's total open work, and the other epics of the busiest 10 (AC 19). A person
  // Jira can't count (for example an erased account) is skipped, not the whole run.
  const ranked = rankPeople({ assignee: epic.assignee, openChildren: { read } })
    .filter((r) => ACCOUNT_ID.test(r.person.accountId))
    .slice(0, MAX_PEOPLE_COUNTED);
  const counted = await mapLimit(ranked, async ({ person: who }, i) => {
    const theirs = `assignee = ${quote(who.accountId)} AND statusCategory != Done`;
    let total;
    try {
      total = await count(port, theirs);
    } catch (error) {
      if (error instanceof JiraError && error.status === 400) return null;
      throw error;
    }
    if (i >= MAX_PEOPLE_READ) return { person: who, openTotal: total, otherEpics: null };
    const items = await searchPages(port, { jql: `${theirs} AND parent is not EMPTY ORDER BY key ASC`, fields: ['parent'], maxResults: PAGE }, MAX_PERSON_PAGES);
    const others = new Map();
    for (const item of items) {
      const p = item.fields.parent;
      if (p && p.key !== epicKey && p.fields?.issuetype?.hierarchyLevel === 1 && p.fields?.status?.statusCategory?.key === 'indeterminate') {
        others.set(p.key, { key: p.key, summary: p.fields.summary ?? '' });
      }
    }
    return { person: who, openTotal: total, otherEpics: [...others.values()].sort((a, b) => compareKeys(a.key, b.key)) };
  });
  // The parent field can name an epic in a space the user can't browse; only visible ones stay (AC 2).
  const otherKeys = [...new Set(counted.flatMap((p) => p?.otherEpics ?? []).map((e) => e.key))].sort(compareKeys);
  const visibleEpics = new Set((await readVisible(port, otherKeys, ['summary'])).map((i) => i.key));
  const people = counted.filter(Boolean)
    .map((p) => (p.otherEpics ? { ...p, otherEpics: p.otherEpics.filter((e) => visibleEpics.has(e.key)) } : p));

  await onStep('dependencies');
  // Phase 6: details of every blocker, read again as the user. A blocker that doesn't come back is
  // one the user can't see: it is left out, and the pack says so.
  const blockerKeys = [...new Set([...blocked, ...comparison.epics.flatMap((e) => e.details.blocked)].flatMap((b) => b.blockerKeys))].sort(compareKeys);
  const blockers = {};
  for (const b of await readVisible(port, blockerKeys, BLOCKER_FIELDS)) {
    const f = b.fields;
    blockers[b.key] = {
      key: b.key,
      summary: f.summary ?? '',
      space: f.project?.key ?? b.key.split('-')[0],
      statusCategory: f.status?.statusCategory?.key ?? 'new',
      statusName: f.status?.name ?? 'Unknown status',
      assignee: person(f.assignee),
      due: dayOf(f.duedate),
      resolved: dayOf(f.resolutiondate),
    };
  }
  const hidden = blockerKeys.some((k) => !blockers[k]);

  return {
    snapshot: {
      siteUrl: (server.baseUrl ?? '').replace(/\/+$/, ''),
      today,
      builtFor: accountId,
      linkTypeFound,
      epic: { ...epic, ...counts, openChildren: { total: openTotal, unassignedTotal, read }, people, blocked },
      candidates,
      blockers,
      notes: hidden ? [HIDDEN_NOTE] : [],
    },
  };
}
