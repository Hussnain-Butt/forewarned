// The engine's entry point (story 002 AC 1, 29, 33): fetch, compute, builtAt and one log line.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEvidencePack } from '../../src/engine/index.js';
import { seedPort } from './seed-port.mjs';
import { keyOf } from './seed-snapshot.mjs';

const NOW = Date.parse('2026-11-02T08:00:00.000Z');

const capture = async (fn) => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
};

test('builds a pack with builtAt and logs exactly one line without work item content', async () => {
  const { result, lines } = await capture(() => buildEvidencePack({
    senders: seedPort().senders, epicKey: keyOf('ll-chk-e11'), accountId: 'acc-requester', now: () => NOW,
  }));
  assert.equal(result.pack.builtAt, '2026-11-02T08:00:00.000Z');
  assert.equal(result.pack.builtFor, 'acc-requester');
  assert.equal(result.pack.epic.summary, 'Checkout v2 launch');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Evidence pack: \d+ Jira requests, \d+ ms, \d+ bytes, \d+ evidence items$/);
});

test('a work item that is not an epic returns the AC 1 message', async () => {
  const { result } = await capture(() => buildEvidencePack({
    senders: seedPort().senders, epicKey: keyOf('bk-chk-e11-03'), accountId: 'acc-requester', now: () => NOW,
  }));
  assert.deepEqual(result, { error: `${keyOf('bk-chk-e11-03')} is not an epic. Forewarned runs pre-mortems on epics only.` });
});

test('a run that builds no pack still logs its one line (AC 33)', async () => {
  const { lines } = await capture(() => buildEvidencePack({
    senders: seedPort().senders, epicKey: keyOf('bk-chk-e11-03'), accountId: 'acc-requester', now: () => NOW,
  }));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Evidence pack: not built, \d+ Jira requests, \d+ ms$/);
});

// Story 009 AC 11: the consumer logs one line per run with these counts, so the engine's own line
// would be a second one.
test('onSummary gets the counts instead of the console line, also when no pack is built', async () => {
  const summaries = [];
  const { result, lines } = await capture(() => buildEvidencePack({
    senders: seedPort().senders, epicKey: keyOf('ll-chk-e11'), accountId: 'acc-requester', now: () => NOW, onSummary: (s) => summaries.push(s),
  }));
  assert.deepEqual(lines, []);
  assert.equal(summaries.length, 1);
  assert.ok(summaries[0].requests > 0);
  assert.equal(summaries[0].evidence, result.pack.evidence.length);
  assert.equal(summaries[0].bytes, Buffer.byteLength(JSON.stringify(result.pack), 'utf8'));

  const notBuilt = [];
  await capture(() => buildEvidencePack({
    senders: seedPort().senders, epicKey: keyOf('bk-chk-e11-03'), accountId: 'acc-requester', now: () => NOW, onSummary: (s) => notBuilt.push(s),
  }));
  assert.equal(notBuilt.length, 1);
  assert.ok(notBuilt[0].requests > 0);
  assert.equal(notBuilt[0].evidence, null);
  assert.equal(notBuilt[0].bytes, null);

  const failed = [];
  const senders = { ...seedPort().senders, search: async () => { throw new TypeError('boom'); } };
  await assert.rejects(capture(() => buildEvidencePack({ senders, epicKey: keyOf('ll-chk-e11'), accountId: 'a', now: () => NOW, onSummary: (s) => failed.push(s) })), TypeError);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].evidence, null);
});
