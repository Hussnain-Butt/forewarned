// The queue consumer (story 003 AC 3, 6–8): build, validate and store, step by step, and never
// throw back to the queue.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computePack } from '../../src/engine/pack.js';
import { handleRun } from '../../src/premortem/consumer.js';
import { ruleBasedReasons } from '../../src/premortem/rules.js';
import { keyOf, seedSnapshot } from '../engine/seed-snapshot.mjs';
import { fakeKvs, fakeSenders, idOf, storedOf } from './fakes.mjs';

const EPIC = keyOf('ll-chk-e11');
const EPIC_ID = await idOf(EPIC);
const NOW = Date.parse('2026-11-02T08:00:00.000Z');
const quiet = () => {};

async function run({ epicKey = EPIC, epicId = EPIC_ID, statusRunId = 'r1', eventRunId = 'r1', statusValue = 'queued', principal, senderOptions, failSet, before, now = () => NOW } = {}) {
  const kvs = fakeKvs({ failSet });
  const fake = fakeSenders(senderOptions);
  await kvs.set(`run:${epicId}`, { runId: statusRunId, status: statusValue, step: null, startedAt: new Date(NOW).toISOString(), finishedAt: null, error: null });
  kvs.writes.length = 0;
  await before?.({ kvs, fake });
  const logs = [];
  await handleRun({ event: { body: { runId: eventRunId, epicKey, epicId, accountId: 'acc-1' } }, principal, senders: fake.senders, kvs, now, log: (line) => logs.push(line) });
  return { kvs, fake, logs, status: kvs.data.get(`run:${epicId}`).value };
}

test('a run stores the pack and a version 2 report in KVS, and reports each step (AC 6–7)', async () => {
  const { status, kvs } = await run();
  assert.equal(status.status, 'done');
  assert.equal(status.finishedAt, '2026-11-02T08:00:00.000Z');
  const steps = kvs.writes.filter((w) => w.value.status === 'running').map((w) => w.value.step);
  assert.deepEqual(steps, ['comparable epics', 'past epics', 'scope', 'load', 'dependencies', 'writing']);
  const { pack, report } = storedOf(kvs, EPIC_ID);
  assert.deepEqual(pack.evidence, computePack(seedSnapshot()).evidence);
  assert.equal(report.version, 2);
  assert.equal(report.packId, pack.packId);
  assert.equal(report.status, 'ok');
  assert.equal(report.runBy, 'acc-1');
  assert.deepEqual(report.ruleBased.reasons, ruleBasedReasons(pack));
});

// Later steps keep the count, so a panel that polls after the step, or opens mid-run, still reads
// "Reading 8 past epics" (005 AC 5).
test('the past-epics step carries how many epics are read, and later steps keep it (005 AC 5)', async () => {
  const { kvs } = await run();
  const running = kvs.writes.filter((w) => w.value.status === 'running');
  const at = running.findIndex((w) => w.value.step === 'past epics');
  assert.ok(at > 0);
  assert.ok(running.slice(0, at).every((w) => w.value.count === null));
  assert.ok(running.slice(at).every((w) => w.value.count === 8));
});

test('an event replaced by a newer run does nothing', async () => {
  const { status, kvs } = await run({ statusRunId: 'r2' });
  assert.equal(status.runId, 'r2');
  assert.equal(kvs.writes.length, 0);
});

test('an epic that is no longer an epic fails with a user-safe message (003 edge case)', async () => {
  const story = keyOf('bk-chk-e11-03');
  const { status } = await run({ epicKey: story, epicId: await idOf(story) });
  assert.equal(status.status, 'failed');
  assert.equal(status.error, `${story} is no longer an epic or no longer exists.`);
});

test('a failing write fails the run, logs one line and returns normally (AC 8, Review Focus 4)', async () => {
  const { status, logs } = await run({ failSet: (key) => key.startsWith('premortem:') });
  assert.equal(status.status, 'failed');
  assert.equal(status.error, `Forewarned couldn't save the report on ${EPIC}.`);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^Pre-mortem run r1: failed \(save\), \d+ ms, [1-9]\d* Jira requests, [1-9]\d* evidence items$/);
});

