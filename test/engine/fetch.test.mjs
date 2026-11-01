// The fetch layer (story 002 AC 1, 8, 9, 18, 19, 23, 32) against a fake Jira answered from the seed.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayOf } from '../../src/engine/format.js';
import { createJira } from '../../src/engine/jira.js';
import { fetchSnapshot } from '../../src/engine/fetch.js';
import { computePack } from '../../src/engine/pack.js';
import { seedPort } from './seed-port.mjs';
import { SEED_TODAY, keyOf, seedSnapshot } from './seed-snapshot.mjs';

const TODAY = dayOf(SEED_TODAY);
const NOW = Date.parse(`${SEED_TODAY}T08:00:00.000Z`);
const EPIC = keyOf('ll-chk-e11');
const HIDDEN_NOTE = "Some links point to spaces you can't see.";
const fetchSeed = async (options = {}, key = EPIC) => {
  const { senders, log } = seedPort({ now: NOW, ...options });
  const port = createJira(senders, { deadline: Infinity });
  const result = await fetchSnapshot(port, key, { today: TODAY, now: NOW, accountId: 'acc-requester' });
  return { ...result, port, log };
};
const story = (id, extra) => ({
  id, role: 'zz', space: 'CHK', type: 'Story', status: 'To Do', resolution: null, summary: `Work ${id}`,
  created: -3, updated: -3, due: null, start: null, finish: null, components: [], fixVersions: [], labels: [],
  parent: 'll-chk-e11', blockedBy: [], blocks: [], ...extra,
});

test('fetch and the seed helper agree: the same pack comes out of both', async () => {
  const { snapshot } = await fetchSeed();
  assert.deepEqual(computePack(snapshot), computePack(seedSnapshot()));
});

test('AC 1: a work item that is not an epic is refused', async () => {
  const { error } = await fetchSeed({}, keyOf('bk-chk-e11-03'));
  assert.equal(error, `${keyOf('bk-chk-e11-03')} is not an epic. Forewarned runs pre-mortems on epics only.`);
});

test('an unknown or hidden epic gets the not-found message', async () => {
  const { error } = await fetchSeed({}, 'CHK-99999');
  assert.equal(error, "CHK-99999 doesn't exist, or you don't have permission to see it.");
});

test('AC 32: a huge epic is read in at most 5 pages and 150 requests', async () => {
  const edit = (records) => {
    for (let i = 0; i < 5000; i += 1) {
      records.set(`big-${i}`, {
        id: `big-${i}`, role: 'un', space: 'CHK', type: 'Story', status: 'To Do', resolution: null, summary: `Generated work ${i}`,
        created: -3, updated: -3, due: null, start: null, finish: null, components: [], fixVersions: [], labels: [],
        parent: 'll-chk-e11', blockedBy: [], blocks: [],
      });
    }
  };
  const { snapshot, port, log } = await fetchSeed({ edit });
  assert.equal(log.filter((jql) => jql.endsWith('AND statusCategory != Done ORDER BY key ASC') && jql.startsWith('parent')).length, 5);
  assert.equal(snapshot.epic.openChildren.read.length, 500);
  assert.equal(snapshot.epic.openChildren.total, 5017);
  assert.ok(port.requestCount <= 150, `${port.requestCount} requests`);
});

test('Review Focus 2: an account ID that is unsafe in JQL is skipped', async () => {
  const edit = (records) => {
    records.set('odd-1', {
      id: 'odd-1', role: 'zz', space: 'CHK', type: 'Story', status: 'To Do', resolution: null, summary: 'Odd assignee',
      created: -2, updated: -2, due: null, start: null, finish: null, components: [], fixVersions: [], labels: [],
      parent: 'll-chk-e11', blockedBy: [], blocks: [], person: { accountId: 'bad id"', displayName: 'Odd Person' },
    });
  };
  const { snapshot, log } = await fetchSeed({ edit });
  assert.ok(!log.some((jql) => jql.includes('bad id')));
  assert.ok(!snapshot.epic.people.some((p) => p.person.accountId === 'bad id"'));
});

test('AC 8: a Done epic without a resolution date finishes on its last move into Done', async () => {
  const edit = (records) => {
    const wallet = records.get('ll-chk-e07');
    wallet.noResolution = true;
    wallet.extraMoves = [{ day: wallet.finish + 2, status: 'In Progress' }, { day: wallet.finish + 5, status: 'Done' }];
  };
  const { snapshot } = await fetchSeed({ edit });
  const wallet = snapshot.candidates.find((c) => c.key === keyOf('ll-chk-e07'));
  assert.equal(wallet.finish, seedSnapshot().candidates.find((c) => c.key === keyOf('ll-chk-e07')).finish + 5);
});

