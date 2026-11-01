// A fake Jira for fetch tests, answered from the same seed records as seedSnapshot(). It knows only
// the request shapes fetch.js sends; any other JQL gets HTTP 400, so a changed query fails loudly.
// Records may carry test-only fields: `person` (overrides the role's user), `noResolution` (a Done
// work item without a resolution date), `extraMoves` ([{ day, status }] added to its history) and
// `rawCreated` (the created value as sent). Options: `statusIds: false` sends history items without
// status IDs (as an import might), `hidden` keys are left out of bulk fetches (spaces the user can't
// see), `failCountFor` makes that account's count fail with 400, and `aliases` maps old keys.

import { join } from 'node:path';
import { DEMO_FILE, SEED_DIR, loadSeed, readJson } from '../../scripts/seed/test/helpers.mjs';
import { compareKeys, dayOf, isoDay } from '../../src/engine/format.js';
import { SEED_SITE, SEED_TODAY, keyOf, personOf } from './seed-snapshot.mjs';

const demo = readJson(join(SEED_DIR, DEMO_FILE));
const STATUS = {
  'To Do': { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
  'In Progress': { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
  Done: { id: '10001', name: 'Done', statusCategory: { key: 'done' } },
};
const TYPES = [
  { id: '10000', name: 'Epic', hierarchyLevel: 1 },
  { id: '10001', name: 'Story', hierarchyLevel: 0 },
  { id: '10002', name: 'Task', hierarchyLevel: 0 },
  { id: '10003', name: 'Bug', hierarchyLevel: 0 },
];
const BLOCKS = { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
const PROJECT_ID = { CHK: '10100', PLT: '10101' };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const keyList = (text) => text.split(',').map((k) => k.trim().replace(/^"|"$/g, ''));

export function seedPort({
  edit, linkTypes = [BLOCKS], today = SEED_TODAY, now = Date.parse(`${SEED_TODAY}T08:00:00.000Z`),
  statusIds = true, hidden = [], failCountFor = null, aliases = {},
} = {}) {
  const records = loadSeed(demo);
  edit?.(records);
  const day0 = dayOf(today);
  const all = [...records.values()];
  const log = [];

  // Keys and IDs: seed keys for seeded records, new numbers for records a test added.
  const keys = new Map();
  let next = 9000;
  for (const r of all) keys.set(r.id, keyOf(r.id) ?? `${r.space}-${(next += 1)}`);
  const byKey = new Map(all.map((r) => [keys.get(r.id), r]));
  const ids = new Map(all.map((r, i) => [r.id, String(20000 + i)]));
  const byIssueId = new Map(all.map((r) => [ids.get(r.id), r]));
  const sortByKey = (rs) => rs.sort((a, b) => compareKeys(keys.get(a.id), keys.get(b.id)));

  const stamp = (rel) => `${isoDay(day0 + rel)}T09:00:00.000+0000`;
  const person = (r) => (r.person !== undefined ? r.person : personOf(r));
  const isOpen = (r) => r.status !== 'Done';
  const childrenOf = (key) => all.filter((r) => r.parent && keys.get(r.parent) === key);

  const fieldsOf = (r) => ({
    summary: r.summary,
    status: STATUS[r.status],
    issuetype: TYPES.find((t) => t.name === r.type) ?? TYPES[1],
    project: { id: PROJECT_ID[r.space], key: r.space },
    duedate: r.due === null ? null : isoDay(day0 + r.due),
    created: r.rawCreated ?? stamp(r.created),
    resolutiondate: r.status === 'Done' && !r.noResolution ? stamp(r.finish) : null,
    components: r.components.map((name) => ({ name })),
    labels: r.labels,
    assignee: person(r),
    parent: r.parent ? (() => {
      const p = records.get(r.parent);
      return { key: keys.get(p.id), fields: { summary: p.summary, status: STATUS[p.status], issuetype: TYPES.find((t) => t.name === p.type) } };
    })() : undefined,
    issuelinks: [
      ...r.blockedBy.map((id) => ({ type: BLOCKS, inwardIssue: { key: keys.get(id) } })),
      ...r.blocks.map((id) => ({ type: BLOCKS, outwardIssue: { key: keys.get(id) } })),
    ],
  });
  const issueJson = (r, fields) => {
    const full = fieldsOf(r);
    return { id: ids.get(r.id), key: keys.get(r.id), fields: Object.fromEntries(fields.filter((f) => full[f] !== undefined).map((f) => [f, full[f]])) };
  };
  const page = (rs, body) => {
    const start = Number(body.nextPageToken ?? 0);
    const slice = rs.slice(start, start + body.maxResults);
    const isLast = start + body.maxResults >= rs.length;
    return json({ issues: slice.map((r) => issueJson(r, body.fields)), isLast, ...(isLast ? {} : { nextPageToken: String(start + body.maxResults) }) });
  };

  // Matches the JQL that fetch.js builds; returns the matching records or null.
  const select = (jql) => {
    let m = /^project = "(\w+)" AND issuetype in \(([\d, ]+)\) AND statusCategory = Done AND key != "([\w-]+)" AND \(resolved >= -365d OR resolution is EMPTY\) ORDER BY resolved DESC$/.exec(jql);
    if (m) {
      return all.filter((r) => r.space === m[1] && r.type === 'Epic' && r.status === 'Done' && keys.get(r.id) !== m[3] && (r.noResolution || r.finish >= -365))
        .sort((a, b) => b.finish - a.finish);
    }
    m = /^parent in \((.+)\) AND issueLinkType = "is blocked by" ORDER BY key ASC$/.exec(jql);
    if (m) return sortByKey(keyList(m[1]).flatMap(childrenOf).filter((r) => r.blockedBy.length));
    m = /^parent = "([\w-]+)" AND statusCategory != Done ORDER BY key ASC$/.exec(jql);
    if (m) return sortByKey(childrenOf(m[1]).filter(isOpen));
    m = /^\(key = "([\w-]+)" OR \(parent = "\1" AND statusCategory != Done\)\) AND issueLinkType = "is blocked by" ORDER BY key ASC$/.exec(jql);
    if (m) return sortByKey([byKey.get(m[1]), ...childrenOf(m[1]).filter(isOpen)].filter((r) => r.blockedBy.length));
    m = /^assignee = "([^"]+)" AND statusCategory != Done AND parent is not EMPTY ORDER BY key ASC$/.exec(jql);
    if (m) return sortByKey(all.filter((r) => isOpen(r) && r.parent && person(r)?.accountId === m[1]));
    return null;
  };
  const countOf = (jql) => {
    let m = /^parent = "([\w-]+)"$/.exec(jql);
    if (m) return childrenOf(m[1]).length;
    // Relative bound: created more than N minutes before now. Seed work items are created at 09:00 UTC.
    m = /^parent = "([\w-]+)" AND created < "-(\d+)m"$/.exec(jql);
    if (m) return childrenOf(m[1]).filter((r) => (day0 + r.created) * 86400000 + 9 * 3600000 < now - Number(m[2]) * 60000).length;
    m = /^parent = "([\w-]+)" AND statusCategory != Done$/.exec(jql);
    if (m) return childrenOf(m[1]).filter(isOpen).length;
    m = /^parent = "([\w-]+)" AND statusCategory != Done AND assignee is EMPTY$/.exec(jql);
    if (m) return childrenOf(m[1]).filter((r) => isOpen(r) && !person(r)).length;
    m = /^assignee = "([^"]+)" AND statusCategory != Done$/.exec(jql);
    if (m && m[1] === failCountFor) return 'fail';
    if (m) return all.filter((r) => isOpen(r) && person(r)?.accountId === m[1]).length;
    return null;
  };

  const senders = {
    serverInfo: async () => json({ baseUrl: SEED_SITE }),
    statuses: async () => json(Object.values(STATUS)),
    linkTypes: async () => json({ issueLinkTypes: linkTypes }),
    issue: async (key, fields) => {
      const r = byKey.get(key) ?? records.get(aliases[key]);
      return r ? json(issueJson(r, fields)) : json({ errorMessages: ['Issue does not exist'] }, 404);
    },
    // Like Jira, work items the user can't see (or that don't exist) are simply not returned.
    bulkIssues: async (body) => json({
      issues: body.issueIdsOrKeys.filter((k) => byKey.has(k) && !hidden.includes(k)).map((k) => issueJson(byKey.get(k), body.fields)),
      issueErrors: [],
    }),
    projectIssueTypes: async () => json(TYPES),
    search: async (body) => {
      log.push(body.jql);
      const rs = select(body.jql);
      return rs ? page(rs, body) : json({ errorMessages: [`Unknown JQL in the seed port: ${body.jql}`] }, 400);
    },
    count: async (jql) => {
      log.push(jql);
      const n = countOf(jql);
      if (n === 'fail') return json({ errorMessages: ['The value does not exist for the field assignee.'] }, 400);
      return n === null ? json({ errorMessages: [`Unknown JQL in the seed port: ${jql}`] }, 400) : json({ count: n });
    },
    changelogs: async (body) => json({
      issueChangeLogs: body.issueIdsOrKeys.map((id) => byIssueId.get(id)).filter(Boolean).map((r) => {
        const moves = [];
        if (r.start !== null) moves.push({ day: r.start, status: 'In Progress' });
        if (r.status === 'Done' && r.finish !== null) moves.push({ day: r.finish, status: 'Done' });
        moves.push(...(r.extraMoves ?? []));
        moves.sort((a, b) => a.day - b.day);
        return {
          issueId: ids.get(r.id),
          changeHistories: moves.map((mv) => ({
            created: stamp(mv.day),
            items: [{ field: 'status', fieldId: 'status', ...(statusIds ? { to: STATUS[mv.status].id } : {}), toString: mv.status }],
          })),
        };
      }),
    }),
  };
  return { senders, log, keys };
}
