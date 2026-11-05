// Following the agent's write-ups from the panel (story 005 AC 19, story 008 AC 8): the agent may
// fix dropped reasons and save again, so after a save with drops the panel keeps checking and shows
// the fixed save too (site finding F1: the resubmission showed only after a reload). A clean save
// ends the wait, because every check reads the stored pre-mortem from KVS (story 009 allowance).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followAgentWriteUps } from '../../src/frontend/agent-wait.js';

// The clock moves only while the loop waits. `answers` are what the panel data holds at each check,
// in turn: a save time (a string, nothing dropped), { savedAt, dropped } or null for a failed check.
function harness(answers) {
  let now = 0;
  let next = 0;
  const shown = [];
  const checks = [];
  const options = {
    check: async () => {
      checks.push(now);
      const answer = answers[Math.min(next, answers.length - 1)];
      next += 1;
      if (answer === null) return null;
      const { savedAt, dropped = 0 } = typeof answer === 'string' ? { savedAt: answer } : answer;
      return { report: { agent: { savedAt, droppedByRule: dropped ? { 'unknown-number': dropped } : {} } } };
    },
    wait: async (ms) => { now += ms; },
    now: () => now,
    startedAt: 0,
    savedBefore: 'before',
    limitMs: 30000,
    pollMs: 5000,
    onWriteUp: (result) => shown.push(result.report.agent.savedAt),
  };
  return { options, shown, checks };
}

test('a save that dropped reasons keeps the panel following, so the fixed resubmission shows too', async () => {
  const { options, shown, checks } = harness(['before', { savedAt: 'first', dropped: 1 }, { savedAt: 'first', dropped: 1 }, 'second', 'second']);
  assert.equal(await followAgentWriteUps(options), true);
  assert.deepEqual(shown, ['first', 'second']);
  assert.equal(checks.at(-1), 20000, 'the clean resubmission ends the wait');
});

test('a clean save ends the wait at once', async () => {
  const { options, shown, checks } = harness(['before', 'first', 'second']);
  assert.equal(await followAgentWriteUps(options), true);
  assert.deepEqual(shown, ['first']);
  assert.deepEqual(checks, [5000, 10000]);
});

// Site check of F1: reading and confirming two Rovo cards took about 3 minutes, so the fixed save
// landed after a wait counted from the click. A save with drops gives the agent a full wait again.
test('a save with drops gives the agent a full wait again for its fixed resubmission', async () => {
  // Checks at 5, 10, …: the first save shows at 25 s, the fixed one at 50 s (after the first 30 s).
  const dropped = { savedAt: 'first', dropped: 2 };
  const { options, shown, checks } = harness(['before', 'before', 'before', 'before', dropped, dropped, dropped, dropped, dropped, 'second']);
  assert.equal(await followAgentWriteUps(options), true);
  assert.deepEqual(shown, ['first', 'second']);
  assert.equal(checks.at(-1), 50000);
});

test('with no new write-up, the checks stop at the limit and say nothing arrived', async () => {
  const { options, shown, checks } = harness(['before', null, 'before']);
  assert.equal(await followAgentWriteUps(options), false);
  assert.deepEqual(shown, []);
  assert.deepEqual(checks, [5000, 10000, 15000, 20000, 25000, 30000]);
});
