// Run status in Forge KVS (story 003 AC 4): one key per epic, 24-hour expiry.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRunStatus, writeRunStatus } from '../../src/premortem/store.js';

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
  await writeRunStatus(kvs, 'CHK-12', { runId: 'r1', status: 'queued' });
  await writeRunStatus(kvs, 'CHK-12', { runId: 'r1', status: 'running' });
  assert.deepEqual([...kvs.data.keys()], ['run:CHK-12']);
  assert.deepEqual(kvs.data.get('run:CHK-12').options, { ttl: { unit: 'HOURS', value: 24 } });
  assert.deepEqual(await readRunStatus(kvs, 'CHK-12'), { runId: 'r1', status: 'running' });
  assert.equal(await readRunStatus(kvs, 'CHK-13'), null);
});
