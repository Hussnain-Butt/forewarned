// The judge setup guide (story 010 AC 1, 3, 4, 5): Codegeist's Stage 1 needs step-by-step judge
// instructions, and judges follow them on their own fresh site. These checks keep the guide's
// sections in order, its images present and its text free of secrets and of our own demo site,
// so later edits (screenshot retakes, copy fixes) can't quietly break it.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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

test('troubleshooting has at least 10 entries, including the ones AC 1.7 names', () => {
  const text = section('Troubleshooting');
  // An entry is a level-3 heading or a table body row (not the header row or its separator).
  const rows = text.split(/\r?\n/).filter((line) => line.startsWith('| ') && !/^\|\s*-/.test(line));
  const tableEntries = Math.max(rows.length - 1, 0);
  const headingEntries = text.split(/\r?\n/).filter((line) => line.startsWith('### ')).length;
  assert.ok(tableEntries + headingEntries >= 10, `found ${tableEntries + headingEntries} entries`);
  for (const word of ['epic', 'daily limit', 'Retrieving projects', 'Rovo', 'Confluence']) {
    assert.match(text, new RegExp(word, 'i'), `troubleshooting mentions "${word}"`);
  }
});

test('the guide holds no secret, personal email or placeholder (AC 4)', () => {
  assert.ok(guide.length > 0, 'the guide exists');
  assert.doesNotMatch(guide, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'no email address');
  assert.doesNotMatch(guide, /gho_|ghp_|ATATT/, 'no GitHub or Atlassian token');
  assert.doesNotMatch(guide, /TODO|TBD|‹/, 'no placeholder');
});

test("the guide doesn't depend on our demo site or the development environment", () => {
  assert.ok(guide.length > 0, 'the guide exists');
  assert.doesNotMatch(guide, /one-atlas-yexa/);
  assert.doesNotMatch(guide, /-e development|\(development\)/);
});

test('every image in the guide exists', () => {
  const images = [...guide.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => match[1]);
  for (const path of images.filter((p) => !/^https?:/.test(p))) {
    assert.ok(existsSync(new URL(path, GUIDE_URL)), `image ${path} exists`);
  }
});

test('the guide links the install link and the public seed file (AC 3, 5)', () => {
  assert.match(guide, /https:\/\/developer\.atlassian\.com\/console\/install\/\S+/);
  assert.match(guide, /https:\/\/github\.com\/Hussnain-Butt\/forewarned\//);
});
