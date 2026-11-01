// Comparable epics (story 002 AC 4–7): the finished epics whose history the pre-mortem argues from.

import { compareKeys } from './format.js';

const MAX_COMPARABLE = 20;
const MIN_MATCHED = 3;
const LOOKBACK_DAYS = 365;

// Picks the comparison set for `epic` from finished epics of its space. Epics that share a
// component or label are preferred; with fewer than 3 of those, every finished epic from the last
// 365 days is used instead. Returns the rule in words (shown in the pack) and at most 20 epics,
// most recently finished first.
export function selectComparable(epic, candidates, today) {
  const finished = candidates
    .filter((c) => c.key !== epic.key && c.statusCategory === 'done' && c.finish !== null && c.finish >= today - LOOKBACK_DAYS)
    .sort((a, b) => b.finish - a.finish || compareKeys(a.key, b.key));

  const shares = (c) => c.components.some((x) => epic.components.includes(x)) || c.labels.some((x) => epic.labels.includes(x));
  const matched = finished.filter(shares);
  if (matched.length >= MIN_MATCHED) {
    const parts = [];
    if (epic.components.length) parts.push(`components ${epic.components.join(', ')}`);
    if (epic.labels.length) parts.push(`labels ${epic.labels.join(', ')}`);
    return { rule: `matched on ${parts.join(' and ')}`, epics: matched.slice(0, MAX_COMPARABLE) };
  }
  return { rule: `all finished epics in ${epic.space} from the last 12 months`, epics: finished.slice(0, MAX_COMPARABLE) };
}
