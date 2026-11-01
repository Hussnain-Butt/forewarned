// The fetch layer of the evidence engine (story 002): reads one epic and its space's history from
// Jira through the port (jira.js) and returns a plain-data Snapshot for compute (pack.js).
//
// Every list read has a cap and totals come from approximate counts (AC 32), and every value that
// goes into JQL is checked against a strict pattern first, so input from the Rovo chat can never
// change a query. All calls run as the requesting user (forge-jira.js), so Jira only returns work
// items from spaces that user can browse (AC 2).

import { selectComparable } from './comparable.js';
import { compareKeys, dayOf, isoDay } from './format.js';
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

// Status changes per issue ID, oldest first, as { day, category }.
async function statusMoves(port, issueIds, categoryOf) {
  const moves = new Map();
  let nextPageToken;
  for (let pageNo = 0; pageNo < MAX_CHANGELOG_PAGES; pageNo += 1) {
    const page = await port.changelogs({ issueIdsOrKeys: issueIds, fieldIds: ['status'], maxResults: 1000, ...(nextPageToken ? { nextPageToken } : {}) });
    for (const log of page.issueChangeLogs ?? []) {
      const list = moves.get(log.issueId) ?? [];
      for (const history of log.changeHistories ?? []) {
        for (const item of history.items ?? []) {
          if ((item.fieldId ?? item.field) === 'status') list.push({ day: dayOf(history.created), category: categoryOf.get(String(item.to)) });
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
// created day (AC 9). Finish: the resolution date, else the last move into Done (AC 8).
function toEpic(issue, moves) {
  const f = issue.fields;
  const own = moves.get(issue.id) ?? [];
  const created = dayOf(f.created);
  const statusCategory = f.status?.statusCategory?.key ?? 'new';
  const started = own.find((m) => m.category === 'indeterminate');
  const doneMoves = own.filter((m) => m.category === 'done');
  let finish = null;
  if (statusCategory === 'done') {
    if (f.resolutiondate) finish = dayOf(f.resolutiondate);
    else if (doneMoves.length) finish = doneMoves.at(-1).day;
  }
  return {
    key: issue.key,
    summary: f.summary ?? '',
    space: f.project?.key ?? issue.key.split('-')[0],
    statusCategory,
    created,
    start: started ? started.day : created,
    due: f.duedate ? dayOf(f.duedate) : null,
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

// Children in total and children created on or before the start day (AC 16).
async function childCounts(port, epic) {
  const [childCount, childCountAtStart] = await Promise.all([
    count(port, `parent = ${quote(epic.key)}`),
    count(port, `parent = ${quote(epic.key)} AND created < ${quote(isoDay(epic.start + 1))}`),
  ]);
  return { childCount, childCountAtStart };
}

// Reads the Snapshot for one epic, or returns { error } with a message for the user.
export async function fetchSnapshot(port, epicKey, { today, accountId }) {
  if (!ISSUE_KEY.test(epicKey)) return { error: 'No valid epic key was given.' };

  // Phase 1: site, statuses, link types and the epic itself (AC 1).
  const [server, statuses, linkTypes] = await Promise.all([port.serverInfo(), port.statuses(), port.linkTypes()]);
  let issue;
  try {
    issue = await port.issue(epicKey, EPIC_FIELDS);
  } catch (error) {
    if (error.status === 404) return { error: `${epicKey} doesn't exist, or you don't have permission to see it.` };
    throw error;
  }
  if (issue.fields.issuetype?.hierarchyLevel !== 1) return { error: `${epicKey} is not an epic. Forewarned runs pre-mortems on epics only.` };
  const space = issue.fields.project?.key;
  if (!SPACE_KEY.test(space ?? '')) return { error: `${epicKey} is in a space Forewarned can't read.` };
  const categoryOf = new Map(statuses.map((s) => [String(s.id), s.statusCategory?.key]));
  const linkTypeFound = (linkTypes.issueLinkTypes ?? []).some((t) => t.inward === BLOCKED_BY);

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
  const moves = await statusMoves(port, [issue, ...candidateIssues].map((i) => i.id), categoryOf);
  const epic = toEpic(issue, moves);
  const candidates = candidateIssues.map((i) => toEpic(i, moves));

  // Phase 3: details of the comparable epics only.
  const comparison = selectComparable(epic, candidates, today);
  await mapLimit(comparison.epics, async (e) => { e.details = { ...(await childCounts(port, e)), blocked: [] }; });
  const comparableKeys = comparison.epics.map((e) => e.key).filter((k) => ISSUE_KEY.test(k));
  if (linkTypeFound && comparableKeys.length) {
    const blockedChildren = await searchPages(port, {
      jql: `parent in (${comparableKeys.map(quote).join(', ')}) AND issueLinkType = ${quote(BLOCKED_BY)}`,
      fields: ['summary', 'parent', 'issuelinks'],
      maxResults: PAGE,
    }, 1);
    for (const e of comparison.epics) e.details.blocked = blockedList(blockedChildren.filter((c) => c.fields.parent?.key === e.key));
  }

  // Phase 4: the current epic's children, open work and blockers (AC 16, 18, 20, 23).
  const open = `parent = ${quote(epicKey)} AND statusCategory != Done`;
  const [counts, openTotal, unassignedTotal, openIssues, blockedIssues] = await Promise.all([
    childCounts(port, epic),
    count(port, open),
    count(port, `${open} AND assignee is EMPTY`),
    searchPages(port, { jql: `${open} ORDER BY key ASC`, fields: ['summary', 'assignee'], maxResults: PAGE }, MAX_CHILD_PAGES),
    linkTypeFound
      ? searchPages(port, { jql: `(key = ${quote(epicKey)} OR (${open})) AND issueLinkType = ${quote(BLOCKED_BY)} ORDER BY key ASC`, fields: ['summary', 'issuelinks'], maxResults: PAGE }, 1)
      : [],
  ]);
  const read = openIssues.map((i) => ({ key: i.key, summary: i.fields.summary ?? '', assignee: person(i.fields.assignee) }));
  const blocked = blockedList(blockedIssues);

  // Phase 5: everyone's total open work, and the other epics of the busiest 10 (AC 19).
  const ranked = rankPeople({ assignee: epic.assignee, openChildren: { read } })
    .filter((r) => ACCOUNT_ID.test(r.person.accountId))
    .slice(0, MAX_PEOPLE_COUNTED);
  const people = await mapLimit(ranked, async ({ person: who }, i) => {
    const theirs = `assignee = ${quote(who.accountId)} AND statusCategory != Done`;
    const total = await count(port, theirs);
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

  // Phase 6: details of every blocker. A blocker that doesn't come back is one the user can't see.
  const blockerKeys = [...new Set([...blocked, ...comparison.epics.flatMap((e) => e.details.blocked)].flatMap((b) => b.blockerKeys))].sort(compareKeys);
  const chunks = [];
  for (let i = 0; i < blockerKeys.length; i += PAGE) chunks.push(blockerKeys.slice(i, i + PAGE));
  const blockers = {};
  let hidden = false;
  await mapLimit(chunks, async (chunk) => {
    let issues;
    try {
      issues = await searchPages(port, { jql: `key in (${chunk.map(quote).join(', ')})`, fields: BLOCKER_FIELDS, maxResults: PAGE }, 1);
    } catch (error) {
      if (error.status !== 400) throw error;
      hidden = true;
      return;
    }
    if (issues.length < chunk.length) hidden = true;
    for (const b of issues) {
      const f = b.fields;
      blockers[b.key] = {
        key: b.key,
        summary: f.summary ?? '',
        space: f.project?.key ?? b.key.split('-')[0],
        statusCategory: f.status?.statusCategory?.key ?? 'new',
        statusName: f.status?.name ?? 'Unknown status',
        assignee: person(f.assignee),
        due: f.duedate ? dayOf(f.duedate) : null,
        resolved: f.resolutiondate ? dayOf(f.resolutiondate) : null,
      };
    }
  });

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
