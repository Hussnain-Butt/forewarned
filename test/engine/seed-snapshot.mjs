// Builds the Snapshot that fetch would return for the seeded demo site (story 002 AC 35), straight
// from forewarned-demo.json. Compute tests use it so they never depend on the fetch layer.

import { join } from 'node:path';
import { DEMO_FILE, KEY_FILE, SEED_DIR, loadSeed, readJson } from '../../scripts/seed/test/helpers.mjs';
import { compareKeys, dayOf } from '../../src/engine/format.js';
import { rankPeople } from '../../src/engine/load.js';

export const SEED_TODAY = '2026-11-02';
export const SEED_SITE = 'https://seed.example.atlassian.net';
export const answerKey = readJson(join(SEED_DIR, KEY_FILE));
const demo = readJson(join(SEED_DIR, DEMO_FILE));
const personas = readJson(join(SEED_DIR, 'personas.json'));

// Keys per space, counting from 1 in file order.
const keys = new Map();
for (const project of demo.projects) project.issues.forEach((issue, i) => keys.set(issue.externalId, `${project.key}-${i + 1}`));
export const keyOf = (externalId) => keys.get(externalId);

const CATEGORY = { 'To Do': 'new', 'In Progress': 'indeterminate', Done: 'done' };
const PERSON = Object.fromEntries(personas.roles.map((r) => [r.prefix, { accountId: `acc-${r.role}`, displayName: r.displayName }]));
export const personOf = (record) => PERSON[record.role] ?? null;

export function seedSnapshot({ epic = 'll-chk-e11', today = SEED_TODAY, edit } = {}) {
  const records = loadSeed(demo);
  edit?.(records);
  const day0 = dayOf(today);
  const all = [...records.values()];
  const at = (rel) => (rel === null ? null : day0 + rel);
  const isOpen = (r) => r.status !== 'Done';
  const byKey = (a, b) => compareKeys(keyOf(a.id), keyOf(b.id));
  const childrenOf = (id) => all.filter((r) => r.parent === id).sort(byKey);
  const startOf = (r) => r.start ?? r.created;

  const toEpic = (r) => ({
    key: keyOf(r.id),
    summary: r.summary,
    space: r.space,
    statusCategory: CATEGORY[r.status],
    created: at(r.created),
    start: at(startOf(r)),
    due: at(r.due),
    finish: r.status === 'Done' ? at(r.finish) : null,
    components: r.components,
    labels: r.labels,
    assignee: personOf(r),
  });
  const counts = (r) => {
    const kids = childrenOf(r.id);
    return { childCount: kids.length, childCountAtStart: kids.filter((k) => k.created <= startOf(r)).length };
  };
  const blockedOf = (rs) => rs.filter((r) => r.blockedBy.length)
    .map((r) => ({ key: keyOf(r.id), summary: r.summary, blockerKeys: r.blockedBy.map(keyOf).sort(compareKeys) }));

  const current = records.get(epic);
  const openKids = childrenOf(current.id).filter(isOpen);
  const read = openKids.map((k) => ({ key: keyOf(k.id), summary: k.summary, assignee: personOf(k) }));
  const people = rankPeople({ assignee: personOf(current), openChildren: { read } }).slice(0, 25).map(({ person }, i) => {
    const mine = all.filter((r) => isOpen(r) && personOf(r)?.accountId === person.accountId);
    const otherEpics = [...new Set(mine.map((r) => r.parent).filter(Boolean))]
      .map((id) => records.get(id))
      .filter((p) => p.type === 'Epic' && p.status === 'In Progress' && p.id !== current.id)
      .sort(byKey)
      .map((p) => ({ key: keyOf(p.id), summary: p.summary }));
    return { person, openTotal: mine.length, otherEpics: i < 10 ? otherEpics : null };
  });

  const candidates = all
    .filter((r) => r.type === 'Epic' && r.space === current.space && r.status === 'Done' && r.id !== current.id && r.finish >= -365)
    .sort((a, b) => b.finish - a.finish || byKey(a, b))
    .slice(0, 50)
    .map((r) => ({ ...toEpic(r), details: { ...counts(r), blocked: blockedOf(childrenOf(r.id)) } }));

  const epicBlocked = blockedOf([current, ...openKids]);
  const blockers = {};
  for (const b of [...epicBlocked, ...candidates.flatMap((c) => c.details.blocked)]) {
    for (const key of b.blockerKeys) {
      const r = all.find((x) => keyOf(x.id) === key);
      blockers[key] = {
        key,
        summary: r.summary,
        space: r.space,
        statusCategory: CATEGORY[r.status],
        statusName: r.status,
        assignee: personOf(r),
        due: at(r.due),
        resolved: r.status === 'Done' ? at(r.finish) : null,
      };
    }
  }

  return {
    siteUrl: SEED_SITE,
    today: day0,
    builtFor: 'acc-requester',
    linkTypeFound: true,
    epic: {
      ...toEpic(current),
      ...counts(current),
      openChildren: {
        total: openKids.length,
        unassignedTotal: openKids.filter((k) => !personOf(k)).length,
        read,
      },
      people,
      blocked: epicBlocked,
    },
    candidates,
    blockers,
    notes: [],
  };
}
