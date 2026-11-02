// Forge KVS storage (story 003 AC 4, 6), keyed by the epic's issue ID: the run status (24-hour
// expiry) and the latest pre-mortem (the pack and the report as one value, kept until the next run).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPremortem, readRunStatus, writePremortem, writeRunStatus } from '../../src/premortem/store.js';

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
