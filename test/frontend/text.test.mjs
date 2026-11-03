// The panel's wording and dates (story 005), as pure functions with the spec's exact copy.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cardParts, checkLines, comparisonParts, droppedLine, exactTime, headline, historyLine, isOld,
  likelihoodLozenge, relativeTime, sortByLikelihood, stepLines,
} from '../../src/frontend/text.js';

const TODAY = new Date('2026-11-02T08:00:00Z');

test('headline with a due date', () => {
  assert.deepEqual(headline({ summary: 'Checkout v2 launch', due: '2026-12-12', today: TODAY }),
    { text: "It's 12 Dec 2026, and Checkout v2 launch has failed. Here's why.", note: null });
});

test('headline without a due date', () => {
  assert.deepEqual(headline({ summary: 'Notifications', due: null, today: TODAY }),
    { text: "It's 2 Feb 2027, and Notifications has failed. Here's why.", note: 'No due date is set, so Forewarned imagines launch day 3 months from today.' });
  // 30 Nov plus 3 months is the last day of February, not 2 March.
  assert.match(headline({ summary: 'X', due: null, today: new Date('2026-11-30T08:00:00Z') }).text, /^It's 28 Feb 2027,/);
});

test('stepLines', () => {
  assert.deepEqual(stepLines({ status: 'running', step: 'past epics', count: 8 }).map((s) => [s.label, s.state]), [
    ['Finding comparable epics', 'done'], ['Reading 8 past epics', 'current'], ['Checking scope growth', 'todo'],
    ['Checking team load', 'todo'], ['Checking dependencies', 'todo'], ['Writing the pre-mortem', 'todo']]);
  assert.equal(stepLines({ status: 'running', step: 'past epics', count: null })[1].label, 'Reading past epics');
  assert.equal(stepLines({ status: 'running', step: 'past epics', count: 1 })[1].label, 'Reading 1 past epic');
  assert.ok(stepLines({ status: 'queued', step: null }).every((s) => s.state === 'todo'));
  assert.ok(stepLines({ status: 'running', step: 'something new' }).every((s) => s.state === 'todo'));
  assert.ok(stepLines(null).every((s) => s.state === 'todo'));
});

test('likelihood lozenges say the level in words', () => {
  assert.deepEqual(likelihoodLozenge('High'), { text: 'High likelihood', appearance: 'removed' });
  assert.deepEqual(likelihoodLozenge('Medium'), { text: 'Medium likelihood', appearance: 'moved' });
  assert.deepEqual(likelihoodLozenge('Low'), { text: 'Low likelihood', appearance: 'default' });
});

const LONG = 'Payment gateway client that retries every failed authorization exactly once before giving up';
const evidence = new Map([
  ['E1', { id: 'E1', baseRate: true, fact: '5 of 6 comparable epics finished late.', links: [{ key: 'CHK-7', summary: 'Wallet top-up', url: 'u7' }] }],
  ['E2', { id: 'E2', baseRate: false, fact: 'CHK-12 started with 15 work items.', links: [{ key: 'CHK-12', summary: 'Checkout v2 launch', url: 'u12' }] }],
  ['E3', { id: 'E3', baseRate: false, fact: 'Ada has 18 open work items.', links: [
    { key: 'CHK-12', summary: 'Checkout v2 launch', url: 'u12' }, { key: 'CHK-11', summary: 'Gift cards', url: 'u11' },
    { key: 'PLT-3', summary: LONG, url: 'p3' }, { key: 'PLT-4', summary: 'Four', url: 'p4' }, { key: 'PLT-5', summary: 'Five', url: 'p5' },
    { key: 'PLT-6', summary: 'Six', url: 'p6' }, { key: 'CHK-7', summary: 'Wallet top-up', url: 'u7' }] }],
]);

test('chips', () => {
  const { chips } = cardParts({ title: 't', explanation: 'x', evidenceIds: ['E3'], mitigation: 'm' }, evidence, 'CHK-12');
  assert.deepEqual(chips.map((c) => c.key), ['CHK-11', 'PLT-3', 'PLT-4', 'PLT-5', 'PLT-6', 'CHK-7']);
  assert.equal(chips[1].label, 'PLT-3 Payment gateway client that…');
  assert.equal(chips[1].name, `Open PLT-3, ${LONG}, in a new tab`);
  assert.equal(chips[1].url, 'p3');
  const both = cardParts({ title: 't', explanation: 'x', evidenceIds: ['E1', 'E3'], mitigation: 'm' }, evidence, 'CHK-12');
  assert.equal(both.chips.filter((c) => c.key === 'CHK-7').length, 1, 'a work item linked twice is one chip');
});

// The demo clicks "Wallet top-up": the example's work items come before the base rate's comparison
// epics, so they are among the 4 chips shown first.
test('chips list the specific work items before the comparison epics of a base rate', () => {
  const items = new Map([
    ['E16', { id: 'E16', baseRate: true, fact: 'f16', links: ['CHK-10', 'CHK-9', 'CHK-7', 'CHK-4', 'CHK-1'].map((key) => ({ key, summary: key, url: key })) }],
    ['E15', { id: 'E15', baseRate: false, fact: 'f15', links: [{ key: 'PLT-31', summary: 'Refund', url: 'p31' }, { key: 'CHK-143', summary: 'Refund page', url: 'c143' }] }],
    ['E17', { id: 'E17', baseRate: false, fact: 'f17', links: [{ key: 'CHK-7', summary: 'Wallet top-up', url: 'u7' }, { key: 'CHK-85', summary: 'Top up', url: 'c85' }] }],
  ]);
  const { chips, facts } = cardParts({ explanation: 'x', evidenceIds: ['E15', 'E16', 'E17'] }, items, 'CHK-12');
  assert.deepEqual(chips.map((c) => c.key), ['PLT-31', 'CHK-143', 'CHK-7', 'CHK-85', 'CHK-10', 'CHK-9', 'CHK-4', 'CHK-1']);
  assert.equal(chips[2].label, 'CHK-7 Wallet top-up');
  assert.deepEqual(facts.map((f) => f.id), ['E15', 'E16', 'E17'], 'the facts keep the cited order');
});

test('the base-rate line and an explanation without it', () => {
  const rule = { explanation: '5 of 6 comparable epics finished late. Nothing in this plan accounts for that.', baseRateFact: '5 of 6 comparable epics finished late.', evidenceIds: ['E1'] };
  assert.deepEqual(cardParts(rule, evidence, 'CHK-12').baseRateLine, '5 of 6 comparable epics finished late.');
  assert.equal(cardParts(rule, evidence, 'CHK-12').explanation, 'Nothing in this plan accounts for that.');
  const onlyFact = { explanation: '5 of 6 comparable epics finished late.', baseRateFact: '5 of 6 comparable epics finished late.', evidenceIds: ['E1'] };
  assert.equal(cardParts(onlyFact, evidence, 'CHK-12').explanation, null);
  const agent = { explanation: 'History says late.', evidenceIds: ['E2', 'E1'] };
  assert.equal(cardParts(agent, evidence, 'CHK-12').baseRateLine, '5 of 6 comparable epics finished late.');
  assert.equal(cardParts(agent, evidence, 'CHK-12').explanation, 'History says late.');
  const none = { explanation: 'Ada is busy.', evidenceIds: ['E3'] };
  assert.equal(cardParts(none, evidence, 'CHK-12').baseRateLine, 'No base rate in this history, so likelihood is capped at Medium.');
  assert.deepEqual(cardParts(agent, evidence, 'CHK-12').facts, [{ id: 'E2', fact: 'CHK-12 started with 15 work items.' }, { id: 'E1', fact: '5 of 6 comparable epics finished late.' }]);
});

test('droppedLine', () => {
  assert.equal(droppedLine({ reasons: [1, 2, 3, 4], droppedByRule: { 'unknown-number': 1 } }), "The agent proposed 5 reasons; 1 was dropped because its evidence didn't check out.");
  assert.equal(droppedLine({ reasons: [1, 2], droppedByRule: { link: 2, 'unknown-key': 1 } }), "The agent proposed 5 reasons; 3 were dropped because their evidence didn't check out.");
  assert.equal(droppedLine({ reasons: [1], droppedByRule: {} }), null);
  assert.equal(droppedLine({ reasons: [], droppedByRule: { link: 1 } }), "The agent proposed 1 reason; 1 was dropped because its evidence didn't check out.");
});

test('sortByLikelihood keeps the order within a level', () => {
  const r = (title, likelihood) => ({ title, likelihood });
  assert.deepEqual(sortByLikelihood([r('a', 'Medium'), r('b', 'High'), r('c', 'Low'), r('d', 'High'), r('e', 'Medium')]).map((x) => x.title), ['b', 'd', 'a', 'e', 'c']);
});

test('comparisonParts', () => {
  const comparison = { rule: 'matched on components Payments, Web', epics: [
    { key: 'CHK-7', summary: 'Wallet top-up', url: 'u7', due: '2026-06-13', finish: '2026-07-25', daysLate: 42 },
    { key: 'CHK-9', summary: 'Promo codes', url: 'u9', due: null, finish: '2026-05-01', daysLate: null },
    { key: 'CHK-8', summary: 'Split payment', url: 'u8', due: '2026-04-10', finish: '2026-04-10', daysLate: 0 },
    { key: 'CHK-6', summary: 'Guest checkout', url: 'u6', due: '2026-03-10', finish: '2026-03-07', daysLate: -3 },
    { key: 'CHK-5', summary: 'One day', url: 'u5', due: '2026-03-10', finish: '2026-03-11', daysLate: 1 },
  ] };
  const parts = comparisonParts(comparison, 'CHK');
  assert.equal(parts.line, 'Compared with 5 finished epics in CHK (matched on components Payments, Web)');
  assert.deepEqual(parts.rows.map((r) => r.detail), [
    'due 13 Jun 2026, finished 25 Jul 2026, 42 days late', 'no due date, finished 1 May 2026',
    'due 10 Apr 2026, finished 10 Apr 2026, on time', 'due 10 Mar 2026, finished 7 Mar 2026, 3 days early',
    'due 10 Mar 2026, finished 11 Mar 2026, 1 day late']);
  assert.deepEqual(parts.rows[0], { key: 'CHK-7', label: 'CHK-7 Wallet top-up', url: 'u7', detail: parts.rows[0].detail });
});

// The count stays in the slip check's own note ("Only 1 finished epic found in PLAT…"), read from
// the stored pack, so the intro neither repeats it nor shows a different, reader-filtered number.
test('historyLine and checkLines', () => {
  assert.equal(historyLine('PLAT'), 'Not enough history in PLAT for slip patterns. Here is what Forewarned could still check:');
  const checks = { slip: { status: 'insufficient', note: 'n1' }, scope: { status: 'found', note: '' }, load: { status: 'found', note: 'n3' }, dependencies: { status: 'clear', note: 'No open blockers.' } };
  assert.deepEqual(checkLines(checks), [
    { label: 'Slip history', status: 'Not enough data', note: 'n1' }, { label: 'Scope growth', status: 'Found', note: '' },
    { label: 'Team load', status: 'Found', note: 'n3' }, { label: 'Dependencies', status: 'Clear', note: 'No open blockers.' }]);
});

test('relativeTime, exactTime and isOld', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(relativeTime('2026-11-02T11:59:30Z', now), 'just now');
  assert.equal(relativeTime('2026-11-02T11:59:00Z', now), '1 minute ago');
  assert.equal(relativeTime('2026-11-02T11:55:00Z', now), '5 minutes ago');
  assert.equal(relativeTime('2026-11-02T11:00:00Z', now), '1 hour ago');
  assert.equal(relativeTime('2026-10-30T12:00:00Z', now), '3 days ago');
  assert.equal(exactTime('2026-11-02T12:26:10Z', 'UTC'), '2 Nov 2026, 12:26');
  assert.equal(isOld('2026-11-01T11:59:00Z', now), true);
  assert.equal(isOld('2026-11-01T12:01:00Z', now), false);
});
