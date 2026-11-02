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

test('comparable epics with fewer than 5 work items at their start are left out of the median', () => {
  const smallFirst = (c) => ({ ...c, epics: c.epics.map((e, i) => (i ? e : { ...e, details: { ...e.details, childCountAtStart: 2 } })) });
  const base = run(seedSnapshot(), smallFirst).drafts.find((d) => d.type === 'scope-base-rate');
  assert.equal(base.numbers.leftOut, 1);
  assert.equal(base.numbers.epics, 7);
  assert.match(base.fact, /\(7 epics, from \d+% to \d+%; 1 left out because it had fewer than 5 work items at its start\)\.$/);
});

test('fewer than 3 comparable epics: no scope base rate', () => {
  const { check, drafts } = run(seedSnapshot(), (c) => ({ ...c, epics: c.epics.slice(0, 2) }));
  assert.deepEqual(drafts.map((d) => d.type), ['scope-current']);
  assert.match(check.note, /Fewer than 3 comparable epics had 5 or more work items at their start, so there is no scope base rate\./);
});

test('counts of 1,000 or more get commas (AC 27)', () => {
  assert.equal(run(withEpic({ childCount: 5121, childCountAtStart: 4000 })).drafts[0].fact,
    `${KEY} started on 19 Oct 2026 with 4,000 work items and has gained 1,121 since, 28% more; it now has 5,121.`);
});

test('percentages of 1,000 or more get commas too', () => {
  assert.equal(run(withEpic({ childCount: 5121, childCountAtStart: 5 })).drafts[0].fact,
    `${KEY} started on 19 Oct 2026 with 5 work items and has gained 5,116 since, 102,320% more; it now has 5,121.`);
});

// PLAT-1 on the demo site: 1 work item at the start and 5,121 now gave "512000% more".
test('an epic that started with fewer than 5 work items gets no percentage', () => {
  const [current] = run(withEpic({ childCount: 5121, childCountAtStart: 1 })).drafts;
  assert.equal(current.fact, `${KEY} started on 19 Oct 2026 with 1 work item and has gained 5,120 since; it now has 5,121.`);
  assert.equal(current.numbers.growthPercent, null);
});
