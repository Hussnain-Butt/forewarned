// Generator behaviour: determinism (AC 4), date modes (AC 5), options and the no-users guard (AC 7).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  DEMO_FILE, KEY_FILE, SEED_DIR, generate, loadSeed, readJson, runNode, tempDir,
} from './helpers.mjs';

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const lf = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

test('two runs write byte-identical files (AC 4)', () => {
  const first = generate();
  const second = generate();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  for (const file of [DEMO_FILE, KEY_FILE]) {
    assert.equal(sha256(join(first.out, file)), sha256(join(second.out, file)), `${file} differs between runs`);
  }
});

test('the committed files are the current generator output', () => {
  const fresh = generate();
  assert.equal(fresh.status, 0, fresh.stderr);
  for (const file of [DEMO_FILE, KEY_FILE]) {
    assert.equal(lf(join(SEED_DIR, file)), lf(join(fresh.out, file)), `${file} is stale: run npm run seed:generate`);
  }
});

test('the default output uses relative dates only (AC 5)', () => {
  const text = readFileSync(join(SEED_DIR, DEMO_FILE), 'utf8');
  const dates = [...text.matchAll(/"(?:created|updated|duedate|releaseDate)": "([^"]*)"/g)].map((m) => m[1]);
  assert.ok(dates.length > 400);
  for (const d of dates) assert.match(d, /^P-?[1-9]\d*D$/, `not a relative date: ${d}`);
});

test('--today writes absolute dates for the same day numbers', () => {
  const today = '2026-11-02';
  const run = generate(['--today', today]);
  assert.equal(run.status, 0, run.stderr);
  const absolute = readJson(join(run.out, DEMO_FILE));
  const text = JSON.stringify(absolute);
  const dates = [...text.matchAll(/"(?:created|updated|duedate|releaseDate)":"([^"]*)"/g)].map((m) => m[1]);
  for (const d of dates) assert.match(d, /^\d{4}-\d{2}-\d{2}T09:00:00\.000\+0000$/, `not an absolute date: ${d}`);
  const wallet = absolute.projects[0].issues.find((i) => i.summary === 'Wallet top-up');
  assert.equal(wallet.duedate, '2026-06-15T09:00:00.000+0000'); // 140 days before 2 Nov 2026

  const relative = loadSeed(readJson(join(SEED_DIR, DEMO_FILE)));
  assert.deepEqual(loadSeed(absolute, today), relative);
  assert.match(absolute.projects[0].description, /All dates are as of 2026-11-02\.$/);
  assert.equal(readJson(join(run.out, KEY_FILE)).dates.mode, 'absolute');
});

test('rejects a bad --today value and unknown options', () => {
  for (const args of [['--today', '2026-02-30'], ['--today', 'tomorrow'], ['--surprise']]) {
    const run = generate(args);
    assert.equal(run.status, 1, `expected failure for ${args.join(' ')}`);
    assert.match(run.stderr, /^Error: /);
  }
});

test('--role-labels puts role labels on child work items only (AC 25 fallback)', () => {
  const run = generate(['--role-labels']);
  assert.equal(run.status, 0, run.stderr);
  const demo = readJson(join(run.out, DEMO_FILE));
  const key = readJson(join(run.out, KEY_FILE));
  for (const project of demo.projects) {
    for (const issue of project.issues) {
      const role = issue.externalId.split('-')[0];
      if (issue.issueType === 'Epic' || role === 'un') assert.equal(issue.labels, undefined, issue.externalId);
      else assert.deepEqual(issue.labels, [`seed-role-${key.roles.find((r) => r.prefix === role).role}`]);
    }
  }
  for (const r of key.roles) {
    assert.equal(r.query, `project in (CHK, PLT) AND labels = seed-role-${r.role}`);
    const labelled = demo.projects.flatMap((p) => p.issues).filter((i) => i.labels?.includes(`seed-role-${r.role}`));
    assert.equal(r.queryMatches, labelled.length);
  }
});

test('refuses to write a file that names a person (AC 7)', () => {
  // A copy of the generator whose personas.json names a person "Wallet", a word the seed uses.
  const dir = tempDir();
  copyFileSync(join(SEED_DIR, 'generate.mjs'), join(dir, 'generate.mjs'));
  const personas = readJson(join(SEED_DIR, 'personas.json'));
  personas.roles[0].persona = 'Wallet';
  writeFileSync(join(dir, 'personas.json'), JSON.stringify(personas));
  const run = runNode(join(dir, 'generate.mjs'));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Refusing to write forewarned-demo\.json: person name "Wallet"/);
  assert.equal(existsSync(join(dir, DEMO_FILE)), false);
});
