// Scope signal (story 002 AC 16–17; answer key P4).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectComparable } from '../../src/engine/comparable.js';
import { scopeSignal } from '../../src/engine/scope.js';
import { assertEvidence, expectedEvidence } from './expect.mjs';
import { keyOf, seedSnapshot } from './seed-snapshot.mjs';

const KEY = keyOf('ll-chk-e11');
const run = (snapshot, pick = (c) => c) => scopeSignal(snapshot, pick(selectComparable(snapshot.epic, snapshot.candidates, snapshot.today)));
const withEpic = (changes) => {
  const snapshot = seedSnapshot();
  return { ...snapshot, epic: { ...snapshot.epic, ...changes } };
};

test('the seed shows that scope keeps growing (P4)', () => {
  const { check, drafts } = run(seedSnapshot());
  assert.equal(check.status, 'found');
  assert.deepEqual(drafts.map((d) => d.type), ['scope-current', 'scope-base-rate']);
  assert.equal(assertEvidence(drafts, expectedEvidence('P4', 'scope-current')[0]).baseRate, false);
  assert.equal(assertEvidence(drafts, expectedEvidence('P4', 'scope-base-rate')[0]).baseRate, true);
  assert.equal(drafts[0].fact, `${KEY} started on 19 Oct 2026 with 15 work items and has gained 6 since, 40% more; it now has 21.`);
  assert.equal(drafts[1].fact, 'Comparable epics gained a median of 40% more work items after they started (8 epics, from 20% to 60%).');
  assert.ok(drafts.every((d) => d.signal === 'scope'));
});

test('an epic with no children gets a note instead of a scope fact', () => {
  const { check, drafts } = run(withEpic({ childCount: 0, childCountAtStart: 0 }));
  assert.ok(!drafts.some((d) => d.type === 'scope-current'));
  assert.match(check.note, new RegExp(`${KEY} has no child work items yet\\.`));
});

test('an epic that started empty, or that shrank, gets the matching wording', () => {
  assert.equal(run(withEpic({ childCount: 5, childCountAtStart: 0 })).drafts[0].fact,
    `${KEY} started on 19 Oct 2026 with 0 work items and has gained 5 since; it now has 5.`);
  assert.equal(run(withEpic({ childCount: 10, childCountAtStart: 12 })).drafts[0].fact,
    `${KEY} started on 19 Oct 2026 with 12 work items and now has 10, 2 fewer.`);
});

test('comparable epics with no work items at their start are left out of the median', () => {
  const emptyFirst = (c) => ({ ...c, epics: c.epics.map((e, i) => (i ? e : { ...e, details: { ...e.details, childCountAtStart: 0 } })) });
  const base = run(seedSnapshot(), emptyFirst).drafts.find((d) => d.type === 'scope-base-rate');
  assert.equal(base.numbers.leftOut, 1);
  assert.equal(base.numbers.epics, 7);
  assert.match(base.fact, /\(7 epics, from \d+% to \d+%; 1 left out because they had no work items at their start\)\.$/);
});

test('fewer than 3 comparable epics: no scope base rate', () => {
  const { check, drafts } = run(seedSnapshot(), (c) => ({ ...c, epics: c.epics.slice(0, 2) }));
  assert.deepEqual(drafts.map((d) => d.type), ['scope-current']);
  assert.match(check.note, /Fewer than 3 comparable epics had work items at their start, so there is no scope base rate\./);
});
