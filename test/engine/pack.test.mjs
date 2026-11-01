// The evidence pack (story 002 AC 26–31, 36–37).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_BYTES, MAX_ITEMS, computePack } from '../../src/engine/pack.js';
import { assertEvidence } from './expect.mjs';
import { SEED_SITE, answerKey, keyOf, seedSnapshot } from './seed-snapshot.mjs';

const bytes = (pack) => Buffer.byteLength(JSON.stringify({ ...pack, builtAt: '2026-11-02T00:00:00.000Z' }), 'utf8');

test('AC 36: the pack has the evidence for all 5 planted risks', () => {
  const pack = computePack(seedSnapshot());
  for (const risk of answerKey.plantedRisks) {
    for (const expected of risk.expectedEvidence) assertEvidence(pack.evidence, expected, risk.id);
  }
});

test('AC 36: neither decoy is flagged', () => {
  const pack = computePack(seedSnapshot());
  const open = pack.evidence.filter((e) => e.type === 'open-blocker');
  assert.ok(!open.some((e) => e.links.some((l) => l.key === keyOf('pf-plt-e03-02'))), 'D1');
  const mobile = pack.evidence.filter((e) => e.type === 'load-person' && e.numbers.openTotal === 47);
  assert.deepEqual(mobile, [], 'D2');
});

test('items are numbered E1…En in the order slip, scope, load, dependencies, with links and URLs', () => {
  const pack = computePack(seedSnapshot());
  const order = ['slip', 'scope', 'load', 'dependencies'];
  pack.evidence.forEach((e, i) => {
    assert.equal(e.id, `E${i + 1}`);
    assert.equal(e.source, 'history');
    assert.ok(e.links.length >= 1 && e.links.length <= 10, `${e.id} has ${e.links.length} links`);
    for (const l of e.links) assert.equal(l.url, `${SEED_SITE}/browse/${l.key}`);
    if (i) assert.ok(order.indexOf(pack.evidence[i - 1].signal) <= order.indexOf(e.signal), `${e.id} is out of order`);
  });
});

test('the pack names the epic, the comparison set and four checks', () => {
  const pack = computePack(seedSnapshot());
  assert.deepEqual(pack.epic, { key: keyOf('ll-chk-e11'), summary: 'Checkout v2 launch', url: `${SEED_SITE}/browse/${keyOf('ll-chk-e11')}`, due: '2026-12-14', start: '2026-10-19', statusCategory: 'indeterminate' });
  assert.equal(pack.builtFor, 'acc-requester');
  assert.equal(pack.comparison.rule, 'matched on components Payments, Web');
  assert.equal(pack.comparison.epics.length, 8);
  const wallet = pack.comparison.epics.find((e) => e.key === keyOf('ll-chk-e07'));
  assert.deepEqual(wallet, { key: keyOf('ll-chk-e07'), summary: 'Wallet top-up', url: `${SEED_SITE}/browse/${keyOf('ll-chk-e07')}`, due: '2026-06-15', finish: '2026-07-27', daysLate: 42, durationDays: 102 });
  assert.equal(pack.comparison.epics.find((e) => e.due === null).daysLate, null);
  assert.deepEqual(Object.keys(pack.checks), ['slip', 'scope', 'load', 'dependencies']);
  assert.ok(bytes(pack) <= MAX_BYTES);
});

test('AC 31: the same Snapshot gives the same pack and packId; any change gives a new packId', () => {
  const a = computePack(seedSnapshot());
  assert.deepEqual(computePack(seedSnapshot()), a);
  assert.match(a.packId, /^[0-9a-f]{16}$/);
  const changed = computePack(seedSnapshot({ edit: (records) => { records.get('ll-chk-e07').summary = 'Wallet top-up v1'; } }));
  assert.notEqual(changed.packId, a.packId);
});

test('a brand-new epic with nothing around it gives four checks and no crash', () => {
  const today = 20000;
  const pack = computePack({
    siteUrl: SEED_SITE,
    today,
    builtFor: 'acc-requester',
    linkTypeFound: false,
    epic: {
      key: 'NEW-1', summary: 'Lonely epic', space: 'NEW', statusCategory: 'new', created: today, start: today, due: null, finish: null,
      components: [], labels: [], assignee: null, childCount: 0, childCountAtStart: 0,
      openChildren: { total: 0, unassignedTotal: 0, read: [] }, people: [], blocked: [],
    },
    candidates: [],
    blockers: {},
    notes: [],
  });
  assert.deepEqual(pack.evidence, []);
  assert.deepEqual(Object.values(pack.checks).map((c) => c.status), ['insufficient', 'insufficient', 'insufficient', 'clear']);
  assert.equal(pack.comparison.rule, 'all finished epics in NEW from the last 12 months');
});

test('AC 30: an oversized pack drops its weakest items until it fits, and says so', () => {
  const emoji = '😀'.repeat(100);
  const s = seedSnapshot({ edit: (records) => { for (const r of records.values()) r.summary = emoji; } });
  const people = Array.from({ length: 12 }, (_, i) => ({
    person: { accountId: `acc-x${i}`, displayName: `Person ${i}` },
    openTotal: 20 + i,
    otherEpics: Array.from({ length: 9 }, (_, j) => ({ key: `PLT-${100 + i * 10 + j}`, summary: emoji })),
  }));
  const read = people.map((p, i) => ({ key: `CHK-${700 + i}`, summary: emoji, assignee: p.person }));
  const blockers = { ...s.blockers };
  const extra = Array.from({ length: 5 }, (_, i) => `PLT-${600 + i}`);
  for (const key of extra) blockers[key] = { key, summary: emoji, space: 'PLT', statusCategory: 'new', statusName: 'To Do', assignee: null, due: null, resolved: null };
  const epic = {
    ...s.epic,
    people,
    openChildren: { ...s.epic.openChildren, read: [...s.epic.openChildren.read, ...read] },
    blocked: [...s.epic.blocked, { key: s.epic.key, summary: emoji, blockerKeys: extra }],
  };
  const pack = computePack({ ...s, epic, blockers });
  assert.ok(pack.evidence.length <= MAX_ITEMS);
  assert.ok(bytes(pack) <= MAX_BYTES, `${bytes(pack)} bytes`);
  pack.evidence.forEach((e, i) => assert.equal(e.id, `E${i + 1}`));
  assert.ok(pack.evidence.some((e) => e.signal === 'slip') && pack.evidence.some((e) => e.signal === 'dependencies'));
  assert.match(pack.notes.at(-1), /^Dropped \d+ weaker evidence items to keep the pack within 25 items and 24,000 bytes\.$/);
});

test('the packId does not depend on who built the pack (AC 31)', () => {
  const a = computePack(seedSnapshot());
  const b = computePack({ ...seedSnapshot(), builtFor: 'acc-someone-else' });
  assert.equal(b.packId, a.packId);
  assert.equal(b.builtFor, 'acc-someone-else');
});
