// Slip signal (story 002 AC 10–15; answer key P2 and P3).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectComparable } from '../../src/engine/comparable.js';
import { slipSignal } from '../../src/engine/slip.js';
import { assertEvidence, expectedEvidence } from './expect.mjs';
import { keyOf, seedSnapshot } from './seed-snapshot.mjs';

const run = (snapshot, pick = (c) => c) => {
  const comparison = selectComparable(snapshot.epic, snapshot.candidates, snapshot.today);
  return slipSignal(snapshot, pick(comparison));
};

test('the seed shows that comparable epics usually finish late (P2) and that the plan is short (P3)', () => {
  const { check, drafts } = run(seedSnapshot());
  assert.equal(check.status, 'found');
  assert.deepEqual(drafts.map((d) => d.type), ['slip-base-rate', 'plan-vs-history', 'duration-base-rate', 'slip-example', 'slip-example', 'slip-example']);
  for (const e of [...expectedEvidence('P2', 'slip-base-rate'), ...expectedEvidence('P3', 'duration-base-rate'), ...expectedEvidence('P3', 'plan-vs-history')]) {
    assert.equal(assertEvidence(drafts, e).baseRate, true);
  }
  for (const e of expectedEvidence('P2', 'slip-example')) assert.equal(assertEvidence(drafts, e).baseRate, false);
  assert.deepEqual(drafts.filter((d) => d.type === 'slip-example').map((d) => d.numbers.daysLate), [42, 30, 21]);
  assert.ok(drafts.every((d) => d.signal === 'slip'));
});

test('facts state the derived numbers in the fixed wording', () => {
  const { drafts } = run(seedSnapshot());
  const fact = (type) => drafts.find((d) => d.type === type).fact;
  assert.equal(fact('slip-base-rate'), '5 of 6 comparable epics with a due date finished late (83%; 1 on time), by a median of 21 days (from 12 to 42 days).');
  assert.equal(fact('plan-vs-history'), `${keyOf('ll-chk-e11')} is planned for 56 days (started 19 Oct 2026, due 14 Dec 2026); 7 of 8 comparable epics took longer than 56 days (88%; 1 took 56 days or less).`);
  assert.equal(fact('duration-base-rate'), 'Comparable epics took a median of 77 days from start to done (8 epics: 6 with a due date and 2 without).');
  assert.equal(fact('slip-example'), `${keyOf('ll-chk-e07')} Wallet top-up was due 15 Jun 2026 and finished 27 Jul 2026, 42 days late.`);
});

test('without any due dates there is no late base rate and no plan comparison', () => {
  const snapshot = seedSnapshot({ edit: (records) => { for (const r of records.values()) r.due = null; } });
  const { check, drafts } = run(snapshot);
  assert.deepEqual(drafts.map((d) => d.type), ['duration-base-rate']);
  assert.match(check.note, new RegExp(`${keyOf('ll-chk-e11')} has no due date, so its plan can't be compared with history\\.`));
});

test('fewer than 3 comparable epics: insufficient, and no base rates', () => {
  const { check, drafts } = run(seedSnapshot(), (c) => ({ ...c, epics: c.epics.slice(0, 2) }));
  assert.equal(check.status, 'insufficient');
  assert.match(check.note, /^Only 2 finished epic\(s\) found in CHK in the last 12 months; Forewarned needs 3 for slip patterns\./);
  assert.ok(drafts.every((d) => !d.baseRate));
  assert.deepEqual(drafts.map((d) => d.type), ['slip-example']); // the epic finished 30 days late
});

test('when every comparable epic was on time the base rate still says so', () => {
  const onTime = (c) => ({ ...c, epics: c.epics.map((e) => (e.due === null ? e : { ...e, due: e.finish + 3 })) });
  const { drafts } = run(seedSnapshot(), onTime);
  assert.equal(drafts[0].fact, '0 of 6 comparable epics with a due date finished late (0%; 6 on time).');
  assert.ok(!drafts.some((d) => d.type === 'slip-example'));
});

test('a due date on or before the start gives a note, not "planned for -5 days"', () => {
  const snapshot = seedSnapshot();
  const { check, drafts } = run({ ...snapshot, epic: { ...snapshot.epic, due: snapshot.epic.start - 5 } });
  assert.ok(!drafts.some((d) => d.type === 'plan-vs-history'));
  assert.match(check.note, new RegExp(`${keyOf('ll-chk-e11')}'s due date is not after its start, so its plan can't be compared with history\.`));
});

test('"0 of 6 … finished late" still links the epics it counted (AC 26)', () => {
  const onTime = (c) => ({ ...c, epics: c.epics.map((e) => (e.due === null ? e : { ...e, due: e.finish + 3 })) });
  assert.equal(run(seedSnapshot(), onTime).drafts[0].links.length, 6);
});
