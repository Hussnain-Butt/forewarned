// Content of the committed seed: story 001 AC 2, 6–20, 25, 28–29. Numbers in answer-key.json are
// recomputed here from forewarned-demo.json alone, with the definitions of story 002.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CODEGEIST_DIR, DEMO_FILE, KEY_FILE, SEED_DIR, loadSeed, median, readJson,
} from './helpers.mjs';

const demo = readJson(join(SEED_DIR, DEMO_FILE));
const key = readJson(join(SEED_DIR, KEY_FILE));
const personas = readJson(join(SEED_DIR, 'personas.json'));
const seed = loadSeed(demo);
const all = [...seed.values()];
const byId = (id) => seed.get(id);
const childrenOf = (id) => all.filter((r) => r.parent === id);
const isOpen = (r) => r.status !== 'Done';
const chkEpics = all.filter((r) => r.space === 'CHK' && r.type === 'Epic');
const finished = chkEpics.filter((r) => r.status === 'Done');
const current = all.find((r) => r.summary === 'Checkout v2 launch');
const wallet = all.find((r) => r.summary === 'Wallet top-up');
const daysLate = (e) => (e.due === null ? null : e.finish - e.due);
const isPltBlocked = (epic) => childrenOf(epic.id).some((c) => c.blockedBy.some((b) => byId(b).space === 'PLT'));

// Comparable epics (002 AC 4–5)
const sharing = finished.filter((e) => e.components.some((c) => current.components.includes(c)));
const comparable = sharing.length >= 3 ? sharing : finished;

const USER_KEYS = ['assignee', 'reporter', 'author', 'watchers', 'voters', 'users', 'lead', 'creator', 'comments', 'worklogs', 'attachments'];
const ALLOWED_KEYS = {
  root: ['projects', 'links'],
  project: ['name', 'key', 'description', 'versions', 'components', 'issues'],
  version: ['name', 'released', 'releaseDate'],
  issue: ['externalId', 'summary', 'description', 'issueType', 'status', 'resolution', 'priority', 'created', 'updated', 'duedate', 'components', 'fixedVersions', 'labels', 'history'],
  history: ['created', 'items'],
  historyItem: ['fieldType', 'field', 'fromString', 'toString'],
  link: ['name', 'sourceId', 'destinationId'],
};
const STATUSES = ['To Do', 'In Progress', 'Done'];

const keysIn = (obj, allowed, where) => {
  for (const k of Object.keys(obj)) assert.ok(allowed.includes(k), `unexpected key "${k}" in ${where}`);
};

test('uses only import keys proven on a real import (AC 6)', () => {
  keysIn(demo, ALLOWED_KEYS.root, 'the file');
  for (const p of demo.projects) {
    keysIn(p, ALLOWED_KEYS.project, p.key);
    p.versions.forEach((v) => keysIn(v, ALLOWED_KEYS.version, `${p.key} version ${v.name}`));
    for (const i of p.issues) {
      keysIn(i, ALLOWED_KEYS.issue, i.externalId);
      for (const h of i.history ?? []) {
        keysIn(h, ALLOWED_KEYS.history, `${i.externalId} history`);
        h.items.forEach((it) => keysIn(it, ALLOWED_KEYS.historyItem, `${i.externalId} history item`));
      }
    }
  }
  demo.links.forEach((l) => keysIn(l, ALLOWED_KEYS.link, 'a link'));
});

test('names no users anywhere (AC 7)', () => {
  const names = personas.roles.flatMap((r) => [r.persona, ...(r.displayName.startsWith('TODO') ? [] : [r.displayName, r.displayName.split(' ')[0]])]);
  const text = readFileSync(join(SEED_DIR, DEMO_FILE), 'utf8');
  for (const k of USER_KEYS) assert.ok(!text.includes(`"${k}":`), `user key "${k}" found`);
  const exactly = (n) => new RegExp(`(?<!\\w)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`, 'i');
  for (const n of names) assert.doesNotMatch(text, exactly(n), `person name "${n}" found`);
});

