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
