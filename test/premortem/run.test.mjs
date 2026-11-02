// Starting a run (story 003 AC 1–2) and the entity property store.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readProperty, writeProperty } from '../../src/premortem/store.js';
import { startRun } from '../../src/premortem/run.js';
import { keyOf } from '../engine/seed-snapshot.mjs';
import { fakeKvs, fakeQueue, fakeSenders, portOf } from './fakes.mjs';

const EPIC = keyOf('ll-chk-e11');
const NOW = Date.parse('2026-11-02T08:00:00.000Z');
const setup = (options) => {
  const { senders } = fakeSenders(options);
  const kvs = fakeKvs();
  return { port: portOf(senders), kvs, queue: fakeQueue(kvs) };
};
const start = (deps, epicKey = EPIC, now = NOW) => startRun({ ...deps, epicKey, accountId: 'acc-1', now: () => now, newId: () => 'run-new' });

test('a run writes "queued" first, then pushes one event with the run, the epic and the user', async () => {
  const deps = setup();
  assert.deepEqual(await start(deps), { runId: 'run-new', status: 'started' });
  assert.equal(deps.queue.pushes.length, 1);
  const { event, kvsAtPush } = deps.queue.pushes[0];
  assert.deepEqual(event, { body: { runId: 'run-new', epicKey: EPIC, accountId: 'acc-1' }, concurrency: { key: `run:${EPIC}`, limit: 1 } });
  assert.equal(new Map(kvsAtPush).get(`run:${EPIC}`).value.status, 'queued');
});

test('only epics, only existing ones, only for people who can edit them (AC 1)', async () => {
  assert.deepEqual(await start(setup(), keyOf('bk-chk-e11-03')), { error: `${keyOf('bk-chk-e11-03')} is not an epic. Forewarned runs pre-mortems on epics only.` });
  assert.deepEqual(await start(setup(), 'CHK-99999'), { error: "CHK-99999 doesn't exist, or you don't have permission to see it." });
  assert.deepEqual(await start(setup({ canEdit: false })), { error: `You can view ${EPIC} but can't edit it, so Forewarned can't save a pre-mortem on it.` });
  assert.deepEqual(await start(setup(), 'not a key'), { error: 'No valid epic key was given.' });
});

test('one run per epic: a queued or running run is returned, nothing is pushed (AC 2)', async () => {
  for (const status of ['queued', 'running']) {
    const deps = setup();
    await deps.kvs.set(`run:${EPIC}`, { runId: 'run-old', status, startedAt: new Date(NOW - 60000).toISOString() });
    assert.deepEqual(await start(deps), { runId: 'run-old', status: 'already-running' });
    assert.equal(deps.queue.pushes.length, 0);
  }
});

test('a run stuck for over 10 minutes, or a finished one, does not block a new run', async () => {
  for (const status of [{ status: 'running', startedAt: new Date(NOW - 11 * 60000).toISOString() }, { status: 'done' }, { status: 'failed' }]) {
    const deps = setup();
    await deps.kvs.set(`run:${EPIC}`, { runId: 'run-old', ...status });
    assert.equal((await start(deps)).status, 'started');
    assert.equal(deps.queue.pushes.length, 1);
  }
});

test('entity properties: read gives null when missing, write stores the value', async () => {
  const { senders, properties } = fakeSenders();
  const port = portOf(senders);
  assert.equal(await readProperty(port, EPIC, 'forewarned-evidence'), null);
  await writeProperty(port, EPIC, 'forewarned-evidence', { packId: 'p1' });
  assert.deepEqual(properties.get(`${EPIC}/forewarned-evidence`), { packId: 'p1' });
  assert.deepEqual(await readProperty(port, EPIC, 'forewarned-evidence'), { packId: 'p1' });
});
