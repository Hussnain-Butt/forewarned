// Creating mitigation tasks (story 006): one work item per chosen reason, as the user, under the
// epic, never twice, with a result per task.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPremortemAction } from '../../src/premortem/actions.js';
import { handleRun } from '../../src/premortem/consumer.js';
import { readActions } from '../../src/premortem/store.js';
import { taskSummary } from '../../src/premortem/task-content.js';
import { createTasksAction, readerReasons } from '../../src/premortem/tasks.js';
import { keyOf } from '../engine/seed-snapshot.mjs';
import { CREATE_FIELDS, fakeKvs, fakeQueue, fakeSenders, idOf, portOf, storedOf } from './fakes.mjs';

const EPIC = keyOf('ll-chk-e11');
const EPIC_ID = await idOf(EPIC);
const BLOCKER = keyOf('un-plt-e03-07');
const NOW = Date.parse('2026-11-02T08:00:00.000Z');
const LOCK = `tasks-lock:${EPIC_ID}`;
const BUSY = 'Forewarned is already creating tasks for this epic. Wait a moment, then try again.';
const STALE = "This reason isn't in the latest report any more.";

// acc-1 runs the pre-mortem; returns the KVS and the rule-based reasons with their fingerprints.
async function setup() {
  const kvs = fakeKvs();
  const builder = fakeSenders();
  const deps = { port: portOf(builder.senders), kvs, queue: fakeQueue(kvs), now: () => NOW, newId: () => 'r1', log: () => {} };
  await runPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-1' });
  await handleRun({ event: { body: { runId: 'r1', epicKey: EPIC, epicId: EPIC_ID, accountId: 'acc-1' } }, senders: builder.senders, kvs, now: () => NOW, log: () => {} });
  const { pack, report } = storedOf(kvs, EPIC_ID);
  const reasons = await readerReasons({ port: portOf(builder.senders), pack, report });
  assert.ok(reasons.length >= 3, 'the seed epic has at least 3 reasons');
  return { kvs, reasons };
}

// Creates tasks as `accountId` with senders made from `options` (shared `created` lets calls see
// each other's work items).
async function create(kvs, fingerprints, { jira = fakeSenders(), deadline = Infinity, now = NOW, accountId = 'acc-1' } = {}) {
  const deps = { port: portOf(jira.senders), kvs, now: () => now, deadline };
  return createTasksAction({ deps, epicKey: EPIC, accountId, fingerprints });
}

test('creates one task per fingerprint as a child of the epic', async () => {
  const { kvs, reasons } = await setup();
  const jira = fakeSenders();
  const chosen = reasons.slice(0, 3);
  const { results } = await create(kvs, chosen.map((r) => r.fingerprint), { jira });
  assert.equal(jira.created.length, 3);
  jira.created.forEach(({ body: { fields } }, i) => {
    assert.equal(fields.issuetype.id, '10002', 'Task');
    assert.equal(fields.project.key, 'CHK');
    assert.deepEqual(fields.parent, { key: EPIC });
    assert.deepEqual(fields.labels, ['pre-mortem']);
    assert.equal(fields.summary, taskSummary(chosen[i].mitigation));
    assert.equal(fields.description.type, 'doc');
    assert.ok(!('assignee' in fields) && !('duedate' in fields));
  });
  assert.deepEqual(results.map((r) => [r.fingerprint, r.title, r.key, r.asChild]), chosen.map((r, i) => [r.fingerprint, r.title, `CHK-${901 + i}`, true]));
  assert.ok(results.every((r) => r.url.endsWith(`/browse/${r.key}`) && !r.error));
  const { tasks, lastBatch } = await readActions(kvs, EPIC_ID);
  assert.deepEqual(Object.keys(tasks).sort(), chosen.map((r) => r.fingerprint).sort());
  assert.deepEqual(tasks[chosen[0].fingerprint], { id: '30001', key: 'CHK-901', asChild: true, createdAt: '2026-11-02T08:00:00.000Z', createdBy: 'acc-1' });
  assert.deepEqual(lastBatch, { by: 'acc-1', at: '2026-11-02T08:00:00.000Z', results });
  assert.ok(!kvs.data.has(LOCK), 'the lock is released');
});

