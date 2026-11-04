// What the Confluence pre-mortem page holds (story 007 AC 3–10): its title, the success factors and
// the ADF body in the structure of Atlassian's premortem template, as pure functions.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageDoc, pageTitle, successFactors } from '../../src/premortem/page-content.js';

const SITE = 'https://one-atlas.example';
const url = (key) => `${SITE}/browse/${key}`;
const link = (key, summary) => ({ key, summary, url: url(key) });
const EPIC = 'CHK-12';

const evidence = [
  { id: 'E1', baseRate: true, fact: '5 of 6 comparable epics finished late.', links: [link('CHK-7', 'Wallet top-up'), link('CHK-12', 'Checkout v2 launch')] },
  { id: 'E2', baseRate: false, fact: 'PLT-31 blocks CHK-12 and is still open.', links: [link('PLT-31', 'Token service'), link('CHK-12', 'Checkout v2 launch')] },
  { id: 'E3', baseRate: false, fact: 'CHK-12 started with 15 work items.', links: [link('CHK-12', 'Checkout v2 launch')] },
];
const reasons = [
  { title: 'PLT work could block Checkout v2 launch', likelihood: 'High', explanation: 'PLT-31 blocks CHK-12 and is still open.', evidenceIds: ['E2', 'E1'], mitigation: 'Agree a date for PLT-31 with PLT.', baseRateFact: '5 of 6 comparable epics finished late.' },
  { title: 'Scope keeps growing', likelihood: 'Medium', explanation: 'CHK-12 started with 15 work items.', evidenceIds: ['E3'], mitigation: 'Freeze the scope.' },
];
const comparison = {
  rule: 'same components',
  epics: [
    { key: 'CHK-3', summary: 'Checkout v1', url: url('CHK-3'), due: '2026-03-01', finish: '2026-02-26', daysLate: -3 },
    { key: 'CHK-4', summary: 'Wallet', url: url('CHK-4'), due: '2026-04-01', finish: '2026-04-01', daysLate: 0 },
    { key: 'CHK-5', summary: 'Refunds', url: url('CHK-5'), due: '2026-05-01', finish: '2026-05-06', daysLate: 5 },
    { key: 'CHK-6', summary: 'Gift cards', url: url('CHK-6'), due: null, finish: '2026-06-01', daysLate: null },
  ],
};
const checks = {
  slip: { status: 'found', note: '' },
  scope: { status: 'found', note: 'CHK-12 has gained 6 since its start.' },
  load: { status: 'insufficient', note: 'No work items in this epic are assigned yet.' },
  dependencies: { status: 'clear', note: 'No open blockers.' },
};
const task = (key, extra = {}) => ({ key, url: url(key), owner: 'Hira (demo)', due: '2026-12-12', status: 'In Progress', ...extra });

const input = (overrides = {}) => ({
  epic: { key: EPIC, url: url(EPIC), summary: 'Checkout v2 launch', status: 'In Progress', due: '2026-12-12', assignee: null },
  headline: "It's 12 Dec 2026, and Checkout v2 launch has failed. Here's why.",
  comparison,
  space: 'CHK',
  source: 'rule',
  reasons,
  evidence,
  plan: [{ action: reasons[0].mitigation, task: task('CHK-901') }, { action: reasons[1].mitigation, task: null }],
  checks,
  writtenOn: '4 Nov 2026',
  ...overrides,
});

// Every node of the document, depth first.
const nodes = (node) => [node, ...(node.content ?? []).flatMap(nodes)];
const textOf = (node) => nodes(node).filter((n) => n.type === 'text').map((n) => n.text).join('');
const hrefs = (node) => nodes(node).flatMap((n) => (n.marks ?? []).filter((m) => m.type === 'link').map((m) => m.attrs.href));
const headings = (doc) => nodes(doc).filter((n) => n.type === 'heading').map((n) => [n.attrs.level, textOf(n)]);
// The table whose header row starts with `first`, as rows of cells (the header row included).
const tableStarting = (doc, first) => {
  const table = nodes(doc).find((n) => n.type === 'table' && textOf(n.content[0].content[0]) === first);
  return table && table.content.map((row) => row.content);
};
// The top-level nodes between a heading and the next heading of the same or a higher level.
const section = (doc, title) => {
  const start = doc.content.findIndex((n) => n.type === 'heading' && textOf(n) === title);
  const level = doc.content[start].attrs.level;
  const end = doc.content.findIndex((n, i) => i > start && n.type === 'heading' && n.attrs.level <= level);
  return { type: 'section', content: doc.content.slice(start + 1, end < 0 ? undefined : end) };
};

