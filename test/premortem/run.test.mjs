// Starting a run (story 003 AC 1–2), with the daily cap and the 24-hour cache (story 009 AC 1–7).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_DAILY_RUN_CAP, dailyRunCap, startRun } from '../../src/premortem/run.js';
import { keyOf } from '../engine/seed-snapshot.mjs';
import { fakeKvs, fakeQueue, fakeSenders, idOf, isChangeQuery, portOf } from './fakes.mjs';

const EPIC = keyOf('ll-chk-e11');
const EPIC_ID = await idOf(EPIC);
const NOW = Date.parse('2026-11-02T08:00:00.000Z');
const HOUR = 3600000;
const TODAY = 'runs:2026-11-02';
const iso = (ms) => new Date(ms).toISOString();
const setup = (options) => {
  const { senders, log } = fakeSenders(options);
  const kvs = fakeKvs();
  return { port: portOf(senders), kvs, queue: fakeQueue(kvs), log };
};
const start = (deps, epicKey = EPIC, now = NOW, extra = {}) => startRun({
  ...deps, epicKey, accountId: 'acc-1', now: () => now, newId: () => 'run-new', cap: 15, ...extra,
});
// A finished run of the epic that started at `startedMs` and took 30 s.
const lastRun = (deps, startedMs, fields = {}) => deps.kvs.set(`run:${EPIC_ID}`, {
  runId: 'run-old', status: 'done', step: null, startedAt: iso(startedMs), finishedAt: iso(startedMs + 30000), error: null, ...fields,
});
const changeQueries = (deps, from) => deps.log.slice(from).filter(isChangeQuery);
const runsToday = (deps) => deps.kvs.data.get(TODAY)?.value;

test('a run writes "queued" first, then pushes one event with the run, the epic and the user', async () => {
  const deps = setup();
  assert.deepEqual(await start(deps), { runId: 'run-new', status: 'started' });
  assert.equal(deps.queue.pushes.length, 1);
  const { event, kvsAtPush } = deps.queue.pushes[0];
  assert.deepEqual(event, { body: { runId: 'run-new', epicKey: EPIC, epicId: EPIC_ID, accountId: 'acc-1' }, concurrency: { key: `run-${EPIC_ID}`, limit: 1 } });
  assert.equal(new Map(kvsAtPush).get(`run:${EPIC_ID}`).value.status, 'queued');
});

test('only epics, only existing ones, only for people who can edit them (AC 1)', async () => {
  assert.deepEqual(await start(setup(), keyOf('bk-chk-e11-03')), { error: `${keyOf('bk-chk-e11-03')} is not an epic. Forewarned runs pre-mortems on epics only.` });
  assert.deepEqual(await start(setup(), 'CHK-99999'), { error: "CHK-99999 doesn't exist, or you don't have permission to see it." });
  assert.deepEqual(await start(setup({ canEdit: false })), { error: `You can view ${EPIC} but can't edit it, so Forewarned can't save a pre-mortem on it.` });
  assert.deepEqual(await start(setup(), 'not a key'), { error: 'No valid epic key was given.' });
  const deps = setup();
  assert.deepEqual(await startRun({ ...deps, epicKey: EPIC, accountId: undefined, now: () => NOW, newId: () => 'r' }),
    { error: "Forewarned couldn't tell who is asking, so it can't start a run." });
});

test('one run per epic: a queued or running run is returned, nothing is pushed (AC 2)', async () => {
  for (const status of ['queued', 'running']) {
    const deps = setup();
    await deps.kvs.set(`run:${EPIC_ID}`, { runId: 'run-old', status, startedAt: new Date(NOW - 60000).toISOString() });
    assert.deepEqual(await start(deps), { runId: 'run-old', status: 'already-running' });
    assert.equal(deps.queue.pushes.length, 0);
  }
});

test('a run stuck for over 10 minutes, or a finished one, does not block a new run', async () => {
  for (const status of [{ status: 'running', startedAt: new Date(NOW - 11 * 60000).toISOString() }, { status: 'done' }, { status: 'failed' }]) {
    const deps = setup();
    await deps.kvs.set(`run:${EPIC_ID}`, { runId: 'run-old', ...status });
    assert.equal((await start(deps)).status, 'started');
    assert.equal(deps.queue.pushes.length, 1);
  }
});

test('a failed queue push leaves a "failed" status, not a stuck "queued" one', async () => {
  const deps = setup();
  deps.queue.push = async () => { throw new Error('Too many requests.'); };
  await assert.rejects(start(deps), /Too many requests/);
  const status = deps.kvs.data.get(`run:${EPIC_ID}`).value;
  assert.equal(status.status, 'failed');
  assert.equal(status.error, "Forewarned couldn't start the run. Try again in a minute.");
  deps.queue.push = async () => ({ jobId: 'j' });
  assert.equal((await start(deps)).status, 'started');
});

test('the 16th run of the UTC day is refused before anything is written or pushed (story 009 AC 1, 4)', async () => {
  const deps = setup();
  await deps.kvs.set(TODAY, 15);
  const writes = deps.kvs.writes.length;
  assert.deepEqual(await start(deps), { status: 'capped', cap: 15, resetsAt: '2026-11-03T00:00:00.000Z' });
  assert.equal(deps.queue.pushes.length, 0);
  assert.equal(deps.kvs.writes.length, writes);
});

