// The panel's one data call (story 005): the reader-filtered report and evidence, the comparison
// set, and whether the user may run.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPremortemAction } from '../../src/premortem/actions.js';
import { handleRun } from '../../src/premortem/consumer.js';
import { getPanelData, requestAgentAction } from '../../src/premortem/panel.js';
import { createTasksAction } from '../../src/premortem/tasks.js';
import { keyOf } from '../engine/seed-snapshot.mjs';
import { fakeKvs, fakeQueue, fakeSenders, idOf, portOf } from './fakes.mjs';

const EPIC = keyOf('ll-chk-e11');
const EPIC_ID = await idOf(EPIC);
const BLOCKER = keyOf('un-plt-e03-07');
const NOW = Date.parse('2026-11-02T08:00:00.000Z');

// acc-1 runs the pre-mortem; the panel then reads it with senders made from `readerOptions`.
async function panelFor(readerOptions = {}, { withRun = true, kvs = fakeKvs(), accountId } = {}) {
  if (withRun) {
    const builder = fakeSenders();
    const deps = { port: portOf(builder.senders), kvs, queue: fakeQueue(kvs), now: () => NOW, newId: () => 'r1', log: () => {} };
    await runPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-1' });
    await handleRun({ event: { body: { runId: 'r1', epicKey: EPIC, epicId: EPIC_ID, accountId: 'acc-1' } }, senders: builder.senders, kvs, now: () => NOW, log: () => {} });
  }
  return getPanelData({ deps: { port: portOf(fakeSenders(readerOptions).senders), kvs, now: () => NOW }, epicKey: EPIC, accountId });
}

test('the builder gets the report, the evidence, the comparison set and may run', async () => {
  const panel = await panelFor();
  assert.equal(panel.issueKey, EPIC);
  assert.equal(panel.canRun, true);
  assert.equal(panel.report.version, 2);
  assert.equal(panel.evidence.length, 17);
  assert.deepEqual(Object.keys(panel.evidence[0]).sort(), ['baseRate', 'fact', 'id', 'links']);
  assert.equal(panel.comparison.epics.length, 8);
  assert.deepEqual(panel.epic, { summary: 'Checkout v2 launch', due: panel.epic.due });
  assert.match(panel.epic.due, /^\d{4}-\d{2}-\d{2}$/);
});

test('a reader who can\'t see the blocker gets neither it nor its reasons', async () => {
  const panel = await panelFor({ hidden: [BLOCKER] });
  assert.ok(!JSON.stringify(panel).includes(BLOCKER));
  assert.equal(panel.report.hiddenForReader, true);
});

test('a viewer who can\'t edit may read but not run', async () => {
  const panel = await panelFor({ canEdit: false });
  assert.equal(panel.canRun, false);
  assert.equal(panel.report.version, 2);
});

test('before any run the panel gets no report', async () => {
  const panel = await panelFor({}, { withRun: false });
  assert.deepEqual(panel, {
    issueKey: EPIC, canRun: true, canCreate: true, space: 'CHK', report: null, evidence: [], comparison: null, epic: null, agentRequest: null, tasks: {}, taskResults: null,
  });
});

test('a work item that isn\'t an epic gets "This panel works on epics only." (005 AC 3)', async () => {
  const kvs = fakeKvs();
  const panel = await getPanelData({ deps: { port: portOf(fakeSenders().senders), kvs }, epicKey: keyOf('bk-chk-e11-03') });
  assert.deepEqual(panel, { error: 'This panel works on epics only.' });
});

test('an epic the user can\'t see gets the not-visible message', async () => {
  const panel = await panelFor({ hidden: [EPIC] });
  assert.deepEqual(panel, { error: `${EPIC} doesn't exist, or you don't have permission to see it.` });
});

// The panel asks the agent, Rovo opens and Jira remounts the panel; the new panel finds the request
// and keeps waiting for the write-up (story 005 AC 19).
test('asking the agent is remembered for this user, so a remounted panel keeps waiting', async () => {
  const kvs = fakeKvs();
  const first = await panelFor({}, { kvs, accountId: 'acc-1' });
  assert.equal(first.agentRequest, null);
  const deps = { port: portOf(fakeSenders().senders), kvs, now: () => NOW };
  assert.deepEqual(await requestAgentAction({ deps, epicKey: EPIC, accountId: 'acc-1' }), { requested: true });
  const again = await getPanelData({ deps, epicKey: EPIC, accountId: 'acc-1' });
  assert.deepEqual(again.agentRequest, { savedBefore: null, requestedAt: '2026-11-02T08:00:00.000Z', ageMs: 0 });
  assert.equal((await getPanelData({ deps, epicKey: EPIC, accountId: 'acc-2' })).agentRequest, null);
});

