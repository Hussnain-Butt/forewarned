// The post-import step (story 001, AC 21–24): it stops safely before any network call, and
// against a fake Jira (fake-jira.mjs) it assigns the roles and checks the inventory.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { SEED_DIR, readJson, runNode, tempDir } from './helpers.mjs';

const SCRIPT = join(SEED_DIR, 'assign-personas.mjs');
const NO_ENV = { JIRA_SITE_URL: '', JIRA_EMAIL: '', JIRA_API_TOKEN: '' };
const SITE = 'https://seed-check.invalid';
const EMAIL = 'sentinel-email-value@example.invalid';
const TOKEN = 'sentinel-token-value-1234567890';

const output = (run) => `${run.stdout}${run.stderr}`;

test('stops and names every missing variable', () => {
  const run = runNode(SCRIPT, [], NO_ENV);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Missing environment variables: JIRA_SITE_URL, JIRA_EMAIL, JIRA_API_TOKEN\./);
});

test('without JIRA_API_TOKEN it stops without printing any value (AC 21)', () => {
  const run = runNode(SCRIPT, [], { ...NO_ENV, JIRA_SITE_URL: SITE, JIRA_EMAIL: EMAIL });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Missing environment variable: JIRA_API_TOKEN\./);
  for (const secret of [SITE, 'seed-check', EMAIL, 'sentinel']) assert.ok(!output(run).includes(secret), `printed ${secret}`);
});

test('an invalid site URL is reported without echoing it', () => {
  const run = runNode(SCRIPT, [], { JIRA_SITE_URL: 'not a url sentinel', JIRA_EMAIL: EMAIL, JIRA_API_TOKEN: TOKEN });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /JIRA_SITE_URL is not a valid URL/);
  assert.ok(!output(run).includes('sentinel'));
});

test('stops on personas without a demo-site user, before contacting the site (AC 24)', () => {
  // Runs a copy whose personas.json still has a TODO, so this test never reaches a site.
  const dir = tempDir();
  for (const f of ['assign-personas.mjs', 'answer-key.json', 'forewarned-demo.json']) copyFileSync(join(SEED_DIR, f), join(dir, f));
  const personas = readJson(join(SEED_DIR, 'personas.json'));
  personas.roles[3].displayName = 'TODO: pick a demo user';
  writeFileSync(join(dir, 'personas.json'), JSON.stringify(personas));
  const run = runNode(join(dir, 'assign-personas.mjs'), [], { JIRA_SITE_URL: SITE, JIRA_EMAIL: EMAIL, JIRA_API_TOKEN: TOKEN });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /personas\.json has no demo-site user yet for: .*mobile/);
  for (const secret of [EMAIL, TOKEN, 'sentinel']) assert.ok(!output(run).includes(secret), `printed ${secret}`);
  assert.deepEqual(readdirSync(dir).sort(), ['answer-key.json', 'assign-personas.mjs', 'forewarned-demo.json', 'personas.json']);
});

// A copy of the seed folder whose personas.json names a user for every role.
function seedCopyWithUsers() {
  const dir = tempDir();
  for (const f of ['assign-personas.mjs', 'answer-key.json', 'forewarned-demo.json']) copyFileSync(join(SEED_DIR, f), join(dir, f));
  const personas = readJson(join(SEED_DIR, 'personas.json'));
  personas.roles.forEach((r, i) => { r.displayName = `Seed User ${i + 1}`; });
  writeFileSync(join(dir, 'personas.json'), JSON.stringify(personas));
  return dir;
}