test('a second create while one runs is refused', async () => {
  const { kvs, reasons } = await setup();
  const jira = fakeSenders();
  kvs.data.set(LOCK, { value: { at: NOW - 1000 } });
  assert.deepEqual(await create(kvs, [reasons[0].fingerprint], { jira }), { error: BUSY });
  assert.equal(jira.created.length, 0);
  assert.ok(kvs.data.has(LOCK), "another call's lock stays");
});

test('asking again returns the existing task', async () => {
  const { kvs, reasons } = await setup();
  const jira = fakeSenders();
  const fingerprints = reasons.slice(0, 3).map((r) => r.fingerprint);
  await create(kvs, fingerprints, { jira });
  const { results } = await create(kvs, [...fingerprints, fingerprints[0]], { jira });
  assert.equal(jira.created.length, 3);
  assert.deepEqual(results.map((r) => [r.key, r.existed]), [['CHK-901', true], ['CHK-902', true], ['CHK-903', true]]);
});

test('a lock older than 60 s is taken over', async () => {
  const { kvs, reasons } = await setup();
  const jira = fakeSenders();
  kvs.data.set(LOCK, { value: { at: NOW - 61000 } });
  const { results } = await create(kvs, [reasons[0].fingerprint], { jira });
  assert.equal(results[0].key, 'CHK-901');
  assert.ok(!kvs.data.has(LOCK));
});

test('a task is saved before the next one is created', async () => {
  const { kvs, reasons } = await setup();
  // The 2nd create request and its one retry fail with 500.
  const created = [];
  const jira = fakeSenders({ created, failCreate: (n) => (n === 2 || n === 3 ? 500 : 0) });
  const fingerprints = reasons.slice(0, 3).map((r) => r.fingerprint);
  const { results } = await create(kvs, fingerprints, { jira });
  assert.deepEqual(results.map((r) => r.key ?? r.error), ['CHK-901', 'Jira is busy right now. Try again in a minute.', 'CHK-902']);
  assert.deepEqual(Object.keys((await readActions(kvs, EPIC_ID)).tasks).sort(), [fingerprints[0], fingerprints[2]].sort());
  const retry = await create(kvs, [fingerprints[1]], { jira });
  assert.equal(retry.results[0].key, 'CHK-903');
  assert.equal(created.length, 3, 'one more work item, not three');
});

test('a required field is named', async () => {
  const { kvs, reasons } = await setup();
  const jira = fakeSenders({ fields: [...CREATE_FIELDS, { fieldId: 'customfield_10001', key: 'customfield_10001', name: 'Team', required: true, hasDefaultValue: false }] });
  const { results } = await create(kvs, reasons.slice(0, 2).map((r) => r.fingerprint), { jira });
  assert.deepEqual(results.map((r) => r.error), Array(2).fill("CHK requires the field 'Team' to create a work item. Create this one in Jira instead."));
  assert.equal(jira.created.length, 0);
});

test('without create permission nothing is created', async () => {
  const { kvs, reasons } = await setup();
  const jira = fakeSenders({ canCreate: false });
  const { results } = await create(kvs, [reasons[0].fingerprint], { jira });
  assert.equal(results[0].error, "You don't have permission to create work items in CHK.");
  assert.equal(jira.created.length, 0);
});

test('a space without a type that can go under an epic creates nothing', async () => {
  const { kvs, reasons } = await setup();
  const jira = fakeSenders({ types: [{ id: '10000', name: 'Epic', hierarchyLevel: 1, subtask: false }] });
  const { results } = await create(kvs, [reasons[0].fingerprint], { jira });
  assert.equal(results[0].error, 'CHK has no work item type that can go under an epic. Create this one in Jira instead.');
  assert.equal(jira.created.length, 0);
});

