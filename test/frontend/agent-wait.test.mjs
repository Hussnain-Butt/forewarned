// Following the agent's write-ups from the panel (story 005 AC 19, story 008 AC 8): the agent may
// fix dropped reasons and save again, so the panel keeps checking until the wait ends and shows each
// new save (site finding F1: the resubmission showed only after a reload).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followAgentWriteUps } from '../../src/frontend/agent-wait.js';

// The clock moves only while the loop waits. `answers` are the savedAt values the panel data holds
// at each check, in turn; null stands for a check that failed.
function harness(answers) {
  let now = 0;
  let next = 0;
  const shown = [];
  const checks = [];
  const options = {
    check: async () => {
      checks.push(now);
      const savedAt = answers[Math.min(next, answers.length - 1)];
      next += 1;
      return savedAt === null ? null : { report: { agent: { savedAt } } };
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

test('the panel keeps following the agent after its first save, so a resubmission shows too', async () => {
  const { options, shown } = harness(['before', 'first', 'first', 'second', 'second', 'second']);
  assert.equal(await followAgentWriteUps(options), true);
  assert.deepEqual(shown, ['first', 'second']);
});

test('with no new write-up, the checks stop at the limit and say nothing arrived', async () => {
  const { options, shown, checks } = harness(['before', null, 'before']);
  assert.equal(await followAgentWriteUps(options), false);
  assert.deepEqual(shown, []);
  assert.deepEqual(checks, [5000, 10000, 15000, 20000, 25000, 30000]);
});