test('work item types, statuses, resolutions and history are valid', () => {
  for (const p of demo.projects) {
    for (const i of p.issues) {
      assert.ok(['Epic', 'Story', 'Task', 'Bug'].includes(i.issueType), `${i.externalId}: type ${i.issueType}`);
      assert.ok(STATUSES.includes(i.status), `${i.externalId}: status ${i.status}`);
      assert.ok(['High', 'Medium', 'Low'].includes(i.priority), `${i.externalId}: priority ${i.priority}`);
      assert.equal(i.resolution, i.status === 'Done' ? 'Done' : undefined, `${i.externalId}: resolution`);
      for (const h of i.history ?? []) {
        for (const it of h.items) {
          assert.equal(it.fieldType, 'jira');
          assert.equal(it.field, 'status');
          assert.ok(STATUSES.includes(it.fromString) && STATUSES.includes(it.toString));
        }
      }
    }
  }
  for (const r of all) {
    if (r.status === 'To Do') assert.equal(r.start, null, r.id);
    if (r.status !== 'To Do') assert.ok(r.start !== null, `${r.id} has no move to In Progress`);
    assert.equal(r.finish !== null, r.status === 'Done', `${r.id}: Done needs a dated move to Done`);
  }
});

test('external IDs and summaries are unique and every link points at existing work items', () => {
  const ids = demo.projects.flatMap((p) => p.issues.map((i) => i.externalId));
  assert.equal(new Set(ids).size, ids.length);
  for (const p of demo.projects) {
    const summaries = p.issues.map((i) => i.summary);
    assert.equal(new Set(summaries).size, summaries.length, `${p.key} repeats a summary; the post-step matches by summary`);
  }
  const parents = new Map();
  for (const l of demo.links) {
    assert.ok(seed.has(l.sourceId), `unknown link source ${l.sourceId}`);
    assert.ok(seed.has(l.destinationId), `unknown link destination ${l.destinationId}`);
    if (l.name === 'Epic-Story Link') {
      assert.equal(byId(l.sourceId).type, 'Epic');
      assert.notEqual(byId(l.destinationId).type, 'Epic');
      assert.equal(byId(l.sourceId).space, byId(l.destinationId).space);
      assert.ok(!parents.has(l.destinationId), `${l.destinationId} has two parents`);
      parents.set(l.destinationId, l.sourceId);
    } else {
      assert.equal(l.name, 'Blocks');
      assert.equal(byId(l.sourceId).space, 'PLT');
      assert.equal(byId(l.destinationId).space, 'CHK');
    }
  }
});

test('every external ID in the answer key exists in the import file (AC 19)', () => {
  const found = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    else if (typeof v === 'string') found.push(...(v.match(/\b(?:ll|bk|em|mb|qa|pf|un)-(?:chk|plt)-[et]\d{2}(?:-\d{2})?\b/g) ?? []));
  };
  walk(key);
  assert.ok(found.length > 30);
  for (const id of found) assert.ok(seed.has(id), `answer key names unknown work item ${id}`);
});

test('dates are consistent and cover the last 12 months (AC 5, 12)', () => {
  for (const r of all) {
    assert.ok(r.created <= -1, `${r.id} created in the future`);
    if (r.start !== null) assert.ok(r.start > r.created, `${r.id} started before it was created`);
    if (r.finish !== null) assert.ok(r.finish > r.start && r.finish <= -1, `${r.id} finish`);
    assert.equal(r.updated, r.finish ?? r.start ?? r.created, `${r.id} updated`);
    if (r.parent) {
      const epic = byId(r.parent);
      assert.ok(r.created > epic.created, `${r.id} created before its epic`);
      if (epic.finish !== null) assert.ok(r.finish < epic.finish, `${r.id} finished after its epic`);
    }
  }
  assert.equal(Math.min(...all.map((r) => r.created)), -365);
  for (const e of finished) assert.ok(e.finish >= -365, `${e.id} resolved more than 365 days ago`);
});

