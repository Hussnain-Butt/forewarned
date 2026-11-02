// The version 2 report (story 003 AC 6, 23–25).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computePack } from '../../src/engine/pack.js';
import { buildReport, withAgentWriteUp } from '../../src/premortem/report.js';
import { ruleBasedReasons } from '../../src/premortem/rules.js';
import { seedSnapshot } from '../engine/seed-snapshot.mjs';

const NOW = Date.parse('2026-11-02T08:00:00.000Z');
const pack = computePack(seedSnapshot());
const ruleReasons = ruleBasedReasons(pack);
const agentPart = { reasons: [ruleReasons[0]], droppedByRule: { 'unknown-number': 1 }, packId: pack.packId, now: NOW };

test('a report holds the pack ID, the checks, the rule-based reasons and who ran it', () => {
  const report = buildReport({ pack, ruleReasons, previous: null, accountId: 'acc-1', now: NOW });
  assert.deepEqual(report, {
    version: 2, epicKey: pack.epic.key, packId: pack.packId, status: 'ok', checks: pack.checks,
    ruleBased: { generatedAt: '2026-11-02T08:00:00.000Z', reasons: ruleReasons },
    agent: null, runBy: 'acc-1', runAt: '2026-11-02T08:00:00.000Z',
  });
});

test('status: insufficient-history under 3 comparable epics, no-signals when no rule fires (AC 23–24, 004 AC 11)', () => {
  const few = { ...pack, comparison: { ...pack.comparison, epics: pack.comparison.epics.slice(0, 2) } };
  assert.equal(buildReport({ pack: few, ruleReasons, previous: null, accountId: 'a', now: NOW }).status, 'insufficient-history');
  assert.equal(buildReport({ pack, ruleReasons: [], previous: null, accountId: 'a', now: NOW }).status, 'no-signals');
});

test('a new run keeps the agent write-up and marks it stale when the pack changed (AC 6)', () => {
  const first = withAgentWriteUp(buildReport({ pack, ruleReasons, previous: null, accountId: 'a', now: NOW }), agentPart);
  assert.equal(first.agent.stale, false);
  assert.deepEqual(first.agent.reasons, [ruleReasons[0]]);
  const same = buildReport({ pack, ruleReasons, previous: first, accountId: 'a', now: NOW + 1000 });
  assert.equal(same.agent.stale, false);
  const changed = buildReport({ pack: { ...pack, packId: 'ffffffffffffffff' }, ruleReasons, previous: first, accountId: 'a', now: NOW + 1000 });
  assert.equal(changed.agent.stale, true);
  assert.deepEqual(changed.agent.reasons, first.agent.reasons);
});

test('a version 1 report from the spike is not carried over', () => {
  const v1 = { version: 1, savedAt: 'x', source: 'rovo-agent', evidence: [], reasons: [], droppedCount: 0 };
  assert.equal(buildReport({ pack, ruleReasons, previous: v1, accountId: 'a', now: NOW }).agent, null);
});

test('withAgentWriteUp replaces only the agent part', () => {
  const report = buildReport({ pack, ruleReasons, previous: null, accountId: 'a', now: NOW });
  const next = withAgentWriteUp(report, agentPart);
  assert.deepEqual({ ...next, agent: null }, report);
  assert.deepEqual(next.agent, { reasons: [ruleReasons[0]], savedAt: '2026-11-02T08:00:00.000Z', packId: pack.packId, droppedByRule: { 'unknown-number': 1 }, stale: false });
});

test('a report over 24,000 bytes is refused (AC 25)', () => {
  const huge = ruleReasons.map((r) => ({ ...r, explanation: '😀'.repeat(1500) }));
  assert.throws(() => buildReport({ pack, ruleReasons: huge, previous: null, accountId: 'a', now: NOW }), /larger than 24,000 bytes/);
});
