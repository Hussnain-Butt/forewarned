// The Confluence pre-mortem page (story 007): the spaces the user can create pages in, and the page
// written as the user from the reader-filtered report, created once and then updated.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPremortemAction, submitPremortemAction } from '../../src/premortem/actions.js';
import { installedInConfluence, listSpacesAction, writePageAction } from '../../src/premortem/confluence.js';
import { handleRun } from '../../src/premortem/consumer.js';
import { getPanelData } from '../../src/premortem/panel.js';
import { createTasksAction } from '../../src/premortem/tasks.js';
import { CONFLUENCE_UNAVAILABLE } from '../../src/frontend/text.js';
import { keyOf } from '../engine/seed-snapshot.mjs';
import { fakeConfluence, fakeKvs, fakeQueue, fakeSenders, idOf, portOf, storedOf } from './fakes.mjs';

const EPIC = keyOf('ll-chk-e11');
const EPIC_ID = await idOf(EPIC);
const BLOCKER = keyOf('un-plt-e03-07');
const NOW = Date.parse('2026-11-02T08:00:00.000Z');
const UPGRADE = 'Ask your admin to update Forewarned in Confluence.';

// acc-1 runs the pre-mortem on the seed epic.
async function withRun(kvs = fakeKvs()) {
  const builder = fakeSenders();
  const deps = { port: portOf(builder.senders), kvs, queue: fakeQueue(kvs), now: () => NOW, newId: () => 'r1', log: () => {} };
  await runPremortemAction({ deps, epicKey: EPIC, accountId: 'acc-1' });
  await handleRun({ event: { body: { runId: 'r1', epicKey: EPIC, epicId: EPIC_ID, accountId: 'acc-1' } }, senders: builder.senders, kvs, now: () => NOW, log: () => {} });
  return kvs;
}

const depsFor = ({ kvs, confluence, jira = {}, installed = true }) => ({
  port: portOf(fakeSenders(jira).senders), confluence: portOf(confluence.senders), kvs, now: () => NOW, installed,
});
const write = (deps, spaceId = '102') => writePageAction({ deps, epicKey: EPIC, accountId: 'acc-1', spaceId });
const titleOf = (kvs) => `Pre-mortem: ${storedOf(kvs, EPIC_ID).pack.epic.summary} (${EPIC})`;

// The page body that a create or update sent, and the rows of the table under a heading.
const docOf = (body) => JSON.parse(body.body.value);
const nodes = (node) => [node, ...(node.content ?? []).flatMap(nodes)];
const textOf = (node) => nodes(node).filter((n) => n.type === 'text').map((n) => n.text).join('');
function tableAfter(doc, title) {
  const start = doc.content.findIndex((n) => n.type === 'heading' && textOf(n) === title);
  const table = doc.content.slice(start + 1).find((n) => n.type === 'table' || n.type === 'heading');
  return table.type === 'table' ? table.content.map((row) => row.content.map(textOf)) : null;
}

test('lists the spaces where the user can create pages, by name', async () => {
  const kvs = await withRun();
  const result = await listSpacesAction({ deps: depsFor({ kvs, confluence: fakeConfluence() }), epicKey: EPIC });
  assert.deepEqual(result, { spaces: [{ id: '102', key: 'ALPHA', name: 'Alpha' }, { id: '101', key: 'ZETA', name: 'Zeta' }], defaultSpaceId: null });

  const many = Array.from({ length: 60 }, (_, i) => ({ id: String(200 + i), key: `S${i}`, name: `Space ${String(i).padStart(2, '0')}`, type: 'global' }));
  const big = await listSpacesAction({ deps: depsFor({ kvs, confluence: fakeConfluence({ spaces: many, creatable: many.map((s) => s.id) }) }), epicKey: EPIC });
  assert.equal(big.spaces.length, 50);
  assert.equal(big.spaces[0].name, 'Space 00');
});

test('the space last used for this epic is the default', async () => {
  const kvs = await withRun();
  const confluence = fakeConfluence();
  await write(depsFor({ kvs, confluence }), '101');
  assert.equal((await listSpacesAction({ deps: depsFor({ kvs, confluence }), epicKey: EPIC })).defaultSpaceId, '101');
});

