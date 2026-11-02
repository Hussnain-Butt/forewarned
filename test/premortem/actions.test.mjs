// The Rovo actions (story 003 AC 1, 19–22): start a run, read the stored pack, save a validated
// write-up against the stored pack, read the report.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEvidenceAction, getPremortemAction, runPremortemAction, submitPremortemAction } from '../../src/premortem/actions.js';
import { handleRun } from '../../src/premortem/consumer.js';
import { EVIDENCE_PROPERTY, REPORT_PROPERTY } from '../../src/premortem/store.js';
import { keyOf } from '../engine/seed-snapshot.mjs';
import { fakeKvs, fakeQueue, fakeSenders, portOf } from './fakes.mjs';

const EPIC = keyOf('ll-chk-e11');
const NOW = Date.parse('2026-11-02T08:00:00.000Z');

async function setup({ withRun = true, senderOptions } = {}) {
  const fake = fakeSenders(senderOptions);
  const kvs = fakeKvs();
  const logs = [];
  const deps = { port: portOf(fake.senders), kvs, queue: fakeQueue(kvs), now: () => NOW, newId: () => 'r1', log: (line) => logs.push(line), logs };
  if (withRun) {
    await runPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-1' });
    await handleRun({ event: { body: { runId: 'r1', epicKey: EPIC, accountId: 'acc-1' } }, senders: fake.senders, kvs, now: () => NOW, log: () => {} });
  }
  return { deps, fake };
}
const packOf = (fake) => fake.properties.get(`${EPIC}/${EVIDENCE_PROPERTY}`);
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
  const { deps, fake } = await setup();
  assert.deepEqual(await getEvidenceAction({ deps, epicKey: EPIC }), { epicKey: EPIC, ...packOf(fake) });
});

test('submit-premortem validates against the stored pack and saves only validated fields (AC 19, 21–22)', async () => {
  const { deps, fake } = await setup();
  const pack = packOf(fake);
  const invented = { ...good(pack), title: 'Invented', explanation: 'Epics were 99 days late.' };
  const missing = { ...good(pack), title: 'Missing evidence', evidenceIds: ['E99'] };
  const result = await submitPremortemAction({ deps, epicKey: EPIC, packId: pack.packId, reasonsJson: JSON.stringify([good(pack), invented, missing]) });
  assert.deepEqual(result, {
    saved: true, epicKey: EPIC, savedReasons: 1,
    dropped: [{ title: 'Invented', code: 'unknown-number' }, { title: 'Missing evidence', code: 'no-history-evidence' }],
  });
  const report = fake.properties.get(`${EPIC}/${REPORT_PROPERTY}`);
  assert.deepEqual(Object.keys(report.agent.reasons[0]).sort(), ['evidenceIds', 'explanation', 'likelihood', 'mitigation', 'title']);
  assert.equal(report.agent.reasons[0].likelihood, 'High');
  assert.deepEqual(report.agent.droppedByRule, { 'unknown-number': 1, 'no-history-evidence': 1 });
  assert.equal(report.agent.stale, false);
  assert.ok(report.ruleBased.reasons.length, 'the rule-based part is kept');
  assert.deepEqual(deps.logs, ['Reason dropped: unknown-number', 'Reason dropped: no-history-evidence']);
});

test('submit-premortem refuses a changed pack, a run in progress, no evidence and no surviving reason (AC 19–20)', async () => {
  const { deps, fake } = await setup();
  const pack = packOf(fake);
  assert.deepEqual(await submitPremortemAction({ deps, epicKey: EPIC, packId: 'old', reasonsJson: JSON.stringify([good(pack)]) }),
    { saved: false, error: 'The evidence changed since you read it. Call get-evidence again.' });
  const none = await submitPremortemAction({ deps, epicKey: EPIC, packId: pack.packId, reasonsJson: JSON.stringify([{ ...good(pack), evidenceIds: [] }]) });
  assert.equal(none.saved, false);
  assert.deepEqual(none.dropped, [{ title: 'History says late', code: 'no-history-evidence' }]);
  assert.deepEqual(await submitPremortemAction({ deps, epicKey: EPIC, reasonsJson: '[{' }), { saved: false, error: 'reasonsJson is not valid JSON.' });
  await deps.kvs.set(`run:${EPIC}`, { runId: 'r2', status: 'running', startedAt: new Date(NOW).toISOString() });
  assert.deepEqual(await submitPremortemAction({ deps, epicKey: EPIC, reasonsJson: JSON.stringify([good(pack)]) }),
    { saved: false, error: 'A new evidence run is in progress. Wait a moment, then call get-evidence again.' });
  const empty = await setup({ withRun: false });
  assert.deepEqual(await submitPremortemAction({ deps: empty.deps, epicKey: EPIC, reasonsJson: '[]' }),
    { saved: false, error: `No evidence found for ${EPIC}. Call run-premortem first.` });
});

test('get-premortem returns the version 2 report, or says none is saved yet', async () => {
  const { deps, fake } = await setup();
  assert.deepEqual(await getPremortemAction({ deps, epicKey: EPIC }), { epicKey: EPIC, report: fake.properties.get(`${EPIC}/${REPORT_PROPERTY}`) });
  const empty = await setup({ withRun: false });
  assert.deepEqual(await getPremortemAction({ deps: empty.deps, epicKey: EPIC }), { epicKey: EPIC, report: null, message: `No pre-mortem has been saved on ${EPIC} yet.` });
});

test('a pack and report from different runs (a run that half-saved) are refused', async () => {
  const { deps, fake } = await setup();
  const pack = packOf(fake);
  fake.properties.set(`${EPIC}/${EVIDENCE_PROPERTY}`, { ...pack, packId: 'newer-pack' });
  assert.deepEqual(await submitPremortemAction({ deps, epicKey: EPIC, reasonsJson: JSON.stringify([good(pack)]) }),
    { saved: false, error: "The last run didn't finish saving. Call run-premortem again." });
});

test('someone who can view but not edit the epic gets a clear message when saving', async () => {
  const { deps, fake } = await setup();
  fake.senders.setIssueProperty = async () => new Response(JSON.stringify({ errorMessages: ['Forbidden'] }), { status: 403 });
  deps.port = portOf(fake.senders); // the port wraps the senders it was made with
  const pack = packOf(fake);
  assert.deepEqual(await submitPremortemAction({ deps, epicKey: EPIC, packId: pack.packId, reasonsJson: JSON.stringify([good(pack)]) }),
    { saved: false, error: `You can view ${EPIC} but can't edit it, so the pre-mortem can't be saved.` });
});
