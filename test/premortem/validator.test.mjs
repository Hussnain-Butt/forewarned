// The validator (story 003 AC 9–18): every rule has a passing and a failing case.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keysIn, numbersIn, parseReasonsJson, validateReasons } from '../../src/premortem/validator.js';

const PACK = {
  packId: 'p1',
  epic: { key: 'CHK-12', summary: 'Release 3.1 checkout' },
  evidence: [
    { id: 'E1', source: 'history', baseRate: true, fact: '5 of 6 comparable epics with a due date finished late (83%; 1 on time), by a median of 21 days (from 12 to 42 days).', links: [{ key: 'CHK-7', summary: 'Wallet top-up' }] },
    { id: 'E2', source: 'history', baseRate: false, fact: 'CHK-7 Wallet top-up was due 15 Jun 2026 and finished 27 Jul 2026, 42 days late.', links: [{ key: 'CHK-7', summary: 'Wallet top-up' }] },
    { id: 'E3', source: 'history', baseRate: false, fact: 'CHK-12 started on 19 Oct 2026 with 15 work items and has gained 6 since, 40% more; it now has 21.', links: [{ key: 'CHK-12', summary: 'Checkout v2 launch' }] },
    { id: 'E4', source: 'team', baseRate: false, fact: '3 people worry about the gateway.', links: [] },
    { id: 'E5', source: 'history', baseRate: true, fact: '3 of 4 comparable epics that had work blocked by PLT work items finished late (75%; 1 on time).', links: [{ key: 'CHK-30', summary: 'Release 2.0 checkout' }] },
    { id: 'E6', source: 'history', baseRate: false, fact: 'PLAT-1 started on 17 Aug 2021 with 1 work item and has gained 5,120 since, 512000% more; it now has 5,121.', links: [{ key: 'PLAT-1', summary: 'Platform' }] },
  ],
};
const reason = (extra = {}) => ({
  title: 'Epics like this one usually finish late',
  likelihood: 'High',
  explanation: '5 of 6 comparable epics finished late, by a median of 21 days.',
  evidenceIds: ['E1'],
  mitigation: 'Plan for the median slip of 21 days now: add buffer or cut scope.',
  ...extra,
});
const one = (r) => validateReasons([r], PACK);
const keptOne = (r) => one(r).kept[0];
const droppedCode = (r) => one(r).dropped[0]?.code;

test('parseReasonsJson accepts an array and refuses everything else with a plain error (AC 9)', () => {
  assert.deepEqual(parseReasonsJson(JSON.stringify([reason()])), { reasons: [reason()] });
  assert.deepEqual(parseReasonsJson('[{'), { error: 'reasonsJson is not valid JSON.' });
  assert.deepEqual(parseReasonsJson('{"title":"x"}'), { error: 'reasonsJson must be a JSON array of reasons.' });
  assert.deepEqual(parseReasonsJson(JSON.stringify(Array.from({ length: 21 }, () => reason()))), { error: 'reasonsJson has more than 20 reasons.' });
  assert.deepEqual(parseReasonsJson(`["${'a'.repeat(20001)}"]`), { error: 'reasonsJson is longer than 20,000 characters.' });
  assert.deepEqual(parseReasonsJson(undefined), { error: 'reasonsJson is not valid JSON.' });
});

test('required fields: title, likelihood, mitigation; likelihood in any letter case (AC 10)', () => {
  assert.equal(droppedCode('just text'), 'not-an-object');
  assert.equal(droppedCode(reason({ title: '  ' })), 'missing-title');
  assert.equal(droppedCode(reason({ likelihood: 'very high' })), 'missing-likelihood');
  assert.equal(droppedCode(reason({ mitigation: undefined })), 'missing-mitigation');
  assert.equal(keptOne(reason({ likelihood: 'medium' })).likelihood, 'Medium');
});

test('over-long text is cut at a word boundary with "…" (AC 10)', () => {
  const kept = keptOne(reason({ title: `${'word '.repeat(30)}end`, explanation: 'x '.repeat(400) }));
  assert.ok(kept.title.endsWith('…') && Array.from(kept.title).length <= 120, kept.title);
  assert.ok(!/ …$/.test(kept.title));
  assert.ok(Array.from(kept.explanation).length <= 600);
});

test('unknown evidence IDs are removed; a reason needs at least one history item (AC 11)', () => {
  assert.deepEqual(keptOne(reason({ evidenceIds: ['E99', 'E1', 'E1'] })).evidenceIds, ['E1']);
  assert.equal(droppedCode(reason({ evidenceIds: ['E99'] })), 'no-history-evidence');
  assert.equal(droppedCode(reason({ evidenceIds: ['E4'], explanation: '', mitigation: 'Talk to the gateway team.', title: 'Gateway worries' })), 'no-history-evidence');
  assert.equal(droppedCode(reason({ evidenceIds: 'E1' })), 'no-history-evidence');
});

