// What a mitigation task holds (story 006 AC 5, 6 and 10): its fingerprint, summary, description
// and work item type, as pure functions.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprintOf, pickTaskType, taskDescription, taskSummary } from '../../src/premortem/task-content.js';

const SITE = 'https://one-atlas.example';
const link = (key, summary) => ({ key, summary, url: `${SITE}/browse/${key}` });
const evidence = new Map([
  ['E1', { id: 'E1', baseRate: true, fact: '5 of 6 comparable epics finished late.', links: [link('CHK-7', 'Wallet top-up')] }],
  ['E2', { id: 'E2', baseRate: false, fact: 'PLT-31 blocks CHK-12 and is still open.', links: [link('PLT-31', 'Token service'), link('CHK-12', 'Checkout v2 launch')] }],
  ['E3', { id: 'E3', baseRate: false, fact: 'CHK-12 started with 15 work items.', links: [link('CHK-12', 'Checkout v2 launch')] }],
]);
const EPIC = 'CHK-12';

// What a reason is about, beyond its rule or title: the blocker it names (open-blocker) or the
// person (load-person). Base rates, examples and people's other epics change as the space's
// history grows, so they are left out and a later run finds the same task (AC 10–11).
const blocker = { id: 'B1', type: 'open-blocker', baseRate: false, fact: 'PLT-31 blocks CHK-143.', about: { space: 'PLT', blocker: 'PLT-31' }, links: [link('PLT-31', 'Token service'), link('CHK-143', 'Refunds')] };
const person = { id: 'P1', type: 'load-person', baseRate: false, fact: 'Ada has 18 open work items.', about: { name: 'Ada Isadora' }, links: [link('CHK-12', 'Checkout v2 launch'), link('CHK-129', 'Gift cards'), link('PLT-21', 'Gateway')] };
const subjects = new Map([...evidence, ['B1', blocker], ['P1', person]]);

test('fingerprint', () => {
  assert.equal(fingerprintOf({ ruleId: 'dependency', evidenceIds: ['B1', 'E1', 'E2'] }, subjects), 'rule:dependency|PLT-31');
  assert.equal(fingerprintOf({ ruleId: 'load', evidenceIds: ['P1', 'E3'] }, subjects), 'rule:load|Ada Isadora');
  assert.equal(fingerprintOf({ ruleId: 'slip-base-rate', evidenceIds: ['E1', 'E2'] }, subjects), 'rule:slip-base-rate|');
  const loud = fingerprintOf({ title: 'PLT work could block Checkout v2 launch!', evidenceIds: ['B1', 'E1'] }, subjects);
  const quiet = fingerprintOf({ title: 'plt work could block checkout v2 launch', evidenceIds: ['B1'] }, subjects);
  assert.equal(loud, quiet);
  assert.equal(loud, 'agent:plt work could block checkout v2 launch|PLT-31');
  const otherBlocker = { ...blocker, id: 'B2', about: { space: 'PLT', blocker: 'PLT-40' } };
  assert.notEqual(fingerprintOf({ ruleId: 'dependency', evidenceIds: ['B2'] }, new Map([['B2', otherBlocker]])), 'rule:dependency|PLT-31', 'another blocker is another reason');
});

test("a fingerprint doesn't change when the history behind a reason does", () => {
  const grown = new Map([...subjects, ['E1', { ...evidence.get('E1'), links: [link('CHK-7', 'Wallet top-up'), link('CHK-170', 'New epic')] }],
    ['P1', { ...person, links: [...person.links, link('PLT-50', 'Another epic')] }]]);
  for (const reason of [{ ruleId: 'dependency', evidenceIds: ['B1', 'E1'] }, { ruleId: 'load', evidenceIds: ['P1'] }, { ruleId: 'slip-base-rate', evidenceIds: ['E1'] }]) {
    assert.equal(fingerprintOf(reason, grown), fingerprintOf(reason, subjects));
  }
});

