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

// The clock moves only when an action sleeps; `clock.onSleep` runs after each sleep, so a test can
// finish or fail a run while get-evidence waits.
async function setup({ withRun = true, senderOptions } = {}) {
  const fake = fakeSenders(senderOptions);
  const kvs = fakeKvs();
  const logs = [];
  const clock = { now: NOW, slept: 0, onSleep: null };
  const sleep = async (ms) => {
    clock.now += ms;
    clock.slept += ms;
    await clock.onSleep?.();
  };
  const deps = { port: portOf(fake.senders), kvs, queue: fakeQueue(kvs), now: () => clock.now, sleep, newId: () => 'r1', log: (line) => logs.push(line), logs, clock };
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
  assert.equal(first.message, `Forewarned started building the evidence for ${EPIC}. Call get-evidence now; it waits up to 40 seconds for the run.`);
  const again = await runPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-1' });
  assert.equal(again.status, 'already-running');
  assert.equal(again.message, `A run for ${EPIC} is already in progress. Call get-evidence now; it waits up to 40 seconds for the run.`);
});

const HEADLINE = "It's 14 Dec 2026, and Checkout v2 launch has failed. Here's why.";
const STILL_RUNNING = { epicKey: EPIC, status: 'running', message: 'Still running. Ask me to continue in a moment.' };

test('get-evidence returns the stored pack, or explains why there is none', async () => {
  const empty = await setup({ withRun: false });
  assert.deepEqual(await getEvidenceAction({ deps: empty.deps, epicKey: EPIC }), { error: `No evidence found for ${EPIC}. Call run-premortem first.` });
  await runPremortemAction({ deps: empty.deps, epicKey: EPIC, accountId: 'acc-1' });
  assert.deepEqual(await getEvidenceAction({ deps: empty.deps, epicKey: EPIC }), STILL_RUNNING);
  const { deps, kvs } = await setup();
  assert.deepEqual(await getEvidenceAction({ deps, epicKey: EPIC }), { epicKey: EPIC, headline: HEADLINE, ...storedOf(kvs, EPIC_ID).pack });
});

// Story 008 AC 4, 7: "Run a pre-mortem on ‹KEY›" works in one turn from chat.
test('get-evidence waits for a run in progress and returns the new pack', async () => {
  const { deps, kvs } = await setup({ withRun: false });
  await runPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-1' });
  deps.clock.onSleep = () => handleRun({ event: { body: { runId: 'r1', epicKey: EPIC, epicId: EPIC_ID, accountId: 'acc-1' } }, senders: fakeSenders().senders, kvs, now: () => NOW, log: () => {} });
  const result = await getEvidenceAction({ deps, epicKey: EPIC });
  assert.equal(result.packId, storedOf(kvs, EPIC_ID).pack.packId);
  assert.equal(result.headline, HEADLINE);
  assert.equal(deps.clock.slept, 2000);
});

test('get-evidence stops waiting after 40 seconds', async () => {
  const { deps, kvs } = await setup();
  await kvs.set(`run:${EPIC_ID}`, { runId: 'r2', status: 'running', startedAt: new Date(NOW).toISOString() });
  assert.deepEqual(await getEvidenceAction({ deps, epicKey: EPIC }), STILL_RUNNING);
  assert.ok(deps.clock.slept <= 40000 && deps.clock.slept >= 38000, `slept ${deps.clock.slept} ms`);
});

// Review Focus 1: the user asked for a new run, so older evidence would answer the wrong question.
test('a run that fails while get-evidence waits is reported, not hidden behind the older evidence', async () => {
  const { deps, kvs } = await setup();
  const startedAt = new Date(NOW).toISOString();
  await kvs.set(`run:${EPIC_ID}`, { runId: 'r2', status: 'running', startedAt });
  deps.clock.onSleep = () => kvs.set(`run:${EPIC_ID}`, { runId: 'r2', status: 'failed', startedAt, error: 'Jira is busy right now (status 503). Try again in a minute.' });
  assert.deepEqual(await getEvidenceAction({ deps, epicKey: EPIC }),
    { error: 'The last run failed: Jira is busy right now (status 503). Try again in a minute. Ask the user whether to run it again.' });
});

test('get-evidence gives the panel\'s headline, and says when launch day is imagined', async () => {
  const { deps, kvs } = await setup();
  const withDue = await getEvidenceAction({ deps, epicKey: EPIC });
  assert.equal(withDue.headline, HEADLINE);
  assert.equal('headlineNote' in withDue, false);
  const stored = storedOf(kvs, EPIC_ID);
  await kvs.set(`premortem:${EPIC_ID}`, { ...stored, pack: { ...stored.pack, epic: { ...stored.pack.epic, due: null } } });
  const noDue = await getEvidenceAction({ deps, epicKey: EPIC });
  assert.equal(noDue.headline, "It's 2 Feb 2027, and Checkout v2 launch has failed. Here's why.");
  assert.equal(noDue.headlineNote, 'No due date is set, so Forewarned imagines launch day 3 months from today.');
});