test('numbers rule: only numbers from the cited facts and link summaries (AC 12, Review Focus 1)', () => {
  assert.ok(keptOne(reason()));
  assert.equal(droppedCode(reason({ explanation: 'Comparable epics were about 40 days late.', evidenceIds: ['E2'], likelihood: 'Medium', mitigation: 'Add buffer.' })), 'unknown-number');
  // Words two to twelve count as numbers.
  assert.ok(keptOne(reason({ explanation: 'Three of four comparable epics blocked by PLT finished late.', evidenceIds: ['E5'], mitigation: 'Agree dates with PLT.' })));
  assert.equal(droppedCode(reason({ explanation: 'Three of five comparable epics finished late.', evidenceIds: ['E5'], mitigation: 'Agree dates with PLT.' })), 'unknown-number');
  // Keys, evidence IDs, "v2" and ordinals are not numbers; dates, commas and percent signs are normalized.
  assert.ok(keptOne(reason({ title: 'Checkout v2 launch keeps growing', explanation: 'CHK-12 has grown 40 % since it started on 19 Oct 2026, the first such jump (E3).', evidenceIds: ['E3'], likelihood: 'Medium', mitigation: 'Freeze scope for Checkout v2 launch.' })));
  assert.ok(keptOne(reason({ title: 'Platform keeps growing', explanation: 'PLAT-1 now has 5121 work items.', evidenceIds: ['E6'], likelihood: 'Low', mitigation: 'Split it.' })));
  // A number in a cited link's summary is known.
  assert.ok(keptOne(reason({ title: 'PLT work could block Release 2.0 checkout', explanation: '3 of 4 comparable epics blocked by PLT finished late.', evidenceIds: ['E5'], mitigation: 'Agree a date with PLT.' })));
});

test('numbersIn and keysIn read only real quantities and real keys', () => {
  assert.deepEqual([...numbersIn('CHK-12 (E3) Checkout v2 grew 40 % to 5,121 on 19 Oct 2026; the 1st, three')].sort(), ['19', '2026', '3', '40', '5121'].sort());
  assert.deepEqual([...keysIn('Ask PLT-31 and CHK-143 about E3 and v2')].sort(), ['CHK-143', 'PLT-31']);
});

test('keys rule: every work item key must be in the cited facts or links (AC 13)', () => {
  assert.ok(keptOne(reason({ explanation: 'CHK-7 finished 42 days late.', evidenceIds: ['E2'], likelihood: 'Medium', mitigation: 'Learn from CHK-7.' })));
  assert.equal(droppedCode(reason({ explanation: 'CHK-99 finished 42 days late.', evidenceIds: ['E2'], likelihood: 'Medium', mitigation: 'Add buffer.' })), 'unknown-key');
});

// Stored write-ups are shown to other users and given to their agents, so they may not carry links.
test('a reason with a web address or a markdown link is dropped', () => {
  for (const mitigation of ['See https://example.com for the fix.', 'Read www.example.com first.', 'Read [the plan](x) first.']) {
    assert.equal(droppedCode(reason({ mitigation })), 'link', mitigation);
  }
});

test('likelihood cap: High without a cited base rate becomes Medium and is kept (AC 14)', () => {
  const kept = keptOne(reason({ explanation: 'CHK-7 finished 42 days late.', evidenceIds: ['E2'], mitigation: 'Add buffer.' }));
  assert.equal(kept.likelihood, 'Medium');
  assert.equal(keptOne(reason()).likelihood, 'High');
});

test('at most 5 in the order given, no duplicates, no padding, counts per rule code (AC 15–17)', () => {
  const titles = ['A', 'B', 'a ', 'C', 'D', 'E', 'F'];
  const result = validateReasons(titles.map((title) => reason({ title })), PACK);
  assert.deepEqual(result.kept.map((r) => r.title), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(result.dropped, [{ title: 'a', code: 'duplicate' }, { title: 'F', code: 'over-five' }]);
  assert.deepEqual(result.droppedByRule, { duplicate: 1, 'over-five': 1 });
  assert.deepEqual(validateReasons([], PACK), { kept: [], dropped: [], droppedByRule: {} });
});

test('only validated fields are kept; extra fields need an explicit keep list (AC 21)', () => {
  const kept = keptOne(reason({ chat: 'Sure! Here is my analysis…', ruleId: 'slip-base-rate' }));
  assert.deepEqual(Object.keys(kept).sort(), ['evidenceIds', 'explanation', 'likelihood', 'mitigation', 'title']);
  const trusted = validateReasons([reason({ ruleId: 'slip-base-rate' })], PACK, { keep: ['ruleId'] }).kept[0];
  assert.equal(trusted.ruleId, 'slip-base-rate');
});

test("the epic's own key and summary are known in every reason", () => {
  assert.ok(keptOne(reason({ title: 'Epics like Release 3.1 checkout usually finish late', mitigation: 'Plan CHK-12 for the median slip of 21 days.' })));
  assert.equal(droppedCode(reason({ mitigation: 'Plan CHK-13 for the median slip of 21 days.' })), 'unknown-key');
});

test('a key-like word in the epic summary is known too', () => {
  const pack = { ...PACK, epic: { key: 'CHK-12', summary: 'ISO-27001 audit readiness' } };
  const kept = validateReasons([reason({ mitigation: 'Freeze scope for ISO-27001 audit readiness.' })], pack).kept;
  assert.equal(kept.length, 1);
});

test('numbers glued to a unit still count ("3x", "40days", "10k"); ordinals do not', () => {
  assert.deepEqual([...numbersIn('3x longer, about 40days, 10k items, 1.5x, the 1st and 21st')].sort(), ['1.5', '10', '3', '40'].sort());
  assert.equal(droppedCode(reason({ explanation: 'Comparable epics took 3x longer.' })), 'unknown-number');
  assert.equal(droppedCode(reason({ explanation: 'They slipped about 40days.' })), 'unknown-number');
});