test('summary', () => {
  assert.equal(taskSummary('Agree a date\nfor **PLT-31** with <b>PLT</b>'), 'Agree a date for PLT-31 with PLT');
  assert.equal(taskSummary('  Use `feature flags`\r\n\r\n  for the  launch '), 'Use feature flags for the launch');
  const long = Array.from({ length: 60 }, (_, i) => `step${i}`).join(' ');
  assert.ok(long.length > 300);
  const summary = taskSummary(long);
  assert.ok(Array.from(summary).length <= 255);
  assert.ok(summary.endsWith('…'));
  const kept = summary.slice(0, -1);
  assert.ok(long.startsWith(kept) && long[kept.length] === ' ', 'cut at a word boundary');
});

// Every text node in an ADF document, so empty ones (Jira rejects them) can be found.
const textNodes = (node) => (node.type === 'text' ? [node] : (node.content || []).flatMap(textNodes));

test('description', () => {
  const reason = {
    ruleId: 'slip-base-rate',
    title: 'Checkout v2 launch could finish late',
    likelihood: 'High',
    baseRateFact: '5 of 6 comparable epics finished late.',
    explanation: '5 of 6 comparable epics finished late. Platform work blocks this epic.',
    evidenceIds: ['E1', 'E2'],
    mitigation: 'Agree a date for PLT-31.',
  };
  const doc = taskDescription({ reason, evidenceById: evidence, epicKey: EPIC, runAt: '2026-11-02T08:00:00.000Z' });
  assert.equal(doc.type, 'doc');
  assert.equal(doc.version, 1);
  const json = JSON.stringify(doc);
  for (const part of [
    'Checkout v2 launch could finish late', 'Likelihood: High', '5 of 6 comparable epics finished late.',
    'Platform work blocks this epic.', 'E1: ', 'E2: PLT-31 blocks CHK-12 and is still open.',
    'Created from the Forewarned pre-mortem of 2 Nov 2026.',
  ]) assert.ok(json.includes(part), part);
  const links = textNodes(doc).flatMap((node) => (node.marks || []).filter((mark) => mark.type === 'link').map((mark) => mark.attrs.href));
  assert.deepEqual(links, [`${SITE}/browse/CHK-7`, `${SITE}/browse/PLT-31`]);
  assert.ok(!links.includes(`${SITE}/browse/CHK-12`), 'no link to the epic');
  assert.ok(textNodes(doc).every((node) => node.text.length > 0));
  assert.equal(textNodes(doc)[0].marks[0].type, 'strong');
});

test('description without an explanation beyond the base rate', () => {
  const reason = { title: 'T', likelihood: 'Medium', explanation: '', evidenceIds: ['E3'], mitigation: 'M' };
  const doc = taskDescription({ reason, evidenceById: evidence, epicKey: EPIC, runAt: '2026-11-02T08:00:00.000Z' });
  assert.ok(textNodes(doc).every((node) => node.text.length > 0));
  assert.ok(JSON.stringify(doc).includes('E3: CHK-12 started with 15 work items.'));
  assert.ok(!JSON.stringify(doc).includes('"href"'), 'an item citing only the epic has no links');
});

const type = (id, name, hierarchyLevel, subtask = false) => ({ id, name, hierarchyLevel, subtask });

test('pickTaskType', () => {
  assert.deepEqual(pickTaskType([type('1', 'Epic', 1), type('2', 'Story', 0), type('3', 'Task', 0), type('4', 'Sub-task', -1, true)]), { id: '3', name: 'Task' });
  assert.deepEqual(pickTaskType([type('1', 'Epic', 1), type('2', 'Story', 0), type('5', 'Bug', 0)]), { id: '2', name: 'Story' });
  assert.equal(pickTaskType([type('1', 'Epic', 1), type('4', 'Subtask', -1, true)]), null);
  assert.equal(pickTaskType([]), null);
});
