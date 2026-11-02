// Rule-based reasons (story 004): a pre-mortem from the evidence pack alone, with no AI, so every
// site gets one, with or without Rovo. Each rule reads the pack's evidence items (their `numbers`
// and `about` fields, never their fact text) and quotes the facts it cites, so every reason passes
// the validator (story 003) unchanged.

import { counted, shorten } from '../engine/format.js';

// Thresholds (story 004 AC 4). Change one only when a failure shows on at least two of: the seed,
// PLAT-1 and the dogfood spaces (open question 1), and log the reason here.
const MIN_EPICS = 3; // a base rate needs at least 3 comparable epics
const SLIP_FIRES_SHARE = 0.5; // slip-base-rate fires when at least half finished late...
const SLIP_HIGH_SHARE = 0.6; // ...and is High from 60%
const PLAN_HIGH_SHARE = 0.75; // plan-shorter is High when at least 75% took longer than the plan
const SCOPE_HISTORY_PERCENT = 25; // comparable epics' median growth after their start
const SCOPE_CURRENT_PERCENT = 20; // this epic's own growth since its start
const LOAD_MIN_OPEN = 8; // a person with at least 8 open work items...
const LOAD_MEDIAN_FACTOR = 2; // ...and at least twice the median of the people on the epic...
const LOAD_OTHER_EPICS = 2; // ...or open work in at least 2 other epics in progress
const DEPENDENCY_LATE_SHARE = 0.5; // a blocking space's history counts when at least half of...
const DEPENDENCY_MIN_EPICS = 2; // ...at least 2 comparable epics blocked by it finished late
const MAX_DEPENDENCY = 2;
const MAX_REASONS = 5;
const SUBJECT_CHARS = 80; // epic summaries in titles and mitigations, so they stay within the validator's limits

const RULE_ORDER = ['dependency', 'slip-base-rate', 'plan-shorter', 'scope-growth', 'load'];
const LIKELIHOOD_ORDER = { High: 0, Medium: 1, Low: 2 };

// One reason; its base-rate fact is the fact of the first cited base-rate item (AC 2).
function reason(ruleId, title, likelihood, cited, explanation, mitigation) {
  const items = cited.filter(Boolean);
  const baseRate = items.find((item) => item.baseRate);
  return {
    title, likelihood, explanation, evidenceIds: items.map((item) => item.id), mitigation, ruleId,
    ...(baseRate ? { baseRateFact: baseRate.fact } : {}),
  };
}

const facts = (items) => items.filter(Boolean).map((item) => item.fact).join(' ');

// Up to 2 reasons, one per other space with an open blocker, strongest history first.
// The epic's own space comes from its key; the pack's epic record has no space field.
const spaceOf = (key) => key.replace(/-\d+$/, '');

function dependencyReasons(pack, ofType, subject) {
  const epicSpace = spaceOf(pack.epic.key);
  const bySpace = new Map();
  for (const blocker of ofType('open-blocker')) {
    if (blocker.about.space !== epicSpace && !bySpace.has(blocker.about.space)) bySpace.set(blocker.about.space, blocker);
  }
  return [...bySpace.entries()].map(([space, blocker]) => {
    const history = ofType('blocker-history').find((item) => item.about.space === space);
    const example = ofType('blocker-example').find((item) => item.links.at(-1)?.key.split('-')[0] === space);
    const historyLate = history && history.numbers.epics >= DEPENDENCY_MIN_EPICS && history.numbers.late >= history.numbers.epics * DEPENDENCY_LATE_SHARE;
    const urgent = blocker.about.unassigned || blocker.numbers.daysOverdue > 0;
    let likelihood = 'Low';
    if (historyLate && urgent) likelihood = 'High';
    else if (historyLate || urgent) likelihood = 'Medium';
    return reason('dependency', `${space} work could block ${subject}${history ? ' again' : ''}`, likelihood,
      [blocker, history, example], facts([blocker, history]),
      `Agree a date for ${blocker.about.blocker} with the ${space} team and give it an owner.`);
  }).sort((a, b) => LIKELIHOOD_ORDER[a.likelihood] - LIKELIHOOD_ORDER[b.likelihood]).slice(0, MAX_DEPENDENCY);
}

