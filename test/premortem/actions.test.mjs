// The Rovo actions (story 003 AC 1, 19–22): start a run, read the stored pack, save a validated
// write-up against the stored pack, read the report. Every action first reads the epic as the user.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEvidenceAction, getPremortemAction, runPremortemAction, submitPremortemAction } from '../../src/premortem/actions.js';
import { handleRun } from '../../src/premortem/consumer.js';
import { keyOf } from '../engine/seed-snapshot.mjs';
import { fakeKvs, fakeQueue, fakeSenders, idOf, portOf, storedOf } from './fakes.mjs';

const EPIC = keyOf('ll-chk-e11');
const EPIC_ID = await idOf(EPIC);
const BLOCKER = keyOf('un-plt-e03-07');
const NOW = Date.parse('2026-11-02T08:00:00.000Z');
const NOT_VISIBLE = { error: `${EPIC} doesn't exist, or you don't have permission to see it.` };

async function setup({ withRun = true, senderOptions } = {}) {
  const fake = fakeSenders(senderOptions);
  const kvs = fakeKvs();
  const logs = [];
  const deps = { port: portOf(fake.senders), kvs, queue: fakeQueue(kvs), now: () => NOW, newId: () => 'r1', log: (line) => logs.push(line), logs };
  if (withRun) {
    const builder = fakeSenders();
    await runPremortemAction({ deps: { ...deps, port: portOf(builder.senders) }, epicKey: EPIC, accountId: 'acc-1' });
    await handleRun({ event: { body: { runId: 'r1', epicKey: EPIC, epicId: EPIC_ID, accountId: 'acc-1' } }, senders: builder.senders, kvs, now: () => NOW, log: () => {} });
  }
  return { deps, kvs };
}
const good = (pack) => {
  const slip = pack.evidence.find((e) => e.type === 'slip-base-rate');
  return {
    title: 'History says late',
    likelihood: 'high',
    explanation: slip.fact,
    evidenceIds: [slip.id],
    mitigation: `Plan for ${slip.numbers.medianDaysLate} more days.`,
    chat: 'Here is what I found!',
  };
};

test('run-premortem starts a run, and says so when one is already running', async () => {
  const { deps } = await setup({ withRun: false });
  const first = await runPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-1' });
  assert.equal(first.status, 'started');
  assert.equal(first.runId, 'r1');
  const again = await runPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-1' });
  assert.equal(again.status, 'already-running');
  assert.match(again.message, /already in progress/);
});

test('get-evidence returns the stored pack, or explains why there is none', async () => {
  const empty = await setup({ withRun: false });
  assert.deepEqual(await getEvidenceAction({ deps: empty.deps, epicKey: EPIC }), { error: `No evidence found for ${EPIC}. Call run-premortem first.` });
  await runPremortemAction({ deps: empty.deps, epicKey: EPIC, accountId: 'acc-1' });
  assert.deepEqual(await getEvidenceAction({ deps: empty.deps, epicKey: EPIC }), { error: 'A new evidence run is in progress. Wait a moment, then call get-evidence again.' });
  const { deps, kvs } = await setup();
  assert.deepEqual(await getEvidenceAction({ deps, epicKey: EPIC }), { epicKey: EPIC, ...storedOf(kvs, EPIC_ID).pack });
});

// The agent learns why, instead of "Call run-premortem first", and that it may try again.
test('get-evidence passes on why the last run failed when there is no evidence', async () => {
  const { deps, kvs } = await setup({ withRun: false });
  await kvs.set(`run:${EPIC_ID}`, { runId: 'r1', status: 'failed', startedAt: new Date(NOW).toISOString(), error: `Forewarned couldn't save the report on ${EPIC}.` });
  assert.deepEqual(await getEvidenceAction({ deps, epicKey: EPIC }),
    { error: `The last run failed: Forewarned couldn't save the report on ${EPIC}. Call run-premortem to try again.` });
});