test('title', () => {
  assert.equal(pageTitle('Checkout v2 launch', 'CHK-12'), 'Pre-mortem: Checkout v2 launch (CHK-12)');
  assert.equal(pageTitle('Checkout v2 launch', 'CHK-12', '6 Dec 2026'), 'Pre-mortem: Checkout v2 launch (CHK-12) (6 Dec 2026)');
  const long = pageTitle('word '.repeat(60).trim(), 'CHK-12', '6 Dec 2026');
  assert.ok(Array.from(long).length <= 255, `${Array.from(long).length} characters`);
  assert.ok(long.endsWith('… (CHK-12) (6 Dec 2026)'), long);
});

test('success factors', () => {
  const factors = successFactors(comparison, checks);
  assert.equal(factors.length, 3);
  assert.equal(factors[0].key, 'CHK-3');
  assert.equal(factors[0].url, url('CHK-3'));
  assert.match(factors[0].text, /^CHK-3 Checkout v1 finished 3 days early/);
  assert.match(factors[1].text, /^CHK-4 Wallet finished on time/);
  assert.equal(factors[2].text, 'Dependencies: No open blockers.');
  assert.equal(factors[2].key, undefined);
  assert.deepEqual(successFactors({ rule: 'x', epics: [comparison.epics[2], comparison.epics[3]] }, { slip: { status: 'found', note: '' } }), []);
});

test("sections in the template's order", () => {
  const doc = pageDoc(input());
  assert.equal(doc.type, 'doc');
  assert.equal(doc.version, 1);
  assert.deepEqual(headings(doc), [
    [2, 'Project overview'], [2, 'Brainstorm'], [3, 'What could go wrong'], [3, 'What could go right'],
    [2, 'Make a plan'], [2, 'How this pre-mortem was made'],
  ]);
  const note = doc.content[0];
  assert.equal(note.type, 'panel');
  assert.equal(note.attrs.panelType, 'info');
  assert.match(textOf(note), /^Created by Forewarned from Jira history on 4 Nov 2026\. Every reason links to its evidence in Jira\./);
  assert.match(textOf(note), /Reasons: from your Jira history \(rule-based, no AI\)\.$/);
  assert.match(textOf(pageDoc(input({ source: 'agent' })).content[0]), /Reasons: written by the Forewarned agent in Rovo and checked against the evidence\.$/);
});

test('overview', () => {
  const overview = section(pageDoc(input()), 'Project overview');
  const words = textOf(overview);
  assert.ok(hrefs(overview).includes(url(EPIC)));
  for (const line of ['CHK-12 Checkout v2 launch', 'Status: In Progress', 'Due date: 12 Dec 2026', 'Assignee: Unassigned',
    "It's 12 Dec 2026, and Checkout v2 launch has failed. Here's why.", 'Compared with 4 finished epics in CHK (same components)']) {
    assert.ok(words.includes(line), `missing "${line}"`);
  }
  const other = textOf(section(pageDoc(input({ epic: { ...input().epic, due: null, assignee: 'Ada Isadora' } })), 'Project overview'));
  assert.ok(other.includes('Due date: No due date'));
  assert.ok(other.includes('Assignee: Ada Isadora'));
});

test('what could go wrong', () => {
  const rows = tableStarting(pageDoc(input()), '#');
  assert.deepEqual(rows[0].map(textOf), ['#', 'Reason', 'Likelihood', 'Base rate', 'Evidence', 'Mitigation']);
  assert.equal(rows.length, 3);
  const [number, reason, likelihood, baseRate, cited, mitigation] = rows[1];
  assert.equal(textOf(number), '1');
  assert.ok(textOf(reason).startsWith('PLT work could block Checkout v2 launch'));
  assert.equal(textOf(likelihood), 'High');
  assert.equal(textOf(baseRate), '5 of 6 comparable epics finished late.');
  assert.ok(textOf(cited).startsWith('E2, E1'));
  assert.deepEqual(hrefs(cited), [url('PLT-31'), url('CHK-7')], 'every cited work item is a link, the epic never');
  assert.equal(textOf(mitigation), 'Agree a date for PLT-31 with PLT.');

  const long = 'Wraps. '.repeat(300).trim();
  const wide = tableStarting(pageDoc(input({ reasons: [{ ...reasons[1], explanation: long }] })), '#');
  assert.ok(textOf(wide[1][1]).includes(long), 'a long explanation is kept whole');

  const none = section(pageDoc(input({ reasons: [], plan: [] })), 'What could go wrong');
  assert.equal(textOf(none), 'No failure reasons in this report. See how this pre-mortem was made below.');
});