test('spaces CHK and PLT with the seed descriptions (AC 9, 29)', () => {
  assert.deepEqual(demo.projects.map((p) => [p.key, p.name]), [['CHK', 'Checkout'], ['PLT', 'Platform']]);
  for (const p of demo.projects) {
    assert.equal(p.description, "Seeded demo history generated by Forewarned's seed script. All dates are relative to the import date.");
  }
});

test('CHK components are each used by at least 2 finished epics (AC 10)', () => {
  assert.deepEqual(demo.projects[0].components, ['Payments', 'Mobile', 'Web', 'Notifications']);
  for (const c of demo.projects[0].components) {
    assert.ok(finished.filter((e) => e.components.includes(c)).length >= 2, c);
  }
  for (const p of demo.projects) {
    for (const i of p.issues) for (const c of i.components ?? []) assert.ok(p.components.includes(c), `${i.externalId}: ${c}`);
  }
});

test('CHK versions: 4+ released over the year, 1 unreleased for Checkout v2 (AC 11)', () => {
  const versions = demo.projects[0].versions.map((v) => ({ ...v, day: Number(/^P(-?\d+)D$/.exec(v.releaseDate)[1]) }));
  const released = versions.filter((v) => v.released);
  const unreleased = versions.filter((v) => !v.released);
  assert.ok(released.length >= 4);
  for (const v of released) assert.ok(v.day < 0, `${v.name} released in the future`);
  assert.ok(Math.max(...released.map((v) => v.day)) - Math.min(...released.map((v) => v.day)) >= 240, 'releases are not spread over the year');
  assert.equal(unreleased.length, 1);
  assert.ok(unreleased[0].day > 0);
  assert.deepEqual(current.fixVersions, [unreleased[0].name]);
  const names = new Set(versions.map((v) => v.name));
  for (const r of all.filter((x) => x.space === 'CHK')) {
    r.fixVersions.forEach((v) => assert.ok(names.has(v), `${r.id}: unknown version ${v}`));
    if (r.status === 'Done') assert.equal(r.fixVersions.length, 1, `${r.id} is done but has no fix version`);
  }
});

test('finished CHK epics: 8+, 5+ slipped 9–42 days, Wallet top-up 42, 2+ without due date, 1+ on time (AC 12, 13)', () => {
  assert.ok(finished.length >= 8);
  for (const e of finished) assert.ok(e.start !== null && e.finish !== null, `${e.id} lacks dated history`);
  const slipped = finished.filter((e) => daysLate(e) >= 9 && daysLate(e) <= 42);
  assert.ok(slipped.length >= 5, `only ${slipped.length} slipped 9–42 days`);
  assert.equal(daysLate(wallet), 42);
  assert.ok(finished.filter((e) => e.due === null).length >= 2);
  assert.ok(finished.filter((e) => e.due !== null && daysLate(e) <= 0).length >= 1);
});

test('finished CHK epics have 6–20 children, some added after the start (AC 14)', () => {
  for (const e of finished) {
    const kids = childrenOf(e.id);
    assert.ok(kids.length >= 6 && kids.length <= 20, `${e.id} has ${kids.length} children`);
    assert.ok(kids.some((c) => c.created > e.start), `${e.id} has no scope added after its start`);
    // two days clear of the start, so a time zone shift can't move a child across it
    for (const c of kids) assert.ok(Math.abs(c.created - e.start) >= 2, `${c.id} created too close to its epic's start`);
  }
});

test('PLT blockers in 4+ finished CHK epics, 3+ of them late; Wallet blocker resolved after its due date (AC 15)', () => {
  const blocked = finished.filter(isPltBlocked);
  assert.ok(blocked.length >= 4);
  assert.ok(blocked.filter((e) => daysLate(e) > 0).length >= 3);
  for (const e of blocked) {
    for (const c of childrenOf(e.id)) {
      for (const b of c.blockedBy) {
        assert.equal(byId(b).status, 'Done', `${b} should be resolved`);
        assert.ok(c.start > byId(b).finish, `${c.id} started before its blocker ${b} was resolved`);
      }
    }
  }
  const walletBlockers = childrenOf(wallet.id).flatMap((c) => c.blockedBy).map(byId);
  assert.ok(walletBlockers.some((b) => b.space === 'PLT' && b.finish > b.due));
});

