// The site runner (QA steps 2, 3, 5): safe without credentials, and a full run against the seed.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { CODEGEIST_DIR } from '../../scripts/seed/test/helpers.mjs';
import { keyOf } from './seed-snapshot.mjs';

const RUNNER = join(CODEGEIST_DIR, 'scripts', 'engine', 'run-on-site.mjs');
const SHIM = pathToFileURL(join(CODEGEIST_DIR, 'test', 'engine', 'seed-fetch.mjs')).href;
const EMAIL = 'sentinel-email@example.invalid';
const TOKEN = 'sentinel-token-1234567890';

const run = (args, env, withShim = false) => spawnSync(process.execPath, [...(withShim ? ['--import', SHIM] : []), RUNNER, ...args], {
  encoding: 'utf8',
  env: { ...process.env, JIRA_SITE_URL: '', JIRA_EMAIL: '', JIRA_API_TOKEN: '', ...env },
});

test('without credentials it names the missing variables and prints no value', () => {
  const result = run(['CHK-12'], { JIRA_EMAIL: EMAIL });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing environment variables: JIRA_SITE_URL, JIRA_API_TOKEN\./);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(EMAIL));
});

test('a value that is not an epic key is refused before any request', () => {
  const result = run(['chk 12'], { JIRA_SITE_URL: 'https://seed.example.atlassian.net', JIRA_EMAIL: EMAIL, JIRA_API_TOKEN: TOKEN });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: node scripts\/engine\/run-on-site\.mjs <EPIC-KEY>/);
});

test('a full run prints the log line, the comparison, the checks and every fact, never the credentials', () => {
  const result = run([keyOf('ll-chk-e11')], { JIRA_SITE_URL: 'https://seed.example.atlassian.net', JIRA_EMAIL: EMAIL, JIRA_API_TOKEN: TOKEN }, true);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Evidence pack: \d+ Jira requests, \d+ ms, \d+ bytes, \d+ evidence items$/m);
  assert.match(result.stdout, /^Comparison: matched on components Payments, Web \(8 epics\)$/m);
  assert.match(result.stdout, /^Check slip: found/m);
  assert.match(result.stdout, /^E1 slip-base-rate: \d+ of \d+ comparable epics/m);
  assert.match(result.stdout, /^packId [0-9a-f]{16}$/m);
  for (const secret of [EMAIL, TOKEN, 'acc-']) assert.ok(!`${result.stdout}${result.stderr}`.includes(secret), `printed ${secret}`);
});
