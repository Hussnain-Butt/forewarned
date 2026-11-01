// The Jira port (story 002 AC 33 and the 429/5xx edge case): counting, one retry, safe errors.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JiraError, createJira } from '../../src/engine/jira.js';

const reply = (status, body = {}, headers = {}) => async () => new Response(JSON.stringify(body), { status, headers });
const sequence = (...replies) => {
  let i = 0;
  return async () => replies[Math.min(i++, replies.length - 1)]();
};

test('every call is counted and returns parsed JSON', async () => {
  const port = createJira({ serverInfo: reply(200, { baseUrl: 'https://x.atlassian.net' }) }, { deadline: Infinity });
  assert.deepEqual(await port.serverInfo(), { baseUrl: 'https://x.atlassian.net' });
  await port.serverInfo();
  assert.equal(port.requestCount, 2);
});

test('a 429 is retried once after Retry-After when that fits the deadline', async () => {
  const waits = [];
  const port = createJira({ count: sequence(reply(429, {}, { 'Retry-After': '1' }), reply(200, { count: 7 })) }, {
    deadline: 60000, now: () => 0, sleep: async (ms) => { waits.push(ms); },
  });
  assert.deepEqual(await port.count('parent = "CHK-1"'), { count: 7 });
  assert.deepEqual(waits, [1000]);
  assert.equal(port.requestCount, 2);
});

test('no retry when the wait would pass the deadline', async () => {
  const port = createJira({ count: reply(429, {}, { 'Retry-After': '5' }) }, { deadline: 1000, now: () => 0, sleep: async () => assert.fail('slept') });
  await assert.rejects(port.count('x'), (e) => e instanceof JiraError && e.status === 429 && /busy/.test(e.message));
});

test('error messages never contain the response body', async () => {
  const port = createJira({ search: reply(500, { errorMessages: ['SENTINEL internal detail'] }) }, { deadline: 60000, now: () => 0, sleep: async () => {} });
  await assert.rejects(port.search({}), (e) => e.status === 500 && !e.message.includes('SENTINEL'));
  assert.equal(port.requestCount, 2);
});

test('a 404 becomes a JiraError with its status', async () => {
  const port = createJira({ issue: reply(404, { errorMessages: ['Issue does not exist'] }) }, { deadline: Infinity });
  await assert.rejects(port.issue('CHK-1', ['summary']), (e) => e instanceof JiraError && e.status === 404);
});