test('each started run counts once for its UTC day, kept 48 hours (story 009 AC 1, 3)', async () => {
  const deps = setup();
  assert.equal((await start(deps)).status, 'started');
  assert.deepEqual(deps.kvs.data.get(TODAY), { value: 1, options: { ttl: { unit: 'HOURS', value: 48 } } });
  assert.equal(new Map(deps.queue.pushes[0].kvsAtPush).get(TODAY).value, 1);
  await deps.kvs.set(`run:${EPIC_ID}`, { runId: 'run-new', status: 'failed', startedAt: iso(NOW), finishedAt: iso(NOW) });
  assert.equal((await start(deps)).status, 'started');
  assert.equal(runsToday(deps), 2);
});

test("already-running, cached and refused starts don't count (story 009 AC 2)", async () => {
  const running = setup();
  await running.kvs.set(TODAY, 4);
  await running.kvs.set(`run:${EPIC_ID}`, { runId: 'run-old', status: 'running', startedAt: iso(NOW - 60000) });
  assert.equal((await start(running)).status, 'already-running');
  assert.equal(runsToday(running), 4);

  const cached = setup();
  await cached.kvs.set(TODAY, 4);
  await lastRun(cached, NOW - 2 * HOUR);
  assert.equal((await start(cached)).status, 'cached');
  assert.equal(runsToday(cached), 4);

  const viewer = setup({ canEdit: false });
  assert.ok((await start(viewer)).error);
  assert.equal(runsToday(viewer), undefined);

  const capped = setup();
  await capped.kvs.set(TODAY, 15);
  assert.equal((await start(capped)).status, 'capped');
  assert.equal(runsToday(capped), 15);
});

test('cap 0 refuses every run, cached answers still work (story 009 AC 5)', async () => {
  const deps = setup();
  assert.deepEqual(await start(deps, EPIC, NOW, { cap: 0 }), { status: 'capped', cap: 0, resetsAt: '2026-11-03T00:00:00.000Z' });
  await lastRun(deps, NOW - HOUR);
  assert.equal((await start(deps, EPIC, NOW, { cap: 0 })).status, 'cached');
  assert.equal((await start(deps, EPIC, NOW, { cap: 0, force: true })).status, 'capped');
  assert.equal(deps.queue.pushes.length, 0);
});

test('an unchanged epic within 24 hours gets its last run back: one count query, no job, no count (story 009 AC 6)', async () => {
  const deps = setup();
  await lastRun(deps, NOW - 2 * HOUR);
  const from = deps.log.length;
  assert.deepEqual(await start(deps), { status: 'cached', runAt: iso(NOW - 2 * HOUR + 30000) });
  assert.deepEqual(deps.log.slice(from), [`(issue = ${EPIC_ID} OR parent = ${EPIC_ID}) AND updated >= "-121m"`]);
  assert.equal(deps.queue.pushes.length, 0);
  assert.equal(runsToday(deps), undefined);
});

test('a change, a pack 24 hours old, a failed last run, or force all start a run (story 009 AC 6, 7)', async () => {
  const changed = setup({ changes: 1 });
  await lastRun(changed, NOW - 2 * HOUR);
  assert.equal((await start(changed)).status, 'started');

  // KVS may return a status for up to 48 hours after its 24-hour expiry, so the age is checked.
  for (const age of [24 * HOUR, 25 * HOUR]) {
    const old = setup();
    await lastRun(old, NOW - age);
    const from = old.log.length;
    assert.equal((await start(old)).status, 'started');
    assert.deepEqual(changeQueries(old, from), []);
  }

  const failed = setup();
  await lastRun(failed, NOW - HOUR, { status: 'failed' });
  assert.equal((await start(failed)).status, 'started');

  const forced = setup();
  await lastRun(forced, NOW - HOUR);
  const from = forced.log.length;
  assert.equal((await start(forced, EPIC, NOW, { force: true })).status, 'started');
  assert.deepEqual(changeQueries(forced, from), []);
  assert.equal(runsToday(forced), 1);
});

test('a run counts for the UTC day it starts', async () => {
  const late = Date.parse('2026-11-02T23:59:59.999Z');
  const deps = setup();
  assert.equal((await start(deps, EPIC, late)).status, 'started');
  assert.equal(runsToday(deps), 1);

  const capped = setup();
  await capped.kvs.set(TODAY, 15);
  assert.deepEqual(await start(capped, EPIC, late), { status: 'capped', cap: 15, resetsAt: '2026-11-03T00:00:00.000Z' });
  assert.equal((await start(capped, EPIC, late + 1)).status, 'started');
  assert.equal(capped.kvs.data.get('runs:2026-11-03').value, 1);
});

// The panel's onClick passes the click event; only a real `true` skips the cache (plan Review Focus 1).
test('startRun only bypasses the cache when force is exactly true', async () => {
  for (const force of [{}, 'true', 1]) {
    const deps = setup();
    await lastRun(deps, NOW - HOUR);
    assert.equal((await start(deps, EPIC, NOW, { force })).status, 'cached');
  }
});

test('dailyRunCap reads FW_DAILY_RUN_CAP: a whole number, else 15 with one error line (story 009 AC 5)', () => {
  const lines = [];
  const logError = (...args) => lines.push(args.join(' '));
  assert.equal(DEFAULT_DAILY_RUN_CAP, 15);
  for (const [value, cap] of [[undefined, 15], ['', 15], ['0', 0], ['3', 3], [' 3 ', 3]]) assert.equal(dailyRunCap(value, logError), cap);
  assert.deepEqual(lines, []);
  for (const value of ['abc', '-1', '2.5', '1e3']) {
    lines.length = 0;
    assert.equal(dailyRunCap(value, logError), 15);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /FW_DAILY_RUN_CAP/);
    assert.ok(!lines[0].includes(value), `the error line repeats ${value}`);
  }
});
