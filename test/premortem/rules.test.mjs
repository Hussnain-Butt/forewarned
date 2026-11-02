// Rule-based reasons (story 004 AC 1–12) on the seed and on the edge cases of story 002.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computePack } from '../../src/engine/pack.js';
import { ruleBasedReasons } from '../../src/premortem/rules.js';
import { validateReasons } from '../../src/premortem/validator.js';
import { SEED_SITE, answerKey, keyOf, seedSnapshot } from '../engine/seed-snapshot.mjs';

const seedPack = () => computePack(seedSnapshot());
const byRule = (reasons) => Object.fromEntries(reasons.map((r) => [r.ruleId, r]));

const emptyEpicPack = () => {
  const today = 20000;
  return computePack({
    siteUrl: SEED_SITE, today, builtFor: 'acc-requester', linkTypeFound: false,
    epic: {
      key: 'NEW-1', summary: 'Lonely epic', space: 'NEW', statusCategory: 'new', created: today, start: today, due: null, finish: null,
      components: [], labels: [], assignee: null, childCount: 0, childCountAtStart: 0,
      openChildren: { total: 0, unassignedTotal: 0, read: [] }, people: [], blocked: [],
    },
    candidates: [], blockers: {}, notes: [],
  });
};
const edgePacks = () => {
  const seed = seedSnapshot();
  return {
    'no due dates': computePack(seedSnapshot({ edit: (records) => { for (const r of records.values()) r.due = null; } })),
    '2 comparable epics': computePack({ ...seed, candidates: seed.candidates.slice(0, 2) }),
    'nobody assigned': computePack({
      ...seed,
      epic: { ...seed.epic, assignee: null, people: [], openChildren: { ...seed.epic.openChildren, unassignedTotal: 17, read: seed.epic.openChildren.read.map((c) => ({ ...c, assignee: null })) } },
    }),
    'no links': computePack({ ...seed, linkTypeFound: false }),
    'brand-new epic': emptyEpicPack(),
  };
};

test('the pack carries what the rules need without reading fact text', () => {
  const pack = seedPack();
  const open = pack.evidence.find((e) => e.type === 'open-blocker');
  assert.deepEqual(open.about, { space: 'PLT', blocker: keyOf('un-plt-e03-07'), unassigned: true });
  assert.deepEqual(pack.evidence.find((e) => e.type === 'blocker-history').about, { space: 'PLT' });
  assert.ok(pack.evidence.filter((e) => e.type === 'load-person').every((e) => typeof e.about.name === 'string'));
});

test('AC 12: on the seed the rule-based reasons cover all 5 planted risks and neither decoy', () => {
  const reasons = ruleBasedReasons(seedPack());
  assert.deepEqual(reasons.map((r) => r.ruleId).sort(), answerKey.plantedRisks.map((p) => p.rule).sort());
  const load = reasons.find((r) => r.ruleId === 'load');
  assert.match(load.title, /^Ada Isadora's workload/); // the backend person, not the mobile decoy (D2)
  const dependency = reasons.find((r) => r.ruleId === 'dependency');
  assert.match(dependency.mitigation, new RegExp(keyOf('un-plt-e03-07'))); // the open blocker, not the resolved decoy (D1)
});

test('the seed reasons use the fixed wording, likelihoods and order (AC 4, 7)', () => {
  const reasons = ruleBasedReasons(seedPack());
  assert.deepEqual(reasons.map((r) => [r.ruleId, r.likelihood]), [
    ['dependency', 'High'], ['slip-base-rate', 'High'], ['plan-shorter', 'High'], ['scope-growth', 'High'], ['load', 'Medium'],
  ]);
  const r = byRule(reasons);
  assert.equal(r.dependency.title, 'PLT work could block Checkout v2 launch again');
  assert.equal(r.dependency.mitigation, `Agree a date for ${keyOf('un-plt-e03-07')} with the PLT team and give it an owner.`);
  assert.equal(r['slip-base-rate'].title, 'Epics like this one usually finish late');
  assert.equal(r['slip-base-rate'].mitigation, 'Plan for the median slip of 21 days now: add buffer or cut scope.');
  assert.match(r['slip-base-rate'].explanation, /^5 of 6 comparable epics .* Nothing in this plan accounts for that\.$/);
  assert.equal(r['plan-shorter'].title, 'The plan is shorter than comparable epics took');
  assert.equal(r['plan-shorter'].mitigation, 'Re-plan against the median of 77 days, or cut scope to fit 56 days.');
  assert.equal(r['scope-growth'].title, 'Scope will keep growing after the plan is set');
  assert.equal(r['scope-growth'].mitigation, 'Freeze scope for Checkout v2 launch and move new work to a follow-up epic.');
  assert.equal(r.load.title, "Ada Isadora's workload could slow Checkout v2 launch");
  assert.equal(r.load.mitigation, "Move some of Ada Isadora's open work items to someone else, or free Ada Isadora from another epic.");
  assert.equal(r['slip-base-rate'].baseRateFact, seedPack().evidence.find((e) => e.type === 'slip-base-rate').fact);
  assert.equal(r.load.baseRateFact, undefined);
});

test('AC 3: every rule-based reason passes the validator unchanged, on the seed and every edge case', () => {
  for (const [name, pack] of Object.entries({ seed: seedPack(), ...edgePacks() })) {
    const reasons = ruleBasedReasons(pack);
    const { kept, dropped } = validateReasons(reasons, pack, { keep: ['ruleId', 'baseRateFact'] });
    assert.deepEqual(dropped, [], `${name}: dropped ${JSON.stringify(dropped)}`);
    assert.deepEqual(kept, reasons, `${name}: the validator changed a reason`);
  }
});

test('edge cases fire only the rules their data supports (004 edge cases, AC 11)', () => {
  const edges = edgePacks();
  const rules = (name) => ruleBasedReasons(edges[name]).map((r) => r.ruleId);
  assert.ok(!rules('no due dates').includes('slip-base-rate') && !rules('no due dates').includes('plan-shorter'));
  assert.ok(!rules('2 comparable epics').some((id) => ['slip-base-rate', 'plan-shorter'].includes(id)));
  assert.ok(!rules('nobody assigned').includes('load'));
  assert.ok(!rules('no links').includes('dependency'));
  assert.deepEqual(rules('brand-new epic'), []);
});

test('at most 5 reasons, at most 2 dependency reasons, High before Medium before Low (AC 6, 7)', () => {
  const pack = seedPack();
  const blocker = pack.evidence.find((e) => e.type === 'open-blocker');
  const extra = ['OPS', 'SEC'].map((space, i) => ({
    ...blocker, id: `E${90 + i}`, about: { space, blocker: `${space}-1`, unassigned: false },
    numbers: { daysOverdue: 0 }, fact: `${space}-1 Something (${space}, To Do, Sam, no due date) blocks this epic.`,
    links: [{ key: `${space}-1`, summary: 'Something', url: 'x' }],
  }));
  const reasons = ruleBasedReasons({ ...pack, evidence: [...pack.evidence, ...extra] });
  assert.ok(reasons.length <= 5);
  assert.ok(reasons.filter((r) => r.ruleId === 'dependency').length <= 2);
  const rank = { High: 0, Medium: 1, Low: 2 };
  assert.ok(reasons.every((r, i) => !i || rank[reasons[i - 1].likelihood] <= rank[r.likelihood]));
});
