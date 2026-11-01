// Comparable epics (story 002 AC 4–7).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectComparable } from '../../src/engine/comparable.js';
import { answerKey, keyOf, seedSnapshot } from './seed-snapshot.mjs';

const TODAY = 20000;
const current = { key: 'CHK-1', space: 'CHK', components: ['Payments', 'Web'], labels: [] };
const done = (n, finish, extra = {}) => ({
  key: `CHK-${n}`, space: 'CHK', statusCategory: 'done', finish, components: [], labels: [], ...extra,
});

test('the seed compares Checkout v2 with the 8 epics sharing Payments or Web', () => {
  const { epic, candidates, today } = seedSnapshot();
  const { rule, epics } = selectComparable(epic, candidates, today);
  assert.equal(rule, 'matched on components Payments, Web');
  assert.deepEqual(epics.map((e) => e.key), answerKey.comparison.epics.map((e) => keyOf(e.externalId)));
});

test('an epic without components or labels is compared with all finished epics of its space', () => {
  const { epic, candidates, today } = seedSnapshot();
  const { rule, epics } = selectComparable({ ...epic, components: [], labels: [] }, candidates, today);
  assert.equal(rule, 'all finished epics in CHK from the last 12 months');
  assert.equal(epics.length, 10);
});

test('fewer than 3 matching epics fall back to all finished epics', () => {
  const candidates = [done(2, TODAY - 1, { components: ['Web'] }), done(3, TODAY - 2, { components: ['Payments'] }), done(4, TODAY - 3)];
  const { rule, epics } = selectComparable(current, candidates, TODAY);
  assert.equal(rule, 'all finished epics in CHK from the last 12 months');
  assert.deepEqual(epics.map((e) => e.key), ['CHK-2', 'CHK-3', 'CHK-4']);
});

test('at most the 20 most recent epics from the last 365 days, never the epic itself or one without a finish', () => {
  const candidates = Array.from({ length: 30 }, (_, i) => done(i + 10, TODAY - i, { components: ['Web'] }));
  candidates.push(done(1, TODAY - 5, { components: ['Web'] })); // the current epic
  candidates.push(done(90, TODAY - 366, { components: ['Web'] }));
  candidates.push(done(91, null, { components: ['Web'] }));
  const { epics } = selectComparable(current, candidates, TODAY);
  assert.equal(epics.length, 20);
  assert.equal(epics[0].key, 'CHK-10');
  assert.equal(epics[19].key, 'CHK-29');
  assert.ok(!epics.some((e) => ['CHK-1', 'CHK-90', 'CHK-91'].includes(e.key)));
});

test('the rule names the current epic\'s labels, and components and labels together', () => {
  const shared = (extra) => [1, 2, 3].map((n) => done(n + 1, TODAY - n, extra));
  const labelsOnly = { ...current, components: [], labels: ['mobile-launch'] };
  assert.equal(selectComparable(labelsOnly, shared({ labels: ['mobile-launch'] }), TODAY).rule, 'matched on labels mobile-launch');
  const both = { ...current, components: ['Payments'], labels: ['mobile-launch'] };
  assert.equal(selectComparable(both, shared({ components: ['Payments'] }), TODAY).rule, 'matched on components Payments and labels mobile-launch');
});