test('Checkout v2 launch is the current epic as specified (AC 16)', () => {
  assert.equal(current.space, 'CHK');
  assert.equal(current.type, 'Epic');
  assert.equal(current.status, 'In Progress');
  assert.equal(current.start, -14);
  assert.equal(current.due, 42);
  assert.deepEqual([...current.components].sort(), ['Payments', 'Web']);
  const kids = childrenOf(current.id);
  assert.ok(kids.length >= 15 && kids.length <= 25);
  assert.deepEqual([...new Set(kids.map((c) => c.status))].sort(), ['Done', 'In Progress', 'To Do']);
  assert.ok(kids.filter((c) => c.created > current.start).length / kids.length >= 0.2);
  for (const c of kids) assert.ok(Math.abs(c.created - current.start) >= 2, c.id);
});

test('no labels on epics, so they can not change comparable-epic matching (AC 25)', () => {
  for (const e of all.filter((r) => r.type === 'Epic')) assert.deepEqual(e.labels, [], e.id);
});

// People on the epic: its assignee plus the assignees of its open children (002 AC 18).
const openKids = childrenOf(current.id).filter(isOpen);
const people = [...new Set([current.role, ...openKids.map((c) => c.role)])].filter((r) => r !== 'un');
const openTotal = (role) => all.filter((r) => r.role === role && isOpen(r)).length;
const doneTotal = (role) => all.filter((r) => r.role === role && r.status === 'Done').length;
const medianOpen = median(people.map(openTotal));
const otherEpics = (role) => [...new Set(all.filter((r) => r.role === role && isOpen(r) && r.parent && r.parent !== current.id).map((r) => r.parent))]
  .map(byId).filter((e) => e.status === 'In Progress');

test('planted risks P1–P5 are present (AC 17)', () => {
  // P1: an open, unassigned, overdue PLT item blocks a Checkout v2 child; most PLT-blocked epics were late
  const openBlockers = openKids.flatMap((c) => c.blockedBy.map(byId)).filter(isOpen);
  assert.ok(openBlockers.some((b) => b.space === 'PLT' && b.role === 'un' && b.due < 0));
  const pltBlocked = comparable.filter(isPltBlocked);
  assert.ok(pltBlocked.filter((e) => daysLate(e) > 0).length > pltBlocked.length / 2);
  // P2: comparable epics usually finish late
  const withDue = comparable.filter((e) => e.due !== null);
  assert.ok(withDue.filter((e) => daysLate(e) > 0).length > withDue.length / 2);
  // P3: the plan is shorter than the median duration, which includes epics without a due date
  assert.ok(comparable.some((e) => e.due === null));
  assert.ok(current.due - current.start < median(comparable.map((e) => e.finish - e.start)));
  // P4: scope grows after the start, in the past and now
  assert.ok(median(comparable.map((e) => childrenOf(e.id).filter((c) => c.created > e.start).length)) > 0);
  assert.ok(childrenOf(current.id).some((c) => c.created > current.start));
  // P5: the backend person has far more open work than the median, across 2+ other epics, one in PLT
  assert.ok(people.includes('bk'));
  assert.ok(openTotal('bk') >= 2 * medianOpen, `backend ${openTotal('bk')} vs median ${medianOpen}`);
  assert.ok(otherEpics('bk').length >= 2);
  assert.ok(otherEpics('bk').some((e) => e.space === 'PLT'));
});

