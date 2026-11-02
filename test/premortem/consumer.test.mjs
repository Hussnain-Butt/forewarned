// The queue consumer (story 003 AC 3, 6–8): build, validate and store, step by step, and never
// throw back to the queue.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computePack } from '../../src/engine/pack.js';
import { handleRun } from '../../src/premortem/consumer.js';
import { ruleBasedReasons } from '../../src/premortem/rules.js';
import { EVIDENCE_PROPERTY, REPORT_PROPERTY } from '../../src/premortem/store.js';
import { keyOf, seedSnapshot } from '../engine/seed-snapshot.mjs';
import { fakeKvs, fakeSenders } from './fakes.mjs';

const EPIC = keyOf('ll-chk-e11');
const NOW = Date.parse('2026-11-02T08:00:00.000Z');
const quiet = () => {};

async function run({ epicKey = EPIC, statusRunId = 'r1', eventRunId = 'r1', senderOptions, before } = {}) {
  const kvs = fakeKvs();
  const fake = fakeSenders(senderOptions);
  await kvs.set(`run:${epicKey}`, { runId: statusRunId, status: 'queued', step: null, startedAt: new Date(NOW).toISOString(), finishedAt: null, error: null });
  kvs.writes.length = 0;
  await before?.(fake);
  const logs = [];
  await handleRun({ event: { body: { runId: eventRunId, epicKey, accountId: 'acc-1' } }, senders: fake.senders, kvs, now: () => NOW, log: (line) => logs.push(line) });
  return { kvs, fake, logs, status: kvs.data.get(`run:${epicKey}`).value };
}

test('a run stores the pack and a version 2 report, and reports each step (AC 6–7)', async () => {
  const { status, kvs, fake } = await run();
  assert.equal(status.status, 'done');
  assert.equal(status.finishedAt, '2026-11-02T08:00:00.000Z');
  const steps = kvs.writes.filter((w) => w.value.status === 'running').map((w) => w.value.step);
  assert.deepEqual(steps, ['comparable epics', 'past epics', 'scope', 'load', 'dependencies', 'writing']);
  const pack = fake.properties.get(`${EPIC}/${EVIDENCE_PROPERTY}`);
  const report = fake.properties.get(`${EPIC}/${REPORT_PROPERTY}`);
  assert.deepEqual(pack.evidence, computePack(seedSnapshot()).evidence);
  assert.equal(report.version, 2);
  assert.equal(report.packId, pack.packId);
  assert.equal(report.status, 'ok');
  assert.equal(report.runBy, 'acc-1');
  assert.deepEqual(report.ruleBased.reasons, ruleBasedReasons(pack));
});

test('an event replaced by a newer run does nothing', async () => {
  const { status, kvs, fake } = await run({ statusRunId: 'r2' });
  assert.equal(status.runId, 'r2');
  assert.equal(kvs.writes.length, 0);
  assert.equal(fake.properties.size, 0);
});

test('an epic that is no longer an epic fails with a user-safe message (003 edge case)', async () => {
  const story = keyOf('bk-chk-e11-03');
  const { status } = await run({ epicKey: story });
  assert.equal(status.status, 'failed');
  assert.equal(status.error, `${story} is no longer an epic or no longer exists.`);
});

test('a failing property write fails the run, logs one line and returns normally (AC 8, Review Focus 4)', async () => {
  const { status, logs } = await run({ senderOptions: { failWrite: true } });
  assert.equal(status.status, 'failed');
  assert.equal(status.error, `Forewarned couldn't save the report on ${EPIC}.`);
  assert.deepEqual(logs, ['Pre-mortem run failed: save']);
});

test('any other error fails the run without throwing', async () => {
  const { status, logs } = await run({ before: (fake) => { fake.senders.search = async () => { throw new TypeError('boom'); }; } });
  assert.equal(status.status, 'failed');
  assert.equal(status.error, `Forewarned couldn't build the evidence for ${EPIC}. Try again in a minute.`);
  assert.deepEqual(logs, ['Pre-mortem run failed: TypeError']);
});

test('an agent write-up survives a new run, marked as based on an older pack (AC 6, Review Focus 5)', async () => {
  const agent = { reasons: [], savedAt: '2026-11-01T08:00:00.000Z', packId: 'old-pack', droppedByRule: {}, stale: false };
  const before = (fake) => { fake.properties.set(`${EPIC}/${REPORT_PROPERTY}`, { version: 2, agent, packId: 'old-pack' }); };
  const { fake } = await run({ before });
  const report = fake.properties.get(`${EPIC}/${REPORT_PROPERTY}`);
  assert.deepEqual(report.agent, { ...agent, stale: true });
});