test('no space to create in gives an empty list', async () => {
  const kvs = await withRun();
  const result = await listSpacesAction({ deps: depsFor({ kvs, confluence: fakeConfluence({ creatable: [] }) }), epicKey: EPIC });
  assert.deepEqual(result, { spaces: [], defaultSpaceId: null });
});

test('without Confluence nothing is asked of it', async () => {
  const kvs = await withRun();
  const confluence = fakeConfluence();
  const deps = depsFor({ kvs, confluence, installed: false });
  assert.deepEqual(await listSpacesAction({ deps, epicKey: EPIC }), { error: CONFLUENCE_UNAVAILABLE, unavailable: true });
  assert.deepEqual(await write(deps), { error: CONFLUENCE_UNAVAILABLE, unavailable: true });
  assert.deepEqual(confluence.requests, []);
});

test('an install without the new scope asks for an update', async () => {
  const kvs = await withRun();
  const listed = await listSpacesAction({ deps: depsFor({ kvs, confluence: fakeConfluence({ fail: { spaces: 401 } }) }), epicKey: EPIC });
  assert.equal(listed.error, `${CONFLUENCE_UNAVAILABLE} ${UPGRADE}`);
  assert.equal(listed.unavailable, true);
  const written = await write(depsFor({ kvs, confluence: fakeConfluence({ fail: { pagesByTitle: 401 } }) }));
  assert.equal(written.error, `${CONFLUENCE_UNAVAILABLE} ${UPGRADE}`);
  assert.equal(written.unavailable, true);
});

test('a busy Confluence says so', async () => {
  const kvs = await withRun();
  const listed = await listSpacesAction({ deps: depsFor({ kvs, confluence: fakeConfluence({ fail: { spaces: 429 } }) }), epicKey: EPIC });
  assert.deepEqual(listed, { error: 'Confluence is busy right now. Try again in a minute.' });
});

test('creates the page as ADF in the chosen space', async () => {
  const kvs = await withRun();
  const confluence = fakeConfluence();
  const result = await write(depsFor({ kvs, confluence }));
  assert.equal(confluence.created.length, 1);
  const [body] = confluence.created;
  assert.equal(body.spaceId, '102');
  assert.equal(body.status, 'current');
  assert.equal(body.title, titleOf(kvs));
  assert.equal(body.body.representation, 'atlas_doc_format');
  assert.equal(docOf(body).type, 'doc');
  assert.deepEqual({ updated: result.updated, dated: result.dated, source: result.source }, { updated: false, dated: false, source: 'rule' });
  assert.deepEqual(result.page, { id: '7001', url: 'https://seed.example/wiki/spaces/ALPHA/pages/7001', title: titleOf(kvs), spaceId: '102', spaceName: 'Alpha' });
  const stored = kvs.data.get(`page:${EPIC_ID}`).value;
  assert.deepEqual({ id: stored.id, spaceId: stored.spaceId, spaceName: stored.spaceName, url: stored.url, by: stored.by }, { id: '7001', spaceId: '102', spaceName: 'Alpha', url: result.page.url, by: 'acc-1' });
});

test('writing again updates the same page', async () => {
  const kvs = await withRun();
  const confluence = fakeConfluence();
  await write(depsFor({ kvs, confluence }));
  const again = await write(depsFor({ kvs, confluence }));
  assert.equal(confluence.created.length, 1);
  assert.equal(confluence.updated.length, 1);
  const [{ id, body }] = confluence.updated;
  assert.equal(id, '7001');
  assert.equal(body.version.number, 2);
  assert.equal(body.title, titleOf(kvs));
  assert.equal(body.status, 'current');
  assert.equal(body.body.representation, 'atlas_doc_format');
  assert.equal(again.updated, true);
  assert.equal(again.page.id, '7001');
});

test('a deleted page is created again', async () => {
  const kvs = await withRun();
  const confluence = fakeConfluence();
  await write(depsFor({ kvs, confluence }));
  confluence.pages.splice(0);
  const again = await write(depsFor({ kvs, confluence }));
  assert.equal(confluence.created.length, 2);
  assert.equal(again.updated, false);
  assert.equal(kvs.data.get(`page:${EPIC_ID}`).value.id, '7002');
});