test('decoys D1–D2 are present (AC 18)', () => {
  // D1: a resolved PLT item blocked a Checkout v2 child
  assert.ok(childrenOf(current.id).some((c) => c.blockedBy.some((b) => byId(b).space === 'PLT' && byId(b).status === 'Done')));
  // D2: someone on the epic with many done but few open work items
  const d2 = people.filter((p) => p !== 'bk' && doneTotal(p) >= 10 && openTotal(p) <= medianOpen);
  assert.ok(d2.length >= 1);
  assert.ok(key.decoys.some((d) => d.id === 'D2' && people.some((p) => key.roles.find((r) => r.prefix === p)?.role === d.role)));
});

test('answer-key numbers match the import file (AC 19)', () => {
  const evidence = (risk, type) => key.plantedRisks.find((r) => r.id === risk).expectedEvidence.find((e) => e.type === type);
  const withDue = comparable.filter((e) => e.due !== null);
  const late = withDue.filter((e) => daysLate(e) > 0).map(daysLate);
  assert.deepEqual(key.comparison.epics.map((e) => e.externalId).sort(), comparable.map((e) => e.id).sort());
  assert.equal(key.comparison.rule, 'matched on components Payments, Web');

  assert.deepEqual(evidence('P2', 'slip-base-rate').numbers, {
    late: late.length, withDueDate: withDue.length, medianDaysLate: median(late), minDaysLate: Math.min(...late), maxDaysLate: Math.max(...late),
  });
  const durations = comparable.map((e) => e.finish - e.start);
  const planned = current.due - current.start;
  assert.deepEqual(evidence('P3', 'duration-base-rate').numbers, {
    medianDurationDays: median(durations), epics: comparable.length, withoutDueDate: comparable.length - withDue.length,
  });
  assert.deepEqual(evidence('P3', 'plan-vs-history').numbers, {
    plannedDays: planned, longerThanPlan: durations.filter((d) => d > planned).length, epics: comparable.length,
  });

  const growth = comparable.map((e) => {
    const kids = childrenOf(e.id);
    const atStart = kids.filter((c) => c.created < e.start).length;
    return ((kids.length - atStart) / atStart) * 100;
  });
  assert.deepEqual(evidence('P4', 'scope-base-rate').numbers, {
    medianGrowthPercent: Math.round(median(growth)), epics: comparable.length,
    minGrowthPercent: Math.round(Math.min(...growth)), maxGrowthPercent: Math.round(Math.max(...growth)), leftOut: 0,
  });
  const curKids = childrenOf(current.id);
  const curAtStart = curKids.filter((c) => c.created < current.start).length;
  assert.deepEqual(evidence('P4', 'scope-current').numbers, {
    atStart: curAtStart, added: curKids.length - curAtStart,
    growthPercent: Math.round(((curKids.length - curAtStart) / curAtStart) * 100), total: curKids.length,
  });

  assert.deepEqual(evidence('P5', 'load-person').numbers, {
    openTotal: openTotal('bk'), openInEpic: openKids.filter((c) => c.role === 'bk').length,
    peopleOnEpic: people.length, medianOpen, otherEpicsInProgress: otherEpics('bk').length,
  });
  assert.deepEqual(evidence('P5', 'load-unassigned').numbers, {
    unassignedOpen: openKids.filter((c) => c.role === 'un').length, open: openKids.length,
  });

  const openBlocker = openKids.flatMap((c) => c.blockedBy.map(byId)).find(isOpen);
  assert.deepEqual(evidence('P1', 'open-blocker').numbers, { daysOverdue: -openBlocker.due });
  const pltBlocked = comparable.filter(isPltBlocked);
  assert.deepEqual(evidence('P1', 'blocker-history').numbers, {
    late: pltBlocked.filter((e) => daysLate(e) > 0).length, epics: pltBlocked.length,
  });
  const walletBlocker = childrenOf(wallet.id).flatMap((c) => c.blockedBy).map(byId)[0];
  assert.deepEqual(evidence('P1', 'blocker-example').numbers, { daysLate: daysLate(wallet), blockerDaysAfterOwnDue: walletBlocker.finish - walletBlocker.due });
  assert.equal(key.toleranceDays, 1);
});

