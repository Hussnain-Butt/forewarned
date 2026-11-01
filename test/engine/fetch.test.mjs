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
const EPIC = keyOf('ll-chk-e11');
const fetchSeed = async (options = {}, key = EPIC) => {
  const { senders, log } = seedPort(options);
  const port = createJira(senders, { deadline: Infinity });
  const result = await fetchSnapshot(port, key, { today: TODAY, accountId: 'acc-requester' });
  return { ...result, port, log };
};

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
