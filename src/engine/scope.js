// Signal 2, scope growth (story 002 AC 16–17): how much the current epic has grown since it
// started, against how much comparable epics grew after their start.
//
// Children "at the start" are those created on or before the epic's start day; the importer stamps
// parent links with the import date (M0c), so parent changes are never read.

import { formatCount, formatDay, percent, roundedMedian } from './format.js';

const MIN_EPICS = 3;
const MAX_LINKS = 10;

const draft = (type, fact, links, baseRate, numbers) => ({ type, signal: 'scope', fact, links, baseRate, numbers });

// Returns the scope check and its drafts: the current epic's growth, then the base rate.
export function scopeSignal(snapshot, comparison) {
  const { epic } = snapshot;
  const notes = [];
  const drafts = [];

  const a = epic.childCountAtStart;
  const t = epic.childCount;
  const n = formatCount;
  const started = `${epic.key} started on ${formatDay(epic.start)} with ${n(a)} work items`;
  let fact = null;
  if (t === 0) notes.push(`${epic.key} has no child work items yet.`);
  else if (t < a) fact = `${started} and now has ${n(t)}, ${n(a - t)} fewer.`;
  else if (a === 0) fact = `${started} and has gained ${n(t)} since; it now has ${n(t)}.`;
  else fact = `${started} and has gained ${n(t - a)} since, ${percent(t - a, a)}% more; it now has ${n(t)}.`;
  if (fact) {
    drafts.push(draft('scope-current', fact, [{ key: epic.key, summary: epic.summary }], false, {
      atStart: a,
      added: Math.max(t - a, 0),
      growthPercent: a > 0 && t >= a ? percent(t - a, a) : null,
      total: t,
    }));
  }

  // AC 17: growth of comparable epics; an epic with 0 children at its start has no percentage.
  const measured = comparison.epics.filter((e) => e.details);
  const counted = measured.filter((e) => e.details.childCountAtStart > 0);
  const leftOut = measured.length - counted.length;
  if (counted.length >= MIN_EPICS) {
    const growth = counted.map((e) => percent(e.details.childCount - e.details.childCountAtStart, e.details.childCountAtStart));
    const range = `${counted.length} epics, from ${Math.min(...growth)}% to ${Math.max(...growth)}%`;
    const extra = leftOut ? `; ${leftOut} left out because they had no work items at their start` : '';
    drafts.push(draft(
      'scope-base-rate',
      `Comparable epics gained a median of ${roundedMedian(growth)}% more work items after they started (${range}${extra}).`,
      counted.slice(0, MAX_LINKS).map((e) => ({ key: e.key, summary: e.summary })),
      true,
      {
        medianGrowthPercent: roundedMedian(growth),
        epics: counted.length,
        minGrowthPercent: Math.min(...growth),
        maxGrowthPercent: Math.max(...growth),
        leftOut,
      },
    ));
  } else {
    notes.push('Fewer than 3 comparable epics had work items at their start, so there is no scope base rate.');
  }

  return { check: { status: drafts.length ? 'found' : 'insufficient', note: notes.join(' ') }, drafts };
}