test('another space gets a new page', async () => {
  const kvs = await withRun();
  const confluence = fakeConfluence();
  await write(depsFor({ kvs, confluence }), '102');
  const moved = await write(depsFor({ kvs, confluence }), '101');
  assert.equal(confluence.created.length, 2);
  assert.equal(confluence.updated.length, 0);
  assert.equal(moved.page.spaceName, 'Zeta');
  assert.equal(kvs.data.get(`page:${EPIC_ID}`).value.spaceId, '101');
});

test('a title taken by another page gets the date', async () => {
  const kvs = await withRun();
  const confluence = fakeConfluence({ pages: [{ id: '999', status: 'current', title: titleOf(kvs), spaceId: '102', version: { number: 3 } }] });
  const result = await write(depsFor({ kvs, confluence }));
  assert.equal(confluence.created[0].title, `${titleOf(kvs)} (2 Nov 2026)`);
  assert.equal(result.dated, true);
});

test('a dated title that is taken too is refused', async () => {
  const kvs = await withRun();
  const dated = `${titleOf(kvs)} (2 Nov 2026)`;
  const confluence = fakeConfluence({ pages: [
    { id: '998', status: 'current', title: titleOf(kvs), spaceId: '102', version: { number: 1 } },
    { id: '999', status: 'current', title: dated, spaceId: '102', version: { number: 1 } },
  ] });
  assert.deepEqual(await write(depsFor({ kvs, confluence })), { error: `Alpha already has a page called "${dated}". Rename that page, or pick another space.` });
  assert.equal(confluence.created.length, 0);
});

test('no permission in the space', async () => {
  const kvs = await withRun();
  assert.deepEqual(await write(depsFor({ kvs, confluence: fakeConfluence({ fail: { createPage: 404 } }) })),
    { error: "You can't create pages in Alpha. Pick another space or ask its admin." });
});

test('a create that fails with 5xx is not retried', async () => {
  const kvs = await withRun();
  const confluence = fakeConfluence({ fail: { createPage: 500 } });
  assert.deepEqual(await write(depsFor({ kvs, confluence })), { error: "Confluence didn't confirm the page. Check Alpha before you try again." });
  assert.equal(confluence.requests.filter((name) => name === 'createPage').length, 1);
  assert.equal(kvs.data.get(`page:${EPIC_ID}`), undefined);
});

test('an edit made at the same moment is reported', async () => {
  const kvs = await withRun();
  const confluence = fakeConfluence();
  await write(depsFor({ kvs, confluence }));
  const raced = await write(depsFor({ kvs, confluence: { ...confluence, senders: { ...confluence.senders, updatePage: async () => new Response('{}', { status: 409 }) } } }));
  assert.deepEqual(raced, { error: 'Someone changed the page while Forewarned was writing it. Try again.' });
});

test('the page uses the agent write-up when it is current', async () => {
  const kvs = await withRun();
  const { pack } = storedOf(kvs, EPIC_ID);
  const slip = pack.evidence.find((e) => e.type === 'slip-base-rate');
  const reason = { title: 'History says late', likelihood: 'High', explanation: slip.fact, evidenceIds: [slip.id], mitigation: 'Plan for the usual slip.' };
  const saved = await submitPremortemAction({ deps: { port: portOf(fakeSenders().senders), kvs, now: () => NOW + 1000 }, epicKey: EPIC, accountId: 'acc-1', packId: pack.packId, reasonsJson: JSON.stringify([reason]) });
  assert.equal(saved.saved, true, JSON.stringify(saved));

  const confluence = fakeConfluence();
  const result = await write(depsFor({ kvs, confluence }));
  assert.equal(result.source, 'agent');
  assert.deepEqual(tableAfter(docOf(confluence.created[0]), 'What could go wrong').slice(1).map((row) => row[1].startsWith('History says late')), [true]);

  // A re-run with other evidence leaves the write-up stale, so the page goes back to the rules.
  storedOf(kvs, EPIC_ID).report.agent.packId = 'older';
  const stale = await write(depsFor({ kvs, confluence }));
  assert.equal(stale.source, 'rule');
});