const BLOCKS = { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
const RELATES = { name: 'Relates', inward: 'relates to', outward: 'relates to' };
const NO_PARENT = CREATE_FIELDS.filter((f) => f.fieldId !== 'parent');

test('without a parent field the task is linked with relates to', async () => {
  const { kvs, reasons } = await setup();
  const jira = fakeSenders({ fields: NO_PARENT, linkTypes: [BLOCKS, RELATES] });
  const { results } = await create(kvs, [reasons[0].fingerprint], { jira });
  assert.equal(jira.created[0].body.fields.parent, undefined);
  assert.deepEqual([results[0].asChild, results[0].linked], [false, true]);
  assert.deepEqual(jira.links, [{ type: { name: 'Relates' }, inwardIssue: { key: 'CHK-901' }, outwardIssue: { key: EPIC } }]);
});

test('without a parent field or a relates type the task is created unlinked', async () => {
  const { kvs, reasons } = await setup();
  const jira = fakeSenders({ fields: NO_PARENT, linkTypes: [BLOCKS] });
  const { results } = await create(kvs, [reasons[0].fingerprint], { jira });
  assert.deepEqual([results[0].key, results[0].asChild, results[0].linked], ['CHK-901', false, false]);
  assert.equal(jira.links.length, 0);
});

test("a fingerprint the reader's report doesn't have creates nothing", async () => {
  const { kvs, reasons } = await setup();
  const jira = fakeSenders();
  const made = await create(kvs, ['rule:made-up|CHK-1'], { jira });
  assert.deepEqual(made.results, [{ fingerprint: 'rule:made-up|CHK-1', title: null, error: STALE }]);
  const dependency = reasons.find((r) => r.ruleId === 'dependency');
  assert.ok(dependency.fingerprint.includes(BLOCKER));
  const blind = fakeSenders({ hidden: [BLOCKER] });
  const hidden = await create(kvs, [dependency.fingerprint], { jira: blind });
  assert.equal(hidden.results[0].error, STALE);
  assert.equal(jira.created.length + blind.created.length, 0);
});

test('a deleted task can be created again', async () => {
  const { kvs, reasons } = await setup();
  const jira = fakeSenders();
  const [fingerprint] = [reasons[0].fingerprint];
  await create(kvs, [fingerprint], { jira });
  jira.deleted.push('CHK-901');
  const { results } = await create(kvs, [fingerprint], { jira });
  assert.equal(results[0].key, 'CHK-902');
  assert.ok(!results[0].existed);
  assert.equal((await readActions(kvs, EPIC_ID)).tasks[fingerprint].key, 'CHK-902');
});

test('stops before the time budget runs out', async () => {
  const { kvs, reasons } = await setup();
  const jira = fakeSenders();
  const { results } = await create(kvs, reasons.slice(0, 2).map((r) => r.fingerprint), { jira, deadline: NOW + 2000 });
  assert.deepEqual(results.map((r) => r.error), Array(2).fill('Forewarned ran out of time before this one. Try again.'));
  assert.equal(jira.created.length, 0);
});

test('bad input is refused before anything is read', async () => {
  const { kvs } = await setup();
  for (const fingerprints of [undefined, [], 'rule:x|', [1], Array(11).fill('rule:x|'), ['x'.repeat(501)]]) {
    assert.deepEqual(await create(kvs, fingerprints), { error: 'No reasons were chosen.' });
  }
});

test('without a pre-mortem there is nothing to create', async () => {
  assert.deepEqual(await create(fakeKvs(), ['rule:x|']), { error: 'Run the pre-mortem first.' });
});

test("an epic the user can't see is refused", async () => {
  const { kvs } = await setup();
  assert.deepEqual(await create(kvs, ['rule:x|'], { jira: fakeSenders({ hidden: [EPIC] }) }), { error: `${EPIC} doesn't exist, or you don't have permission to see it.` });
});