function slipReason(ofType) {
  const base = ofType('slip-base-rate')[0];
  if (!base) return null;
  const { late, withDueDate, medianDaysLate } = base.numbers;
  if (withDueDate < MIN_EPICS || late < withDueDate * SLIP_FIRES_SHARE) return null;
  return reason('slip-base-rate', 'Epics like this one usually finish late', late >= withDueDate * SLIP_HIGH_SHARE ? 'High' : 'Medium',
    [base, ofType('slip-example')[0]], `${base.fact} Nothing in this plan accounts for that.`,
    `Plan for the median slip of ${counted(medianDaysLate, 'day')} now: add buffer or cut scope.`);
}

function planReason(ofType) {
  const plan = ofType('plan-vs-history')[0];
  const duration = ofType('duration-base-rate')[0];
  if (!plan || !duration || duration.numbers.epics < MIN_EPICS) return null;
  const { plannedDays, longerThanPlan, epics } = plan.numbers;
  if (plannedDays >= duration.numbers.medianDurationDays) return null;
  return reason('plan-shorter', 'The plan is shorter than comparable epics took', longerThanPlan >= epics * PLAN_HIGH_SHARE ? 'High' : 'Medium',
    [plan, duration], facts([plan, duration]),
    `Re-plan against the median of ${counted(duration.numbers.medianDurationDays, 'day')}, or cut scope to fit ${counted(plannedDays, 'day')}.`);
}

function scopeReason(ofType, subject) {
  const history = ofType('scope-base-rate')[0];
  const current = ofType('scope-current')[0];
  const historyGrows = Boolean(history && history.numbers.epics >= MIN_EPICS && history.numbers.medianGrowthPercent >= SCOPE_HISTORY_PERCENT);
  const currentGrows = Boolean(current && current.numbers.growthPercent >= SCOPE_CURRENT_PERCENT);
  if (!historyGrows && !currentGrows) return null;
  const cited = [historyGrows ? history : null, currentGrows ? current : null];
  return reason('scope-growth', 'Scope will keep growing after the plan is set', historyGrows && currentGrows ? 'High' : 'Medium',
    cited, facts(cited), `Freeze scope for ${subject} and move new work to a follow-up epic.`);
}

// The person with the most open work among those over a load threshold; Medium at most, because
// no base rate exists for load (AC 4).
function loadReason(ofType, subject) {
  const busy = ofType('load-person').filter(({ numbers: n }) => (n.openTotal >= LOAD_MIN_OPEN && n.openTotal >= n.medianOpen * LOAD_MEDIAN_FACTOR)
    || n.otherEpicsInProgress >= LOAD_OTHER_EPICS);
  if (!busy.length) return null;
  const person = busy.reduce((top, item) => (item.numbers.openTotal > top.numbers.openTotal ? item : top));
  const { name } = person.about;
  return reason('load', `${name}'s workload could slow ${subject}`, 'Medium',
    [person, ofType('load-unassigned')[0]], person.fact,
    `Move some of ${name}'s open work items to someone else, or free ${name} from another epic.`);
}

// The rule-based reasons for a pack: at most 5, High before Medium before Low, then in rule order.
// No padding: when no rule fires the list is empty (AC 11).
export function ruleBasedReasons(pack) {
  const ofType = (type) => pack.evidence.filter((item) => item.type === type);
  const subject = shorten(pack.epic.summary, SUBJECT_CHARS);
  const reasons = [
    ...dependencyReasons(pack, ofType, subject),
    slipReason(ofType),
    planReason(ofType),
    scopeReason(ofType, subject),
    loadReason(ofType, subject),
  ].filter(Boolean);
  return reasons
    .map((r, i) => ({ r, i }))
    .sort((a, b) => LIKELIHOOD_ORDER[a.r.likelihood] - LIKELIHOOD_ORDER[b.r.likelihood]
      || RULE_ORDER.indexOf(a.r.ruleId) - RULE_ORDER.indexOf(b.r.ruleId) || a.i - b.i)
    .map(({ r }) => r)
    .slice(0, MAX_REASONS);
}