function runAgainstFake(dir, fakeEnv = {}) {
  const fake = pathToFileURL(join(SEED_DIR, 'test', 'fake-jira.mjs')).href;
  return spawnSync(process.execPath, ['--import', fake, join(dir, 'assign-personas.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, JIRA_SITE_URL: SITE, JIRA_EMAIL: EMAIL, JIRA_API_TOKEN: TOKEN, FAKE_SEED_DIR: dir, ...fakeEnv },
  });
}

test('assigns every role, unassigns the un- work items, adds missing role labels and passes the inventory (AC 23, 25, 27)', () => {
  const dir = seedCopyWithUsers();
  const key = readJson(join(SEED_DIR, 'answer-key.json'));
  // Every work item starts assigned to someone else, as when the default assignee is the space
  // lead, and without role labels, as on the demo site imported before labels.
  const run = runAgainstFake(dir, { FAKE_START_ASSIGNEE: 'acc-space-lead', FAKE_START_LABELS: 'none' });
  assert.equal(run.status, 0, output(run));
  for (const r of key.roles) {
    assert.ok(run.stdout.includes(`${r.title} -> Seed User `), `no assignment line for ${r.role}`);
    assert.ok(run.stdout.includes(`: ${r.seededWorkItems} changed, 0 already right`), `${r.role} count`);
  }
  assert.ok(run.stdout.includes(`Unassigned: ${key.unassigned.seededWorkItems} changed, 0 already right`));
  const labelled = key.roles.reduce((sum, r) => sum + r.queryMatches, 0);
  assert.ok(run.stdout.includes(`Role labels on child work items: ${labelled} changed, 0 already right`), 'label count');
  const assigned = key.roles.reduce((sum, r) => sum + r.seededWorkItems, key.unassigned.seededWorkItems);
  assert.match(run.stderr, new RegExp(`fake-jira edits: ${assigned + labelled}\\n`));
  assert.equal((run.stdout.match(/^ {2}PASS /gm) ?? []).length, key.inventory.length);
  assert.ok(run.stdout.includes(`All ${key.inventory.length} inventory lines PASS.`));
  for (const secret of [EMAIL, TOKEN, 'acc-']) assert.ok(!output(run).includes(secret), `printed ${secret}`);
  assert.equal(readdirSync(dir).length, 4, 'the script wrote a file');
});

test('a second run changes nothing', () => {
  const run = runAgainstFake(seedCopyWithUsers(), { FAKE_START_ASSIGNEE: 'roles' });
  assert.equal(run.status, 0, output(run));
  assert.doesNotMatch(run.stdout, /: [1-9]\d* changed/);
  assert.match(run.stderr, /fake-jira edits: 0\n/);
  assert.match(run.stdout, /inventory lines PASS\./);
});

test('stops before any edit when a seeded work item is missing (AC 23)', () => {
  const run = runAgainstFake(seedCopyWithUsers(), { FAKE_DROP_FIRST: '1' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Stopped: 1 of 194 seeded work items were not found by space and summary/);
  assert.match(run.stderr, /fake-jira edits: 0\n/);
  assert.doesNotMatch(run.stdout, /Assignments:/);
});

test('the first failed edit stops all edits and prints only Jira\'s error message (AC 24)', () => {
  const run = runAgainstFake(seedCopyWithUsers(), { FAKE_START_LABELS: 'none', FAKE_FAIL_EDIT: 'CHK-3' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Stopped: PUT \/rest\/api\/3\/issue\/CHK-3\/assignee failed with HTTP 400: Edit refused\./);
  assert.ok(!output(run).includes('SENTINEL-RESPONSE-BODY'), 'printed the raw response body');
  // CHK-3 is the first job; at most the 4 other workers finish the job they already started.
  const edits = Number(/fake-jira edits: (\d+)/.exec(run.stderr)[1]);
  assert.ok(edits <= 8, `${edits} edits after the failure`);
  assert.doesNotMatch(run.stdout, /Assignments:/);
});

test('stops before assigning when a user already has too much open work (AC 22)', () => {
  const run = runAgainstFake(seedCopyWithUsers(), { FAKE_BASELINE: '6' });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /Engineering manager \(Seed User 3\): 6/);
  assert.match(run.stderr, /Stopped: Nothing assigned\. These users have more than 5 open work items/);
  assert.doesNotMatch(run.stdout, /Assignments:/);
});