test('inventory counts match the import file (AC 19)', () => {
  const line = (id) => key.inventory.find((l) => l.id === id).expected;
  const chk = all.filter((r) => r.space === 'CHK');
  assert.equal(line('chk-work-items'), chk.length);
  assert.equal(line('plt-work-items'), all.length - chk.length);
  assert.equal(line('chk-finished-epics'), finished.length);
  assert.equal(line('chk-finished-epics-no-due-date'), finished.filter((e) => e.due === null).length);
  assert.equal(line('chk-blocked-work-items'), chk.filter((r) => r.blockedBy.length).length);
  assert.equal(line('plt-blocking-work-items'), all.filter((r) => r.blocks.length).length);
  assert.equal(line('checkout-v2-children'), childrenOf(current.id).length);
  for (const c of demo.projects[0].components) {
    assert.equal(line(`chk-component-${c.toLowerCase()}`), chk.filter((r) => r.components.includes(c)).length);
  }
  for (const r of key.roles) {
    assert.equal(line(`open-${r.role}`), openTotal(r.prefix));
    assert.equal(line(`role-query-${r.role}`), all.filter((x) => x.labels.includes(`seed-role-${r.role}`)).length);
  }
  assert.deepEqual(line('chk-versions'), { released: 5, unreleased: 1 });
});

test('roles: personas.json holds names only, and every work item has a role prefix (AC 20, 25)', () => {
  assert.equal(personas.roles.length, 6);
  for (const r of personas.roles) {
    assert.deepEqual(Object.keys(r).sort(), ['displayName', 'persona', 'prefix', 'role', 'title']);
    assert.doesNotMatch(JSON.stringify(r), /@|[0-9a-f]{24}|:\d{6}/i, `${r.role} looks like it holds an email or account ID`);
  }
  const prefixes = personas.roles.map((r) => r.prefix);
  assert.equal(new Set(prefixes).size, 6);
  for (const r of all) assert.ok([...prefixes, 'un'].includes(r.role), `${r.id} has no known role prefix`);
  for (const r of key.roles) assert.equal(r.query, `project in (CHK, PLT) AND labels = seed-role-${r.role}`);
});

test('summaries read like real team work (AC 28)', () => {
  const texts = demo.projects.flatMap((p) => p.issues.flatMap((i) => [i.summary, i.description].filter(Boolean)));
  const placeholder = /\b(lorem|ipsum|test|tests|testing|todo|tbd|placeholder|dummy|foo|bar|sample|asdf)\b/i;
  const brands = /\b(stripe|paypal|adyen|klarna|braintree|visa|mastercard|amex|american express|apple|google|android|ios|iphone|firebase|twilio|sendgrid|mailchimp|kafka|aws|amazon|azure|redis|postgres|mysql|shopify|slack|whatsapp|facebook|venmo|afterpay|jira|atlassian|confluence)\b/i;
  for (const t of texts) {
    assert.doesNotMatch(t, placeholder, `placeholder word in "${t}"`);
    assert.doesNotMatch(t, brands, `brand name in "${t}"`);
    assert.match(t, /^[A-Z][\x20-\x7e]*$/, `not plain English text: "${t}"`);
  }
  const summaries = demo.projects.flatMap((p) => p.issues.map((i) => i.summary));
  assert.equal(new Set(summaries).size, summaries.length, 'duplicate summaries');
  for (const s of summaries) assert.ok(s.length <= 100 && !s.endsWith('.'), `"${s}"`);
});

test('nothing in src/ imports from scripts/ (AC 2)', () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(join(CODEGEIST_DIR, 'src'));
  assert.ok(files.length > 0);
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /scripts\//, `${f} refers to scripts/`);
  const manifest = readFileSync(join(CODEGEIST_DIR, 'manifest.yml'), 'utf8');
  assert.doesNotMatch(manifest, /scripts\/|extraFiles/, 'the manifest packages extra files');
});