test("the page leaves out what the writer can't see", async () => {
  const kvs = await withRun();
  const dependency = storedOf(kvs, EPIC_ID).report.ruleBased.reasons.find((r) => r.ruleId === 'dependency');
  assert.ok(dependency, 'the seed has a dependency reason');
  const confluence = fakeConfluence();
  await write(depsFor({ kvs, confluence, jira: { hidden: [BLOCKER] } }));
  const sent = JSON.stringify(confluence.created[0]);
  assert.ok(!sent.includes(BLOCKER), 'no hidden work item key');
  assert.ok(!sent.includes(dependency.title), 'no reason that cites it');
});

test('make a plan reads the tasks from Jira', async () => {
  const jira = { created: [], deleted: [] };
  const kvs = await withRun();
  const panel = await getPanelData({ deps: { port: portOf(fakeSenders(jira).senders), kvs, now: () => NOW }, epicKey: EPIC, accountId: 'acc-1' });
  const reasons = panel.report.ruleBased.reasons;
  await createTasksAction({ deps: { port: portOf(fakeSenders(jira).senders), kvs, now: () => NOW, deadline: Infinity }, epicKey: EPIC, accountId: 'acc-1', fingerprints: reasons.slice(0, 2).map((r) => r.fingerprint) });
  jira.created[0].fields = { assignee: { displayName: 'Hira (demo)' }, duedate: '2026-12-12', status: { name: 'In Progress' } };

  const confluence = fakeConfluence();
  await write(depsFor({ kvs, confluence, jira }));
  const rows = tableAfter(docOf(confluence.created[0]), 'Make a plan');
  assert.deepEqual(rows[1], ['1', reasons[0].mitigation, 'CHK-901', 'Hira (demo)', '12 Dec 2026', 'In Progress']);
  assert.deepEqual(rows[2], ['2', reasons[1].mitigation, 'CHK-902', 'Unassigned', 'No due date', 'To Do']);
  assert.ok(rows.slice(3).every((row) => row[2] === 'No task yet'));
  assert.equal(rows.length, reasons.length + 1);

  jira.deleted.push('CHK-901');
  await write(depsFor({ kvs, confluence, jira }));
  assert.equal(tableAfter(docOf(confluence.updated[0].body), 'Make a plan')[1][2], 'No task yet');
});

test('tasks of reasons not on the page are in the plan too', async () => {
  const jira = { created: [], deleted: [] };
  const kvs = await withRun();
  const panel = await getPanelData({ deps: { port: portOf(fakeSenders(jira).senders), kvs, now: () => NOW }, epicKey: EPIC, accountId: 'acc-1' });
  await createTasksAction({ deps: { port: portOf(fakeSenders(jira).senders), kvs, now: () => NOW, deadline: Infinity }, epicKey: EPIC, accountId: 'acc-1', fingerprints: [panel.report.ruleBased.reasons[0].fingerprint] });
  const { pack } = storedOf(kvs, EPIC_ID);
  const slip = pack.evidence.find((e) => e.type === 'slip-base-rate');
  await submitPremortemAction({ deps: { port: portOf(fakeSenders().senders), kvs, now: () => NOW + 1000 }, epicKey: EPIC, accountId: 'acc-1', packId: pack.packId,
    reasonsJson: JSON.stringify([{ title: 'History says late', likelihood: 'High', explanation: slip.fact, evidenceIds: [slip.id], mitigation: 'Plan for the usual slip.' }]) });

  const confluence = fakeConfluence();
  await write(depsFor({ kvs, confluence, jira }));
  const rows = tableAfter(docOf(confluence.created[0]), 'Make a plan');
  assert.deepEqual(rows.map((row) => row[2]), ['Task', 'No task yet', 'CHK-901']);
  assert.equal(rows[2][1], jira.created[0].body.fields.summary);
});