// The agent learns why, instead of "Call run-premortem first", and that it may try again.
test('get-evidence passes on why the last run failed when there is no evidence', async () => {
  const { deps, kvs } = await setup({ withRun: false });
  await kvs.set(`run:${EPIC_ID}`, { runId: 'r1', status: 'failed', startedAt: new Date(NOW).toISOString(), error: `Forewarned couldn't save the report on ${EPIC}.` });
  assert.deepEqual(await getEvidenceAction({ deps, epicKey: EPIC }),
    { error: `The last run failed: Forewarned couldn't save the report on ${EPIC}. Ask the user whether to run it again.` });
});

// Someone who can't see the epic learns nothing, not even whether a run is in progress.
test('every action refuses an epic the user can\'t see, before reading anything stored', async () => {
  const { deps } = await setup({ senderOptions: { hidden: [EPIC] } });
  await deps.kvs.set(`run:${EPIC_ID}`, { runId: 'r2', status: 'running', startedAt: new Date(NOW).toISOString() });
  assert.deepEqual(await getEvidenceAction({ deps, epicKey: EPIC }), NOT_VISIBLE);
  assert.deepEqual(await getPremortemAction({ deps, epicKey: EPIC }), NOT_VISIBLE);
  assert.deepEqual(await submitPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-2', reasonsJson: '[]' }), { saved: false, ...NOT_VISIBLE });
});

test('the Rovo actions refuse a work item that isn\'t an epic', async () => {
  const { deps } = await setup({ withRun: false });
  const story = keyOf('bk-chk-e11-03');
  const notEpic = `${story} is not an epic. Forewarned runs pre-mortems on epics only.`;
  assert.deepEqual(await getEvidenceAction({ deps, epicKey: story }), { error: notEpic });
  assert.deepEqual(await getPremortemAction({ deps, epicKey: story }), { error: notEpic });
  assert.deepEqual(await submitPremortemAction({ deps, epicKey: story, accountId: 'acc-1', reasonsJson: '[]' }), { saved: false, error: notEpic });
});

test('submit-premortem validates against the stored pack and saves only validated fields (AC 19, 21–22)', async () => {
  const { deps, kvs } = await setup();
  const { pack } = storedOf(kvs, EPIC_ID);
  const invented = { ...good(pack), title: 'Invented', explanation: 'Epics were 99 days late.' };
  const missing = { ...good(pack), title: 'Missing evidence', evidenceIds: ['E99'] };
  const result = await submitPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-1', packId: pack.packId, reasonsJson: JSON.stringify([good(pack), invented, missing]) });
  assert.deepEqual(result, {
    saved: true, epicKey: EPIC, savedReasons: 1,
    dropped: [
      { title: 'Invented', code: 'unknown-number', fix: 'Use only numbers that appear in the facts this reason cites, copied exactly.' },
      { title: 'Missing evidence', code: 'no-history-evidence', fix: 'Cite at least one evidence ID from get-evidence.' },
    ],
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
  assert.deepEqual(none.dropped, [{ title: 'History says late', code: 'no-history-evidence', fix: 'Cite at least one evidence ID from get-evidence.' }]);
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
  assert.deepEqual(result.dropped, [{ title: 'Blocked', code: 'no-history-evidence', fix: 'Cite at least one evidence ID from get-evidence.' }]);
});

// M3 QA: the agent resubmitted unchanged reasons; each drop now says what to change (story 008 AC 2).
test('every dropped reason says how to fix it', async () => {
  const { deps, kvs } = await setup();
  const { pack } = storedOf(kvs, EPIC_ID);
  const reasons = [
    good(pack), good(pack), 'not a reason',
    { ...good(pack), title: '' }, { ...good(pack), title: 'No likelihood', likelihood: 'Maybe' }, { ...good(pack), title: 'No mitigation', mitigation: '' },
    { ...good(pack), title: 'Unknown key', explanation: 'See CHK-9999.' }, { ...good(pack), title: 'Link', explanation: 'See https://example.com.' },
    { ...good(pack), title: 'Late again' }, { ...good(pack), title: 'Still late' }, { ...good(pack), title: 'Later still' }, { ...good(pack), title: 'Late as before' }, { ...good(pack), title: 'One too many' },
  ];
  const result = await submitPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-1', packId: pack.packId, reasonsJson: JSON.stringify(reasons) });
  assert.deepEqual(result.dropped.map(({ code, fix }) => [code, fix]), [
    ['duplicate', 'Give each reason its own title.'],
    ['not-an-object', 'Send each reason as a JSON object.'],
    ['missing-title', 'Add a short title.'],
    ['missing-likelihood', 'Set likelihood to High, Medium or Low.'],
    ['missing-mitigation', 'Add a one-sentence mitigation.'],
    ['unknown-key', 'Use only work item keys that appear in the evidence this reason cites.'],
    ['link', 'Remove web addresses and links.'],
    ['over-five', 'Keep at most 5 reasons.'],
  ]);
});

test('get-premortem returns the version 2 report, or says none is saved yet', async () => {
  const { deps, kvs } = await setup();
  assert.deepEqual(await getPremortemAction({ deps, epicKey: EPIC }), { epicKey: EPIC, report: storedOf(kvs, EPIC_ID).report });
  const empty = await setup({ withRun: false });
  assert.deepEqual(await getPremortemAction({ deps: empty.deps, epicKey: EPIC }), { epicKey: EPIC, report: null, message: `No pre-mortem has been saved on ${EPIC} yet.` });
});