// Someone who can't see the epic learns nothing, not even whether a run is in progress.
test('every action refuses an epic the user can\'t see, before reading anything stored', async () => {
  const { deps } = await setup({ senderOptions: { hidden: [EPIC] } });
  await deps.kvs.set(`run:${EPIC_ID}`, { runId: 'r2', status: 'running', startedAt: new Date(NOW).toISOString() });
  assert.deepEqual(await getEvidenceAction({ deps, epicKey: EPIC }), NOT_VISIBLE);
  assert.deepEqual(await getPremortemAction({ deps, epicKey: EPIC }), NOT_VISIBLE);
  assert.deepEqual(await submitPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-2', reasonsJson: '[]' }), { saved: false, ...NOT_VISIBLE });
});

test('submit-premortem validates against the stored pack and saves only validated fields (AC 19, 21–22)', async () => {
  const { deps, kvs } = await setup();
  const { pack } = storedOf(kvs, EPIC_ID);
  const invented = { ...good(pack), title: 'Invented', explanation: 'Epics were 99 days late.' };
  const missing = { ...good(pack), title: 'Missing evidence', evidenceIds: ['E99'] };
  const result = await submitPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-1', packId: pack.packId, reasonsJson: JSON.stringify([good(pack), invented, missing]) });
  assert.deepEqual(result, {
    saved: true, epicKey: EPIC, savedReasons: 1,
    dropped: [{ title: 'Invented', code: 'unknown-number' }, { title: 'Missing evidence', code: 'no-history-evidence' }],
  });
  const { report, pack: kept } = storedOf(kvs, EPIC_ID);
  assert.deepEqual(kept, pack, 'the pack is stored again unchanged');
  assert.deepEqual(Object.keys(report.agent.reasons[0]).sort(), ['evidenceIds', 'explanation', 'likelihood', 'mitigation', 'title']);
  assert.equal(report.agent.reasons[0].likelihood, 'High');
  assert.deepEqual(report.agent.droppedByRule, { 'unknown-number': 1, 'no-history-evidence': 1 });
  assert.equal(report.agent.stale, false);
  assert.equal(report.agent.savedBy, 'acc-1');
  assert.ok(report.ruleBased.reasons.length, 'the rule-based part is kept');
  assert.deepEqual(deps.logs, ['Reason dropped: unknown-number', 'Reason dropped: no-history-evidence']);
});

test('submit-premortem refuses a changed pack, a run in progress, no evidence and no surviving reason (AC 19–20)', async () => {
  const { deps, kvs } = await setup();
  const { pack } = storedOf(kvs, EPIC_ID);
  const submit = (fields) => submitPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-1', ...fields });
  assert.deepEqual(await submit({ packId: 'old', reasonsJson: JSON.stringify([good(pack)]) }),
    { saved: false, error: 'The evidence changed since you read it. Call get-evidence again.' });
  const none = await submit({ packId: pack.packId, reasonsJson: JSON.stringify([{ ...good(pack), evidenceIds: [] }]) });
  assert.equal(none.saved, false);
  assert.deepEqual(none.dropped, [{ title: 'History says late', code: 'no-history-evidence' }]);
  assert.deepEqual(await submit({ reasonsJson: '[{' }), { saved: false, error: 'reasonsJson is not valid JSON.' });
  await deps.kvs.set(`run:${EPIC_ID}`, { runId: 'r2', status: 'running', startedAt: new Date(NOW).toISOString() });
  assert.deepEqual(await submit({ reasonsJson: JSON.stringify([good(pack)]) }),
    { saved: false, error: 'A new evidence run is in progress. Wait a moment, then call get-evidence again.' });
  const empty = await setup({ withRun: false });
  assert.deepEqual(await submitPremortemAction({ deps: empty.deps, epicKey: EPIC, accountId: 'acc-1', reasonsJson: '[]' }),
    { saved: false, error: `No evidence found for ${EPIC}. Call run-premortem first.` });
});

// Jira no longer guards the write (the report isn't on the epic), so the action checks itself.
test('someone who can view but not edit the epic can\'t save, and nothing changes', async () => {
  const { deps, kvs } = await setup({ senderOptions: { canEdit: false } });
  const before = storedOf(kvs, EPIC_ID);
  assert.deepEqual(await submitPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-2', packId: before.pack.packId, reasonsJson: JSON.stringify([good(before.pack)]) }),
    { saved: false, error: `You can view ${EPIC} but can't edit it, so the pre-mortem can't be saved.` });
  assert.deepEqual(storedOf(kvs, EPIC_ID), before);
});

// The drop codes would otherwise tell a reader which numbers and keys hidden evidence holds.
test('submit-premortem checks the reasons against the evidence the submitter can see', async () => {
  const { deps, kvs } = await setup({ senderOptions: { hidden: [BLOCKER] } });
  const { pack } = storedOf(kvs, EPIC_ID);
  const blocker = pack.evidence.find((e) => e.type === 'open-blocker');
  const result = await submitPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-2', packId: pack.packId,
    reasonsJson: JSON.stringify([good(pack), { title: 'Blocked', likelihood: 'Medium', explanation: blocker.fact, evidenceIds: [blocker.id], mitigation: 'Chase it.' }]) });
  assert.deepEqual(result.dropped, [{ title: 'Blocked', code: 'no-history-evidence' }]);
});

test('get-premortem returns the version 2 report, or says none is saved yet', async () => {
  const { deps, kvs } = await setup();
  assert.deepEqual(await getPremortemAction({ deps, epicKey: EPIC }), { epicKey: EPIC, report: storedOf(kvs, EPIC_ID).report });
  const empty = await setup({ withRun: false });
  assert.deepEqual(await getPremortemAction({ deps: empty.deps, epicKey: EPIC }), { epicKey: EPIC, report: null, message: `No pre-mortem has been saved on ${EPIC} yet.` });
});
