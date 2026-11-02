// Signal 3, load per person (story 002 AC 18–22): who works on the epic, how much open work each
// of them carries in total, and how much of the epic's open work nobody owns.

import { counted, formatCount, percent, roundedMedian } from './format.js';

const MAX_PEOPLE_FACTS = 10;
const MAX_PEOPLE_COUNTED = 25;
const MAX_LINKS = 10;

// People on the epic: its assignee plus the assignees of its open children (AC 18), with how many
// of those open children each one has, most first. Fetch uses the same order to decide whose
// totals it counts (first 25) and whose other epics it reads (first 10).
export function rankPeople(epic) {
  const byId = new Map();
  const add = (person, n) => {
    if (!person) return;
    const entry = byId.get(person.accountId) ?? { person, openInEpic: 0 };
    entry.openInEpic += n;
    byId.set(person.accountId, entry);
  };
  add(epic.assignee, 0);
  for (const child of epic.openChildren.read) add(child.assignee, 1);
  return [...byId.values()].sort((a, b) => b.openInEpic - a.openInEpic
    || compareText(a.person.displayName, b.person.displayName)
    || compareText(a.person.accountId, b.person.accountId));
}

// Plain code-unit order: unlike localeCompare it gives the same order in every runtime (AC 31).
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// `about` names the person, so the rule-based reasons (story 004) never parse fact text.
const draft = (type, fact, links, numbers, about) => ({ type, signal: 'load', fact, links, baseRate: false, numbers, ...(about ? { about } : {}) });

// Returns the load check and its drafts: one per person (first 10), then the unassigned work.
export function loadSignal(snapshot) {
  const { epic } = snapshot;
  const ranked = rankPeople(epic);
  const inEpic = new Map(ranked.map((r) => [r.person.accountId, r.openInEpic]));
  const people = epic.people;
  const notes = [];
  const drafts = [];
  if (epic.openChildren.total > epic.openChildren.read.length) notes.push(`Based on the first ${formatCount(epic.openChildren.read.length)} open work items.`);
  if (ranked.length > MAX_PEOPLE_COUNTED) notes.push('The median is based on the 25 people with the most open work items in this epic.');

  const median = people.length ? roundedMedian(people.map((p) => p.openTotal)) : 0;
  const n = formatCount;
  for (const { person, openTotal: countedTotal, otherEpics } of people.slice(0, MAX_PEOPLE_FACTS)) {
    const x = inEpic.get(person.accountId) ?? 0;
    // Search counts can lag behind the read, so the total is never below the work in this epic.
    const openTotal = Math.max(countedTotal, x);
    const others = otherEpics ?? [];
    let fact = `${person.displayName} has ${counted(openTotal, 'open work item')} in total, ${n(x)} of them in this epic (${percent(x, openTotal)}%; ${n(openTotal - x)} elsewhere); the median for the ${counted(people.length, 'person', 'people')} on this epic is ${n(median)}.`;
    if (others.length) fact += ` ${person.displayName} also has open work items in ${others.length} other ${others.length === 1 ? 'epic' : 'epics'} in progress: ${others.map((e) => e.key).join(', ')}.`;
    drafts.push(draft('load-person', fact, [{ key: epic.key, summary: epic.summary }, ...others].slice(0, MAX_LINKS), {
      openTotal,
      openInEpic: x,
      openElsewhere: openTotal - x,
      peopleOnEpic: people.length,
      medianOpen: median,
      otherEpicsInProgress: others.length,
    }, { name: person.displayName }));
  }

  // AC 20: unassigned open work, counted exactly by fetch (not only from the capped read).
  const t = epic.openChildren.total;
  const u = epic.openChildren.unassignedTotal;
  if (u > 0) {
    drafts.push(draft('load-unassigned', `${n(u)} of ${counted(t, 'open work item')} in this epic ${u === 1 ? 'is' : 'are'} unassigned (${percent(u, t)}%; ${n(t - u)} assigned).`,
      [{ key: epic.key, summary: epic.summary }],
      { unassignedOpen: u, open: t, assignedOpen: t - u, unassignedPercent: percent(u, t) }));
  }

  if (!ranked.length) return { check: { status: 'insufficient', note: ['No work items in this epic are assigned yet.', ...notes].join(' ') }, drafts };
  return { check: { status: drafts.length ? 'found' : 'clear', note: notes.join(' ') }, drafts };
}