test('AC 9: an epic that never moved to In Progress starts on its created day', async () => {
  const { snapshot } = await fetchSeed({ edit: (records) => { records.get('ll-chk-e11').start = null; } });
  assert.equal(snapshot.epic.start, snapshot.epic.created);
});

test('no "is blocked by" link type: no blocker queries and the check knows', async () => {
  const { snapshot, log } = await fetchSeed({ linkTypes: [] });
  assert.equal(snapshot.linkTypeFound, false);
  assert.ok(!log.some((jql) => jql.includes('issueLinkType')));
});

test('I-1: imported history without status IDs still finds the start by status name', async () => {
  const { snapshot } = await fetchSeed({ statusIds: false });
  assert.deepEqual(computePack(snapshot), computePack(seedSnapshot()));
});

test('I-2: "work items at the start" uses a time-zone-free relative bound', async () => {
  const { log } = await fetchSeed();
  assert.ok(log.some((jql) => /^parent = "[A-Z]+-\d+" AND created < "-\d+m"$/.test(jql)));
  assert.ok(!log.some((jql) => /created < "\d{4}-/.test(jql)));
});

test('I-3: one blocker the user can\'t see hides only that blocker, with a note', async () => {
  const { snapshot } = await fetchSeed({ hidden: [keyOf('un-plt-e03-07')] });
  assert.equal(snapshot.blockers[keyOf('un-plt-e03-07')], undefined);
  assert.ok(snapshot.blockers[keyOf('pf-plt-e03-02')], 'the other blockers are still read');
  assert.deepEqual(snapshot.notes, [HIDDEN_NOTE]);
});

test('AC 2: an other epic the user can\'t see is never named', async () => {
  const { snapshot } = await fetchSeed({ hidden: [keyOf('pf-plt-e03')] });
  for (const p of snapshot.epic.people) assert.ok(!(p.otherEpics ?? []).some((e) => e.key === keyOf('pf-plt-e03')));
});

test('a person whose open work can\'t be counted is skipped, not the whole run', async () => {
  const { snapshot } = await fetchSeed({ failCountFor: 'acc-qa' });
  assert.ok(!snapshot.epic.people.some((p) => p.person.accountId === 'acc-qa'));
  assert.equal(snapshot.epic.people.length, 4);
});

test('an old (moved) epic key is followed to the current key', async () => {
  const { snapshot, log } = await fetchSeed({ aliases: { 'OLD-12': 'll-chk-e11' } }, 'OLD-12');
  assert.equal(snapshot.epic.key, EPIC);
  assert.ok(!log.some((jql) => jql.includes('OLD-12')));
  for (const p of snapshot.epic.people) assert.ok(!(p.otherEpics ?? []).some((e) => e.key === EPIC));
});

test('an unreadable created date falls back to today instead of throwing (AC 28)', async () => {
  const { snapshot } = await fetchSeed({ edit: (records) => { records.get('ll-chk-e11').rawCreated = 'not a date'; } });
  assert.equal(snapshot.epic.created, TODAY);
});

test('AC 33: a wide epic (25 people, 20 comparable epics, busy people) stays within 150 requests', async () => {
  const edit = (records) => {
    for (let i = 0; i < 20; i += 1) {
      records.set(`fan-e${i}`, story(`fan-e${i}`, {
        type: 'Epic', status: 'Done', parent: null, components: ['Payments'], created: -300, start: -250 + i, finish: -100 + i, due: -110 + i,
      }));
      for (let j = 0; j < 2; j += 1) records.set(`fan-e${i}-c${j}`, story(`fan-e${i}-c${j}`, { status: 'Done', parent: `fan-e${i}`, created: -260, finish: -120 }));
    }
    for (let i = 0; i < 25; i += 1) {
      const person = { accountId: `acc-fan${i}`, displayName: `Fan ${i}` };
      records.set(`fan-p${i}`, story(`fan-p${i}`, { person }));
      if (i < 10) for (let j = 0; j < 150; j += 1) records.set(`fan-p${i}-w${j}`, story(`fan-p${i}-w${j}`, { person, parent: 'em-chk-e12' }));
    }
  };
  const { snapshot, port } = await fetchSeed({ edit });
  assert.equal(snapshot.epic.people.length, 25);
  assert.ok(port.requestCount <= 150, `${port.requestCount} requests`);
});
