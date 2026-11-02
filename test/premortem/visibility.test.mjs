// A stored pack seen by someone other than its builder (story 002 AC 2 for stored packs): work items
// the reader can't see, and the evidence and reasons that name them, are left out.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEvidenceAction, getPremortemAction, runPremortemAction, submitPremortemAction } from '../../src/premortem/actions.js';
import { handleRun } from '../../src/premortem/consumer.js';
import { hiddenEvidenceIds, packForReader, reportForReader } from '../../src/premortem/visibility.js';
import { keyOf } from '../engine/seed-snapshot.mjs';
import { fakeKvs, fakeQueue, fakeSenders, idOf, portOf, storedOf } from './fakes.mjs';

const EPIC = keyOf('ll-chk-e11');
const EPIC_ID = await idOf(EPIC);
const NOW = Date.parse('2026-11-02T08:00:00.000Z');
const BLOCKER = keyOf('un-plt-e03-07');

// `accountId` runs the pre-mortem with senders that hide `builderHides`; the reader's senders hide
// `hidden`. Both share one KVS, like two users of one site.
async function stored(hidden = [], { kvs = fakeKvs(), accountId = 'acc-1', runId = 'r1', builderHides = [] } = {}) {
  const builder = fakeSenders({ hidden: builderHides });
  const deps = { port: portOf(builder.senders), kvs, queue: fakeQueue(kvs), now: () => NOW, newId: () => runId, log: () => {} };
  await runPremortemAction({ deps, epicKey: EPIC, accountId });
  await handleRun({ event: { body: { runId, epicKey: EPIC, epicId: EPIC_ID, accountId } }, senders: builder.senders, kvs, now: () => NOW, log: () => {} });
  const readerDeps = { ...deps, port: portOf(fakeSenders({ hidden }).senders) };
  return { ...storedOf(kvs, EPIC_ID), deps, readerDeps, kvs };
}

// Access can be taken away after a run, so the builder gets no shortcut past the check.
test('the builder is checked too: after losing access to a blocker they no longer see it', async () => {
  const { pack, readerDeps } = await stored([BLOCKER]);
  const { report } = await getPremortemAction({ deps: readerDeps, epicKey: EPIC });
  assert.ok(pack.builtFor === 'acc-1' && !JSON.stringify(report).includes(BLOCKER));
  // Even when asked with the builder's own account ID, no shortcut skips the check.
  assert.ok((await hiddenEvidenceIds(readerDeps.port, pack, 'acc-1')).has(pack.evidence.find((e) => e.type === 'open-blocker').id));
});

test('another reader who can see everything gets the same pack and report', async () => {
  const { pack, report, readerDeps } = await stored([]);
  const hidden = await hiddenEvidenceIds(readerDeps.port, pack);
  assert.deepEqual(hidden, new Set());
  assert.deepEqual(packForReader(pack, hidden), pack);
  assert.deepEqual(reportForReader(report, hidden), report);
});

test('a reader who can\'t see a blocker never sees it, nor the reasons built on it', async () => {
  const { pack, report, readerDeps } = await stored([BLOCKER]);
  const hidden = await hiddenEvidenceIds(readerDeps.port, pack);
  const openBlocker = pack.evidence.find((e) => e.type === 'open-blocker');
  assert.ok(hidden.has(openBlocker.id));
  const seen = packForReader(pack, hidden);
  assert.ok(!JSON.stringify(seen.evidence).includes(BLOCKER));
  assert.equal(seen.notes.at(-1), "Some evidence is hidden because it names work items you can't see.");
  const shown = reportForReader(report, hidden);
  assert.ok(!JSON.stringify(shown).includes(BLOCKER));
  assert.ok(!shown.ruleBased.reasons.some((r) => r.ruleId === 'dependency'));
  assert.ok(shown.ruleBased.reasons.length >= 4);
  assert.equal(shown.hiddenForReader, true);
});

test('get-evidence and get-premortem answer each reader with what they may see', async () => {
  const { deps, readerDeps } = await stored([BLOCKER]);
  const evidence = await getEvidenceAction({ deps: readerDeps, epicKey: EPIC });
  assert.ok(!JSON.stringify(evidence).includes(BLOCKER));
  const { report } = await getPremortemAction({ deps: readerDeps, epicKey: EPIC });
  assert.ok(!JSON.stringify(report).includes(BLOCKER));
  const own = await getEvidenceAction({ deps, epicKey: EPIC });
  assert.ok(JSON.stringify(own).includes(BLOCKER));
});

test('the "hidden" note is set only when a reason was actually left out', async () => {
  const { pack, report } = await stored([]);
  const uncited = pack.evidence.find((e) => !report.ruleBased.reasons.some((r) => r.evidenceIds.includes(e.id)));
  assert.ok(uncited, 'the seed has evidence no rule cites');
  assert.equal(reportForReader(report, new Set([uncited.id])).hiddenForReader, undefined);
});

// An agent write-up from an older pack cites that pack's evidence IDs, which the current pack
// numbers differently: it can't be checked for any reader, so its reasons are shown to no one.
test('a stale agent write-up shows no reasons to any reader, the new builder included', async () => {
  const kvs = fakeKvs();
  const first = await stored([], { kvs });
  const blocker = first.pack.evidence.find((e) => e.type === 'open-blocker');
  const saved = await submitPremortemAction({ deps: first.deps, epicKey: EPIC, accountId: 'acc-1', packId: first.pack.packId,
    reasonsJson: JSON.stringify([{ title: 'Blocked', likelihood: 'Medium', explanation: blocker.fact, evidenceIds: [blocker.id], mitigation: `Chase ${BLOCKER}.` }]) });
  assert.equal(saved.saved, true);
  // acc-2 can't see the blocker and runs again: their pack leaves it out, so the packId changes.
  const second = await stored([BLOCKER], { kvs, accountId: 'acc-2', runId: 'r2', builderHides: [BLOCKER] });
  assert.notEqual(second.pack.packId, first.pack.packId);
  // The new builder (acc-2), and anyone else, who can't see the blocker.
  const { report } = await getPremortemAction({ deps: second.readerDeps, epicKey: EPIC });
  assert.ok(!JSON.stringify(report).includes(BLOCKER));
  assert.deepEqual(report.agent.reasons, []);
  assert.equal(report.agent.stale, true);
});