// AC 14 (at most 10 s): every request waits for the next "wave", so the count of waves is the number of
// round trips one after another. Reads that don't depend on each other must share a wave.
function waves() {
  const pending = [];
  const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((done) => { setImmediate(done); }); };
  return {
    wrap: (senders) => Object.fromEntries(Object.entries(senders).map(([name, send]) => [name, (...args) => new Promise((done) => { pending.push(() => done(send(...args))); })])),
    async count(promise) {
      let finished = false;
      promise.then(() => { finished = true; }, () => { finished = true; });
      let rounds = 0;
      for (await settle(); !finished; await settle()) {
        if (pending.length) {
          rounds += 1;
          pending.splice(0).forEach((go) => go());
        }
      }
      await promise;
      return rounds;
    },
  };
}

test('an update reads everything it needs at once, then writes', async () => {
  const jira = { created: [], deleted: [] };
  const kvs = await withRun();
  const panel = await getPanelData({ deps: { port: portOf(fakeSenders(jira).senders), kvs, now: () => NOW }, epicKey: EPIC, accountId: 'acc-1' });
  await createTasksAction({ deps: { port: portOf(fakeSenders(jira).senders), kvs, now: () => NOW, deadline: Infinity }, epicKey: EPIC, accountId: 'acc-1', fingerprints: [panel.report.ruleBased.reasons[0].fingerprint] });
  const confluence = fakeConfluence();
  await write(depsFor({ kvs, confluence, jira }));

  const gate = waves();
  const deps = { port: portOf(gate.wrap(fakeSenders(jira).senders)), confluence: portOf(gate.wrap(confluence.senders)), kvs, now: () => NOW, installed: true };
  assert.equal(await gate.count(write(deps)), 3, 'the epic; then its fields, evidence, comparison, tasks, space and page together; then the update');
  assert.equal(confluence.updated.length, 1);
});

test('a create adds only the title check', async () => {
  const jira = { created: [], deleted: [] };
  const kvs = await withRun();
  const panel = await getPanelData({ deps: { port: portOf(fakeSenders(jira).senders), kvs, now: () => NOW }, epicKey: EPIC, accountId: 'acc-1' });
  await createTasksAction({ deps: { port: portOf(fakeSenders(jira).senders), kvs, now: () => NOW, deadline: Infinity }, epicKey: EPIC, accountId: 'acc-1', fingerprints: [panel.report.ruleBased.reasons[0].fingerprint] });
  const confluence = fakeConfluence();
  const gate = waves();
  const deps = { port: portOf(gate.wrap(fakeSenders(jira).senders)), confluence: portOf(gate.wrap(confluence.senders)), kvs, now: () => NOW, installed: true };
  assert.equal(await gate.count(write(deps)), 4, 'the epic; the reads together; the title check; the create');
  assert.equal(confluence.created.length, 1);
});

test('bad input', async () => {
  const kvs = await withRun();
  const deps = depsFor({ kvs, confluence: fakeConfluence() });
  assert.deepEqual(await write(deps, 'abc'), { error: 'Choose a Confluence space first.' });
  assert.deepEqual(await writePageAction({ deps, epicKey: EPIC, accountId: 'acc-1' }), { error: 'Choose a Confluence space first.' });
  assert.deepEqual(await write(depsFor({ kvs: fakeKvs(), confluence: fakeConfluence() })), { error: 'Run the pre-mortem first.' });
  const hidden = depsFor({ kvs, confluence: fakeConfluence(), jira: { hidden: [EPIC] } });
  assert.deepEqual(await write(hidden), { error: `${EPIC} doesn't exist, or you don't have permission to see it.` });
  assert.deepEqual(await listSpacesAction({ deps: hidden, epicKey: EPIC }), { error: `${EPIC} doesn't exist, or you don't have permission to see it.` });
});

test('installedInConfluence', () => {
  const context = (...aris) => ({ installation: { contexts: aris.map((ari) => ({ resourceOwner: ari.split(':')[2], toString: () => ari })) } });
  assert.equal(installedInConfluence(context('ari:cloud:jira::site/abc', 'ari:cloud:confluence::site/abc')), true);
  assert.equal(installedInConfluence(context('ari:cloud:jira::site/abc')), false);
  assert.equal(installedInConfluence({ installation: { contexts: [{ toString: () => 'ari:cloud:confluence::site/abc' }] } }), true);
  assert.equal(installedInConfluence({}), null);
  assert.equal(installedInConfluence(undefined), null);
});
