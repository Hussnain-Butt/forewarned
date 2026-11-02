// A stored pack seen by someone other than its builder (story 002 AC 2 for stored packs): work items
// the reader can't see, and the evidence and reasons that name them, are left out.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEvidenceAction, getPremortemAction, runPremortemAction } from '../../src/premortem/actions.js';
import { handleRun } from '../../src/premortem/consumer.js';
import { hiddenEvidenceIds, packForReader, reportForReader } from '../../src/premortem/visibility.js';
import { EVIDENCE_PROPERTY, REPORT_PROPERTY } from '../../src/premortem/store.js';
import { keyOf } from '../engine/seed-snapshot.mjs';
import { fakeKvs, fakeQueue, fakeSenders, portOf } from './fakes.mjs';

const EPIC = keyOf('ll-chk-e11');
const NOW = Date.parse('2026-11-02T08:00:00.000Z');
const BLOCKER = keyOf('un-plt-e03-07');

// Builder acc-1 runs the pre-mortem; the reader's senders hide the given keys.
async function stored(hidden = []) {
  const builder = fakeSenders();
  const kvs = fakeKvs();
  const deps = { port: portOf(builder.senders), kvs, queue: fakeQueue(kvs), now: () => NOW, newId: () => 'r1', log: () => {} };
  await runPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-1' });
  await handleRun({ event: { body: { runId: 'r1', epicKey: EPIC, accountId: 'acc-1' } }, senders: builder.senders, kvs, now: () => NOW, log: () => {} });
  const reader = fakeSenders({ hidden });
  for (const [k, v] of builder.properties) reader.properties.set(k, v);
  const readerDeps = { ...deps, port: portOf(reader.senders) };
  return { pack: builder.properties.get(`${EPIC}/${EVIDENCE_PROPERTY}`), report: builder.properties.get(`${EPIC}/${REPORT_PROPERTY}`), readerDeps, reader };
}

test('the builder sees everything, without any extra request', async () => {
  const { pack, readerDeps } = await stored([BLOCKER]);
  const before = readerDeps.port.requestCount;
  assert.deepEqual(await hiddenEvidenceIds(readerDeps.port, pack, 'acc-1'), new Set());
  assert.equal(readerDeps.port.requestCount, before);
});

test('another reader who can see everything gets the same pack and report', async () => {
  const { pack, report, readerDeps } = await stored([]);
  const hidden = await hiddenEvidenceIds(readerDeps.port, pack, 'acc-2');
  assert.deepEqual(hidden, new Set());
  assert.deepEqual(packForReader(pack, hidden), pack);
  assert.deepEqual(reportForReader(report, hidden), report);
});

test('a reader who can\'t see a blocker never sees it, nor the reasons built on it', async () => {
  const { pack, report, readerDeps } = await stored([BLOCKER]);
  const hidden = await hiddenEvidenceIds(readerDeps.port, pack, 'acc-2');
  const openBlocker = pack.evidence.find((e) => e.type === 'open-blocker');
  assert.ok(hidden.has(openBlocker.id));
  const seen = packForReader(pack, hidden);
  assert.ok(!JSON.stringify(seen.evidence).includes(BLOCKER));
  assert.equal(seen.notes.at(-1), "Some evidence is hidden because it names work items you can't see.");
  const shown = reportForReader(report, hidden);
  assert.ok(!JSON.stringify(shown).includes(BLOCKER));
  assert.ok(!shown.ruleBased.reasons.some((r) => r.ruleId === 'dependency'));
  assert.ok(shown.ruleBased.reasons.length >= 4);
});

test('get-evidence and get-premortem answer each reader with what they may see', async () => {
  const { readerDeps } = await stored([BLOCKER]);
  const evidence = await getEvidenceAction({ deps: readerDeps, epicKey: EPIC, readerAccountId: 'acc-2' });
  assert.ok(!JSON.stringify(evidence).includes(BLOCKER));
  const { report } = await getPremortemAction({ deps: readerDeps, epicKey: EPIC, readerAccountId: 'acc-2' });
  assert.ok(!JSON.stringify(report).includes(BLOCKER));
  const own = await getEvidenceAction({ deps: readerDeps, epicKey: EPIC, readerAccountId: 'acc-1' });
  assert.ok(JSON.stringify(own).includes(BLOCKER));
});
