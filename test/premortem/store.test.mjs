// Forge KVS storage (story 003 AC 4, 6), keyed by the epic's issue ID: the run status (24-hour
// expiry) and the latest pre-mortem (the pack and the report as one value, kept until the next run).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readActions, readAgentRequest, readPage, readPremortem, readRunStatus, releaseTasksLock, takeTasksLock, writeActions,
  writeAgentRequest, writePage, writePremortem, writeRunStatus,
} from '../../src/premortem/store.js';
import { fakeKvs as policyKvs } from './fakes.mjs';

const fakeKvs = () => {
  const data = new Map();
  return {
    data,
    get: async (key) => data.get(key)?.value,
    set: async (key, value, options) => { data.set(key, { value, options }); },
  };
};

test('the run status is one key per epic with a 24-hour expiry', async () => {
  const kvs = fakeKvs();
  await writeRunStatus(kvs, '10001', { runId: 'r1', status: 'queued' });
  await writeRunStatus(kvs, '10001', { runId: 'r1', status: 'running' });
  assert.deepEqual([...kvs.data.keys()], ['run:10001']);
  assert.deepEqual(kvs.data.get('run:10001').options, { ttl: { unit: 'HOURS', value: 24 } });
  assert.deepEqual(await readRunStatus(kvs, '10001'), { runId: 'r1', status: 'running' });
  assert.equal(await readRunStatus(kvs, '10002'), null);
});

// Not entity properties: Jira lets anyone who can browse the epic read and edit those.
test('the pack and the report are stored together under one key per epic, without expiry', async () => {
  const kvs = fakeKvs();
  assert.equal(await readPremortem(kvs, '10001'), null);
  await writePremortem(kvs, '10001', { pack: { packId: 'p1' }, report: { packId: 'p1' } });
  assert.deepEqual([...kvs.data.keys()], ['premortem:10001']);
  assert.equal(kvs.data.get('premortem:10001').options, undefined);
  assert.deepEqual(await readPremortem(kvs, '10001'), { pack: { packId: 'p1' }, report: { packId: 'p1' } });
});

// Opening Rovo remounts the Jira panel, so "waiting for the agent" must outlive the panel's state.
test('an agent request is remembered per epic and user for 5 minutes', async () => {
  const kvs = fakeKvs();
  assert.equal(await readAgentRequest(kvs, '10001', 'acc-1'), null);
  await writeAgentRequest(kvs, '10001', 'acc-1', { savedBefore: null, requestedAt: '2026-11-02T08:00:00.000Z' });
  assert.deepEqual([...kvs.data.keys()], ['agent:10001:acc-1']);
  assert.deepEqual(kvs.data.get('agent:10001:acc-1').options, { ttl: { unit: 'MINUTES', value: 5 } });
  assert.deepEqual(await readAgentRequest(kvs, '10001', 'acc-1'), { savedBefore: null, requestedAt: '2026-11-02T08:00:00.000Z' });
  assert.equal(await readAgentRequest(kvs, '10001', 'acc-2'), null);
});

// Story 006 AC 10: reason → task, in KVS rather than on the epic, kept until the epic's next change.
test('the tasks map is one key per epic, without expiry', async () => {
  const kvs = fakeKvs();
  assert.deepEqual(await readActions(kvs, '10001'), { tasks: {}, lastBatch: null });
  const actions = { tasks: { 'rule:x|': { id: '1', key: 'CHK-1', asChild: true, createdAt: 't', createdBy: 'acc-1' } }, lastBatch: null };
  await writeActions(kvs, '10001', actions);
  assert.deepEqual([...kvs.data.keys()], ['actions:10001']);
  assert.equal(kvs.data.get('actions:10001').options, undefined);
  assert.deepEqual(await readActions(kvs, '10001'), actions);
});

// Story 007 AC 11: the epic's Confluence page, in its own key so a task batch never overwrites it.
test('the page record is one key per epic, without expiry', async () => {
  const kvs = fakeKvs();
  assert.equal(await readPage(kvs, '10001'), null);
  const page = { id: '7001', spaceId: '102', spaceName: 'Alpha', title: 'Pre-mortem: Checkout (CHK-12)', url: 'https://x/wiki/p', by: 'acc-1', at: 't' };
  await writePage(kvs, '10001', page);
  assert.deepEqual([...kvs.data.keys()], ['page:10001']);
  assert.equal(kvs.data.get('page:10001').options, undefined);
  assert.deepEqual(await readPage(kvs, '10001'), page);
});

// Story 006 AC 4: a second create on the same epic is refused while one runs.
test('the tasks lock', async () => {
  const kvs = policyKvs();
  assert.equal(await takeTasksLock(kvs, '10001', 1000), true);
  assert.deepEqual(kvs.data.get('tasks-lock:10001'), { value: { at: 1000 }, options: { keyPolicy: 'FAIL_IF_EXISTS', ttl: { unit: 'SECONDS', value: 60 } } });
  assert.equal(await takeTasksLock(kvs, '10001', 2000), false);
  assert.equal(await takeTasksLock(kvs, '10002', 2000), true, 'another epic has its own lock');
  await releaseTasksLock(kvs, '10001');
  assert.equal(await takeTasksLock(kvs, '10001', 3000), true);
  assert.equal(await takeTasksLock(kvs, '10001', 62999), false, 'under 60 s old');
  assert.equal(await takeTasksLock(kvs, '10001', 63000), true, '60 s old: taken over');
  assert.equal(kvs.data.get('tasks-lock:10001').value.at, 63000);
});

test('a failing lock write is not mistaken for a held lock', async () => {
  const kvs = policyKvs({ failSet: () => true });
  await assert.rejects(takeTasksLock(kvs, '10001', 1000), /KVS write failed/);
});
