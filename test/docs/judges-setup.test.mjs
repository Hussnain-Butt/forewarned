// The judge setup guide (story 010 AC 1, 3, 4, 5): Codegeist's Stage 1 needs step-by-step judge
// instructions, and judges follow them on their own fresh site. These checks keep the guide's
// sections in order, its images present and its text free of secrets and of our own demo site,
// so later edits (screenshot retakes, copy fixes) can't quietly break it.

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const GUIDE_URL = new URL('../../JUDGES_SETUP.md', import.meta.url);
const guide = existsSync(GUIDE_URL) ? await readFile(GUIDE_URL, 'utf8') : '';

const SECTIONS = [
  'What you need',
  'Install',
  'First run on a fresh site',
  'Optional demo history',
  'Expected results with the demo history',
  'Rovo agent',
  'Troubleshooting',
  'Privacy and data',
  'Remove it',
];

// The text of one level-2 section, up to the next level-2 heading.
function section(title) {
  const lines = guide.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `## ${title}`);
  assert.ok(start >= 0, `the guide has a "## ${title}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

test('the guide has the nine sections in order (AC 1)', () => {
  const headings = guide.split(/\r?\n/).filter((line) => line.startsWith('## ')).map((line) => line.slice(3));
  assert.deepEqual(headings, SECTIONS);
});

// Story 010 AC 1.7: each named problem has its own row, found by its symptom (the first cell), so
// a word that also appears in another row's fix can't stand in for a deleted row.
const AC_17_SYMPTOMS = {
  'panel not visible: epics only': /panel on a story or task/,
  'Run disabled: edit permission': /permission to edit this epic/,
  'daily limit reached': /has run \d+ pre-mortems on this site today/,
  'Rovo off': /Rovo isn't turned on/,
  'Confluence not available': /Confluence isn't available/,
  'import fails at "Retrieving projects"': /Retrieving projects/,
  'leftover sample work items': /[Ll]eftover sample work items/,
  'dates look shifted': /Dates look shifted/,
  "the agent didn't save": /agent didn't save/,
  'tasks not visible until reload': /Reload the page to see the new tasks/,
};

test('troubleshooting has at least 10 rows, one for each problem AC 1.7 names', () => {
  const rows = section('Troubleshooting').split(/\r?\n/).filter((line) => line.startsWith('| ')).slice(1);
  const symptoms = rows.map((row) => row.split('|')[1]);
  assert.ok(symptoms.length >= 10, `found ${symptoms.length} rows`);
  for (const [problem, pattern] of Object.entries(AC_17_SYMPTOMS)) {
    assert.ok(symptoms.some((symptom) => pattern.test(symptom)), `a row's symptom covers "${problem}"`);
  }
});

test('the guide holds no secret, personal email or placeholder (AC 4)', () => {
  assert.ok(guide.length > 0, 'the guide exists');
  assert.doesNotMatch(guide, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'no email address');
  assert.doesNotMatch(guide, /gho_|ghp_|ATATT/, 'no GitHub or Atlassian token');
  assert.doesNotMatch(guide, /TODO|TBD|FIXME|XXX|\bCHECK\b|‹/, 'no placeholder or draft marker');
});

test("the guide doesn't depend on our demo site or the development environment", () => {
  assert.ok(guide.length > 0, 'the guide exists');
  assert.doesNotMatch(guide, /one-atlas-yexa/);
  assert.doesNotMatch(guide, /-e development|\(development\)/);
});

// AC 2: the three screenshots (install, first run, report) are in the guide, and each relative
// image exists with exactly this spelling: Windows ignores case, GitHub doesn't.
test('the guide shows its 3 screenshots, each spelled exactly as the file', () => {
  const images = [...guide.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]);
  const local = images.filter((p) => !/^https?:/.test(p));
  assert.ok(local.length >= 3, `found ${local.length} images`);
  for (const path of local) {
    const file = new URL(path, GUIDE_URL);
    const name = path.split('/').pop();
    assert.ok(existsSync(file), `image ${path} exists`);
    assert.ok(readdirSync(new URL('.', file)).includes(name), `image ${path} is spelled as on disk`);
  }
});

test('the guide links the install link and the public seed file (AC 3, 5)', () => {
  assert.match(guide, /https:\/\/developer\.atlassian\.com\/console\/install\/\S+/);
  assert.match(guide, /https:\/\/github\.com\/Hussnain-Butt\/forewarned\//);
});