test('what could go right', () => {
  const right = section(pageDoc(input()), 'What could go right');
  assert.ok(textOf(right).includes('CHK-3 Checkout v1 finished 3 days early'));
  assert.ok(textOf(right).includes('Dependencies: No open blockers.'));
  assert.ok(hrefs(right).includes(url('CHK-3')));
  const empty = section(pageDoc(input({ comparison: { rule: 'x', epics: [] }, checks: { slip: { status: 'found', note: '' } } })), 'What could go right');
  assert.equal(textOf(empty), 'No success patterns found in this history yet. Add your own.');
});

test('make a plan', () => {
  const plan = [
    { action: 'Agree a date for PLT-31 with PLT.', task: task('CHK-901') },
    { action: 'Freeze the scope.', task: task('CHK-902', { owner: null, due: null, status: 'To Do' }) },
    { action: 'Spread the load.', task: null },
  ];
  const table = nodes(section(pageDoc(input({ plan })), 'Make a plan')).find((n) => n.type === 'table').content.map((row) => row.content);
  assert.deepEqual(table[0].map(textOf), ['#', 'Action', 'Task', 'Owner', 'Due date', 'Status']);
  assert.deepEqual(table[1].map(textOf), ['1', 'Agree a date for PLT-31 with PLT.', 'CHK-901', 'Hira (demo)', '12 Dec 2026', 'In Progress']);
  assert.deepEqual(hrefs(table[1][2]), [url('CHK-901')]);
  assert.deepEqual(table[2].map(textOf), ['2', 'Freeze the scope.', 'CHK-902', 'Unassigned', 'No due date', 'To Do']);
  assert.deepEqual(table[3].map(textOf), ['3', 'Spread the load.', 'No task yet', '', '', '']);
  const none = section(pageDoc(input({ reasons: [], plan: [] })), 'Make a plan');
  assert.equal(textOf(none), 'No action items yet.');
});

test('how it was made', () => {
  const made = section(pageDoc(input()), 'How this pre-mortem was made');
  const words = textOf(made);
  assert.ok(words.includes('Scope growth: Found. CHK-12 has gained 6 since its start.'));
  assert.ok(words.includes('Dependencies: Clear. No open blockers.'));
  assert.ok(words.includes('E1: 5 of 6 comparable epics finished late.'));
  assert.ok(words.includes('E3: CHK-12 started with 15 work items.'));
  assert.ok(hrefs(made).includes(url('PLT-31')));
  assert.ok(!hrefs(made).includes(url(EPIC)), 'the epic itself is not repeated as evidence');
});

// Polish (QA 007): equal columns left the Reason column so narrow that each row ran very tall.
test('the tables give their long text the wide columns', () => {
  const tables = nodes(pageDoc(input())).filter((n) => n.type === 'table');
  assert.equal(tables.length, 2);
  const widths = tables.map((t) => t.content[0].content.map((cell) => cell.attrs.colwidth?.[0]));
  for (const row of widths) {
    assert.ok(row.every(Number.isInteger), `every column has a width: ${row}`);
    assert.ok(row.reduce((a, b) => a + b) <= 760, "they fit Confluence's default page width");
  }
  assert.ok(widths[0][1] >= 2 * widths[0][2], 'Reason is much wider than Likelihood');
  assert.ok(widths[1][1] >= 2 * widths[1][2], 'Action is much wider than Task');
  // Seen on the site at 80 / 90 / 110 px: "Likeliho-od", "No task / yet" and "No due / date" broke.
  assert.ok(widths[0][2] >= 96, '"Likelihood" fits on one line');
  assert.ok(widths[1][2] >= 100, '"No task yet" fits on one line');
  assert.ok(widths[1][4] >= 120, '"No due date" fits on one line');
  for (const t of tables) {
    for (const row of t.content) row.content.forEach((cell, i) => assert.deepEqual(cell.attrs.colwidth, t.content[0].content[i].attrs.colwidth));
  }
});

test('ADF is valid for Confluence', () => {
  for (const doc of [pageDoc(input()), pageDoc(input({ reasons: [], plan: [], comparison: { rule: 'x', epics: [] } }))]) {
    for (const node of nodes(doc)) {
      assert.ok(node.type, 'every node has a type');
      if (node.type === 'text') assert.ok(node.text, 'no empty text node');
    }
    assert.ok(!JSON.stringify(doc).includes('undefined'));
  }
});