// The panel measures the 3-minute wait from the server's clock, so a reader whose computer clock
// is off still resumes waiting after the Rovo remount.
test("the agent request's age comes from the server clock", async () => {
  const kvs = fakeKvs();
  await panelFor({}, { kvs, accountId: 'acc-1' });
  const port = portOf(fakeSenders().senders);
  await requestAgentAction({ deps: { port, kvs, now: () => NOW }, epicKey: EPIC, accountId: 'acc-1' });
  const later = await getPanelData({ deps: { port, kvs, now: () => NOW + 70000 }, epicKey: EPIC, accountId: 'acc-1' });
  assert.equal(later.agentRequest.ageMs, 70000);
});

test("a reader who can't see a comparison epic doesn't get it in the comparison set", async () => {
  const [hiddenEpic] = (await panelFor()).comparison.epics.map((e) => e.key);
  const panel = await panelFor({ hidden: [hiddenEpic] });
  assert.ok(!panel.comparison.epics.some((e) => e.key === hiddenEpic));
  assert.equal(panel.comparison.epics.length, 7);
  assert.ok(!JSON.stringify(panel).includes(`"${hiddenEpic}"`));
});

test("asking the agent about an epic the user can't see is refused", async () => {
  const deps = { port: portOf(fakeSenders({ hidden: [EPIC] }).senders), kvs: fakeKvs(), now: () => NOW };
  assert.deepEqual(await requestAgentAction({ deps, epicKey: EPIC, accountId: 'acc-1' }), { error: `${EPIC} doesn't exist, or you don't have permission to see it.` });
});

// Story 006: what the panel needs to tick reasons and show their tasks.
const allReasons = (panel) => [...panel.report.ruleBased.reasons, ...(panel.report.agent?.reasons ?? [])];

test('reasons carry fingerprints and the user may create', async () => {
  const panel = await panelFor();
  assert.ok(allReasons(panel).length >= 3);
  assert.ok(allReasons(panel).every((r) => typeof r.fingerprint === 'string' && r.fingerprint.startsWith(`rule:${r.ruleId}|`)));
  assert.equal(panel.canCreate, true);
  assert.equal(panel.space, 'CHK');
  assert.deepEqual(panel.tasks, {});
  assert.equal(panel.taskResults, null);
});

test('a viewer without create permission gets canCreate false', async () => {
  assert.equal((await panelFor({ canCreate: false })).canCreate, false);
});

// acc-1 creates tasks for the first two reasons in a Jira that `jira` (created, deleted) shares.
async function withTwoTasks(jira) {
  const kvs = fakeKvs();
  const panel = await panelFor(jira, { kvs, accountId: 'acc-1' });
  const fingerprints = allReasons(panel).slice(0, 2).map((r) => r.fingerprint);
  const deps = { port: portOf(fakeSenders(jira).senders), kvs, now: () => NOW, deadline: Infinity };
  await createTasksAction({ deps, epicKey: EPIC, accountId: 'acc-1', fingerprints });
  return { kvs, fingerprints };
}

test('created tasks come back by fingerprint', async () => {
  const jira = { created: [], deleted: [] };
  const { kvs, fingerprints } = await withTwoTasks(jira);
  const panel = await getPanelData({ deps: { port: portOf(fakeSenders(jira).senders), kvs, now: () => NOW }, epicKey: EPIC, accountId: 'acc-2' });
  assert.deepEqual(Object.keys(panel.tasks).sort(), [...fingerprints].sort());
  assert.deepEqual(fingerprints.map((fp) => panel.tasks[fp].key), ['CHK-901', 'CHK-902']);
  assert.ok(fingerprints.every((fp) => panel.tasks[fp].url.endsWith(`/browse/${panel.tasks[fp].key}`)));
});

test('a deleted task is no longer offered', async () => {
  const jira = { created: [], deleted: [] };
  const { kvs, fingerprints } = await withTwoTasks(jira);
  jira.deleted.push('CHK-901');
  const panel = await getPanelData({ deps: { port: portOf(fakeSenders(jira).senders), kvs, now: () => NOW }, epicKey: EPIC, accountId: 'acc-1' });
  assert.deepEqual(Object.keys(panel.tasks), [fingerprints[1]]);
});

// view.refresh() may remount the panel; its creator gets the results back for a few minutes.
test('the last results come back to their creator for 5 minutes', async () => {
  const jira = { created: [], deleted: [] };
  const { kvs } = await withTwoTasks(jira);
  const read = (accountId, now) => getPanelData({ deps: { port: portOf(fakeSenders(jira).senders), kvs, now: () => now }, epicKey: EPIC, accountId });
  assert.deepEqual((await read('acc-1', NOW + 60000)).taskResults.map((r) => r.key), ['CHK-901', 'CHK-902']);
  assert.equal((await read('acc-2', NOW + 60000)).taskResults, null);
  assert.equal((await read('acc-1', NOW + 301000)).taskResults, null);
});