test('any other error fails the run without throwing', async () => {
  const { status, logs } = await run({ before: ({ fake }) => { fake.senders.search = async () => { throw new TypeError('boom'); }; } });
  assert.equal(status.status, 'failed');
  assert.equal(status.error, `Forewarned couldn't build the evidence for ${EPIC}. Try again in a minute.`);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^Pre-mortem run r1: failed \(TypeError\), \d+ ms, [1-9]\d* Jira requests, 0 evidence items$/);
});

test('an agent write-up survives a new run, marked as based on an older pack (AC 6, Review Focus 5)', async () => {
  const agent = { reasons: [], savedAt: '2026-11-01T08:00:00.000Z', packId: 'old-pack', droppedByRule: {}, stale: false };
  const before = ({ kvs }) => kvs.set(`premortem:${EPIC_ID}`, { pack: { packId: 'old-pack' }, report: { version: 2, agent, packId: 'old-pack' } });
  const { kvs } = await run({ before });
  const { report } = storedOf(kvs, EPIC_ID);
  assert.deepEqual(report.agent, { ...agent, stale: true });
});

test('a duplicate delivery of a finished run does nothing', async () => {
  for (const statusValue of ['done', 'failed']) {
    const { kvs } = await run({ statusValue });
    assert.equal(kvs.writes.length, 0);
  }
});

test('an event that arrives while its run already shows "running" was retried after a timeout: it fails', async () => {
  const { status, logs, kvs } = await run({ statusValue: 'running' });
  assert.equal(status.status, 'failed');
  assert.equal(status.error, 'The run took too long. Try again in a minute.');
  assert.deepEqual(logs, ['Pre-mortem run r1: failed (retried), 0 ms, 0 Jira requests, 0 evidence items']);
  assert.equal(storedOf(kvs, EPIC_ID), undefined);
});

test('an event whose principal is another user fails instead of spinning', async () => {
  const { status, kvs } = await run({ principal: 'acc-2' });
  assert.equal(status.status, 'failed');
  assert.equal(status.error, "Forewarned couldn't confirm who started this run. Try again.");
  assert.equal(storedOf(kvs, EPIC_ID), undefined);
  assert.equal((await run({ principal: 'acc-1' })).status.status, 'done');
});

// Story 009 AC 11: errors, plus one line per run with counts only.
test('a run logs exactly one summary line without work item content', async () => {
  let clock = NOW;
  const { logs, kvs } = await run({ now: () => { clock += 10; return clock; } });
  const { pack } = storedOf(kvs, EPIC_ID);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^Pre-mortem run r1: done, [1-9]\d* ms, [1-9]\d* Jira requests, [1-9]\d* evidence items$/);
  assert.ok(logs[0].endsWith(`, ${pack.evidence.length} evidence items`));
  for (const text of [EPIC, EPIC_ID, 'acc-1', pack.epic.summary]) assert.ok(!logs[0].includes(text), `the line names ${text}`);
});

// Story 009 AC 14: Forge retries an event whose handler throws, for up to 24 hours.
test('the consumer never throws, even when KVS fails before the run starts', async () => {
  const kvs = fakeKvs();
  kvs.get = async () => { throw new Error('KVS is down'); };
  const logs = [];
  await handleRun({ event: { body: { runId: 'r1', epicKey: EPIC, epicId: EPIC_ID, accountId: 'acc-1' } }, senders: fakeSenders().senders, kvs, now: () => NOW, log: (line) => logs.push(line) });
  assert.deepEqual(logs, ['Pre-mortem run r1: failed (Error), 0 ms, 0 Jira requests, 0 evidence items']);
});

// The panel tells "the report it shows" from a newer one by this time (story 009 AC 6, plan Task 3).
test("a done status's finishedAt is the saved report's runAt", async () => {
  let clock = NOW;
  const { status, kvs } = await run({ now: () => { clock += 1000; return clock; } });
  assert.equal(status.status, 'done');
  assert.equal(status.finishedAt, storedOf(kvs, EPIC_ID).report.runAt);
});
