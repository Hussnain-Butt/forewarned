// Dependency signal (story 002 AC 23–25; answer key P1 and decoy D1).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectComparable } from '../../src/engine/comparable.js';
import { dependencySignal } from '../../src/engine/dependencies.js';
import { assertEvidence, expectedEvidence } from './expect.mjs';
import { keyOf, seedSnapshot } from './seed-snapshot.mjs';

const run = (snapshot) => dependencySignal(snapshot, selectComparable(snapshot.epic, snapshot.candidates, snapshot.today));

test('the seed shows the repeating platform dependency (P1)', () => {
  const { check, drafts } = run(seedSnapshot());
  assert.equal(check.status, 'found');
  assertEvidence(drafts, expectedEvidence('P1', 'open-blocker')[0]);
  assert.equal(assertEvidence(drafts, expectedEvidence('P1', 'blocker-history')[0]).baseRate, true);
  assertEvidence(drafts, expectedEvidence('P1', 'blocker-example')[0]);
  const types = drafts.map((d) => d.type);
  assert.deepEqual(types, [...types].sort((a, b) => ['open-blocker', 'blocker-history', 'blocker-example'].indexOf(a) - ['open-blocker', 'blocker-history', 'blocker-example'].indexOf(b)));
  assert.ok(drafts.every((d) => d.signal === 'dependencies'));
});

test('facts use the fixed wording', () => {
  const { drafts } = run(seedSnapshot());
  assert.equal(drafts.find((d) => d.type === 'open-blocker').fact,
    `${keyOf('un-plt-e03-07')} Refund status endpoint in gateway v3 (PLT, To Do, unassigned, due 28 Oct 2026, 5 days overdue) blocks ${keyOf('bk-chk-e11-03')} Refund to the original payment method from the order page in this epic.`);
  assert.equal(drafts.find((d) => d.type === 'blocker-history').fact,
    '4 of 5 comparable epics that had work blocked by PLT work items finished late (80%; 1 on time).');
  const example = drafts.find((d) => d.type === 'blocker-example').fact;
  assert.ok(example.startsWith(`${keyOf('ll-chk-e07')} Wallet top-up finished 42 days late; its work item `), example);
  assert.ok(example.endsWith(', which was resolved 28 days after its own due date.'), example);
});

test('decoy D1: a resolved blocker is never an open blocker', () => {
  const open = run(seedSnapshot()).drafts.filter((d) => d.type === 'open-blocker');
  assert.ok(!open.some((d) => d.links.some((l) => l.key === keyOf('pf-plt-e03-02'))));
});

test('open blockers rank other spaces first, then unassigned, and the epic itself reads "this epic"', () => {
  const snapshot = seedSnapshot();
  const epic = { ...snapshot.epic, blocked: [{ key: snapshot.epic.key, summary: snapshot.epic.summary, blockerKeys: ['CHK-500', 'PLT-500'] }] };
  const blockers = {
    'CHK-500': { key: 'CHK-500', summary: 'Same space', space: 'CHK', statusCategory: 'indeterminate', statusName: 'In Progress', assignee: { accountId: 'a', displayName: 'Sam' }, due: null, resolved: null },
    'PLT-500': { key: 'PLT-500', summary: 'Other space', space: 'PLT', statusCategory: 'new', statusName: 'To Do', assignee: null, due: snapshot.today + 3, resolved: null },
  };
  const open = run({ ...snapshot, epic, blockers }).drafts.filter((d) => d.type === 'open-blocker');
  assert.deepEqual(open.map((d) => d.links[0].key), ['PLT-500', 'CHK-500']);
  assert.equal(open[0].fact, 'PLT-500 Other space (PLT, To Do, unassigned, due 5 Nov 2026) blocks this epic.');
  assert.equal(open[1].fact, 'CHK-500 Same space (CHK, In Progress, Sam, no due date) blocks this epic.');
  assert.deepEqual(open.map((d) => d.numbers.daysOverdue), [0, null]);
});

test('no "is blocked by" link type, or no links at all: clear with a note', () => {
  const noType = run({ ...seedSnapshot(), linkTypeFound: false });
  assert.deepEqual(noType, { check: { status: 'clear', note: "No 'is blocked by' link type found on this site." }, drafts: [] });
  const snapshot = seedSnapshot();
  const none = run({
    ...snapshot,
    epic: { ...snapshot.epic, blocked: [] },
    candidates: snapshot.candidates.map((c) => ({ ...c, details: { ...c.details, blocked: [] } })),
    notes: ["Some links point to spaces you can't see."],
  });
  assert.deepEqual(none, { check: { status: 'clear', note: "No open blockers. Some links point to spaces you can't see." }, drafts: [] });
});

test('history without open blockers still says there are no open blockers', () => {
  const snapshot = seedSnapshot();
  const { check, drafts } = run({ ...snapshot, epic: { ...snapshot.epic, blocked: [] } });
  assert.equal(check.status, 'found');
  assert.ok(!drafts.some((d) => d.type === 'open-blocker'));
  assert.equal(check.note, 'No open blockers.');
});
