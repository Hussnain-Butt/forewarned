// The seed Snapshot helper (story 002 AC 35) matches the answer key's numbers for Checkout v2.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayOf } from '../../src/engine/format.js';
import { SEED_TODAY, answerKey, keyOf, seedSnapshot } from './seed-snapshot.mjs';

test('Checkout v2 launch as fetch would return it', () => {
  const snapshot = seedSnapshot();
  const today = dayOf(SEED_TODAY);
  const { epic } = snapshot;
  assert.equal(snapshot.today, today);
  assert.equal(epic.key, keyOf(answerKey.currentEpic.externalId));
  assert.equal(epic.summary, 'Checkout v2 launch');
  assert.equal(epic.statusCategory, 'indeterminate');
  assert.equal(epic.childCount, 21);
  assert.equal(epic.childCountAtStart, 15);
  assert.equal(epic.openChildren.total, 17);
  assert.equal(epic.openChildren.read.length, 17);
  assert.equal(epic.openChildren.unassignedTotal, 5);
  assert.equal(epic.start, today - 14);
  assert.equal(epic.due, today + 42);
  assert.equal(snapshot.candidates.length, 10);
  assert.ok(snapshot.candidates.every((c) => c.statusCategory === 'done' && c.details));
  assert.equal(snapshot.linkTypeFound, true);
  assert.equal(snapshot.blockers[keyOf('un-plt-e03-07')].statusCategory, 'new');
  assert.equal(snapshot.blockers[keyOf('pf-plt-e03-02')].statusCategory, 'done');
});

test('edit changes the seed records before the Snapshot is built', () => {
  const snapshot = seedSnapshot({ edit: (records) => { records.get('ll-chk-e11').due = null; } });
  assert.equal(snapshot.epic.due, null);
});
