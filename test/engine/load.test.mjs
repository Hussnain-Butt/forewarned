// Load signal (story 002 AC 18–22; answer key P5 and decoy D2).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSignal, rankPeople } from '../../src/engine/load.js';
import { assertEvidence, expectedEvidence } from './expect.mjs';
import { keyOf, seedSnapshot } from './seed-snapshot.mjs';

// Display name of a role's person on Checkout v2 (undefined when they aren't on the epic).
const personaName = (role) => seedSnapshot().epic.people.find((p) => p.person.accountId === `acc-${role}`)?.person.displayName;

test('the seed shows one person spread thin (P5) and the unassigned work', () => {
  const { check, drafts } = loadSignal(seedSnapshot());
  assert.equal(check.status, 'found');
  assertEvidence(drafts, expectedEvidence('P5', 'load-person')[0]);
  assertEvidence(drafts, expectedEvidence('P5', 'load-unassigned')[0]);
  assert.equal(drafts.at(-1).type, 'load-unassigned');
  assert.ok(drafts.every((d) => d.signal === 'load' && !d.baseRate));
});

test('the busy person\'s fact names them and the other epics in the fixed wording', () => {
  const name = personaName('backend');
  const fact = loadSignal(seedSnapshot()).drafts.find((d) => d.fact.startsWith(name)).fact;
  assert.equal(fact, `${name} has 14 open work items in total, 6 of them in this epic (43%; 8 elsewhere); the median for the 5 people on this epic is 3. `
    + `${name} also has open work items in 2 other epics in progress: ${keyOf('em-chk-e12')}, ${keyOf('pf-plt-e03')}.`);
  const unassigned = loadSignal(seedSnapshot()).drafts.at(-1).fact;
  assert.equal(unassigned, '5 of 17 open work items in this epic are unassigned (29%; 12 assigned).');
});

test('decoy D2: done work never counts as open load', () => {
  const name = personaName('mobile');
  const mobile = loadSignal(seedSnapshot()).drafts.find((d) => d.fact.startsWith(name));
  if (mobile) assert.equal(mobile.numbers.openTotal, 2);
});

test('facts show display names only, never account IDs', () => {
  for (const d of loadSignal(seedSnapshot()).drafts) assert.ok(!d.fact.includes('acc-'), d.fact);
});

test('nobody assigned: insufficient, and the unassigned fact still appears', () => {
  const snapshot = seedSnapshot();
  const epic = { ...snapshot.epic, assignee: null, people: [], openChildren: { ...snapshot.epic.openChildren, unassignedTotal: 17, read: snapshot.epic.openChildren.read.map((c) => ({ ...c, assignee: null })) } };
  const { check, drafts } = loadSignal({ ...snapshot, epic });
  assert.equal(check.status, 'insufficient');
  assert.equal(check.note, 'No work items in this epic are assigned yet.');
  assert.deepEqual(drafts.map((d) => d.type), ['load-unassigned']);
});

test('a capped read and a capped people list are noted', () => {
  const snapshot = seedSnapshot();
  const read = Array.from({ length: 30 }, (_, i) => ({ key: `CHK-${900 + i}`, summary: 'Work', assignee: { accountId: `acc-p${i}`, displayName: `Person ${i}` } }));
  const people = read.slice(0, 25).map((c) => ({ person: c.assignee, openTotal: 3, otherEpics: [] }));
  const epic = { ...snapshot.epic, assignee: null, people, openChildren: { total: 600, unassignedTotal: 0, read } };
  const { note } = loadSignal({ ...snapshot, epic }).check;
  assert.match(note, /Based on the first 30 open work items\./);
  assert.match(note, /The median is based on the 25 people with the most open work items in this epic\./);
});

test('rankPeople puts the most open work in this epic first and includes the epic assignee', () => {
  const ranked = rankPeople(seedSnapshot().epic);
  assert.equal(ranked[0].person.accountId, 'acc-backend');
  assert.equal(ranked[0].openInEpic, 6);
  assert.equal(ranked.length, 5);
  assert.ok(ranked.every((r, i) => !i || ranked[i - 1].openInEpic >= r.openInEpic));
});

test('one other epic is "1 other epic", and big counts get commas', () => {
  const snapshot = seedSnapshot();
  const people = snapshot.epic.people.map((p, i) => (i ? p : { ...p, openTotal: 1234, otherEpics: p.otherEpics.slice(0, 1) }));
  const fact = loadSignal({ ...snapshot, epic: { ...snapshot.epic, people } }).drafts[0].fact;
  assert.match(fact, / has 1,234 open work items in total, 6 of them in this epic \(0%; 1,228 elsewhere\);/);
  assert.match(fact, /also has open work items in 1 other epic in progress: [A-Z]+-\d+\.$/);
});

test('the truncation note names how many work items were read, and lagging counts never go negative', () => {
  const snapshot = seedSnapshot();
  const people = snapshot.epic.people.map((p, i) => (i ? p : { ...p, openTotal: 2 })); // count lags behind 6 in the epic
  const epic = { ...snapshot.epic, people, openChildren: { ...snapshot.epic.openChildren, total: 40 } };
  const { check, drafts } = loadSignal({ ...snapshot, epic });
  assert.match(check.note, /^Based on the first 17 open work items\.$/);
  assert.ok(drafts.every((d) => d.type !== 'load-person' || d.numbers.openElsewhere >= 0));
});
