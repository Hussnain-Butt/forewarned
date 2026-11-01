// Signal 4, dependencies and blockers (story 002 AC 23–25): what blocks the epic now, and how
// comparable epics fared when their work was blocked by other spaces.

import { compareKeys, formatDay, percent, shorten } from './format.js';

const MAX_OPEN = 5;
const MAX_HISTORY = 3;
const MAX_LINKS = 10;

const link = (x) => ({ key: x.key, summary: x.summary });
const draft = (type, fact, links, baseRate, numbers) => ({ type, signal: 'dependencies', fact, links, baseRate, numbers });

// Returns the dependency check and its drafts: open blockers (at most 5), the history per blocking
// space (at most 3), then the strongest past example.
export function dependencySignal(snapshot, comparison) {
  const { epic, blockers, today } = snapshot;
  if (!snapshot.linkTypeFound) return { check: { status: 'clear', note: "No 'is blocked by' link type found on this site." }, drafts: [] };
  const drafts = [];

  // AC 23: blockers that are not done. Resolved blockers are never reported as open (decoy D1).
  const open = [];
  for (const child of epic.blocked) {
    for (const key of child.blockerKeys) {
      const b = blockers[key];
      if (!b || b.statusCategory === 'done') continue;
      const daysOverdue = b.due === null ? null : Math.max(today - b.due, 0);
      open.push({ child, b, daysOverdue });
    }
  }
  open.sort((x, y) => (y.b.space !== epic.space) - (x.b.space !== epic.space)
    || (y.b.assignee === null) - (x.b.assignee === null)
    || (y.daysOverdue ?? -1) - (x.daysOverdue ?? -1)
    || compareKeys(x.b.key, y.b.key) || compareKeys(x.child.key, y.child.key));
  for (const { child, b, daysOverdue } of open.slice(0, MAX_OPEN)) {
    let due = 'no due date';
    if (b.due !== null) due = daysOverdue > 0 ? `due ${formatDay(b.due)}, ${daysOverdue} days overdue` : `due ${formatDay(b.due)}`;
    const target = child.key === epic.key ? 'this epic' : `${child.key} ${shorten(child.summary)} in this epic`;
    drafts.push(draft('open-blocker', `${b.key} ${shorten(b.summary)} (${b.space}, ${b.statusName}, ${b.assignee?.displayName ?? 'unassigned'}, ${due}) blocks ${target}.`,
      [link(b), link(child)], false, { daysOverdue }));
  }

  // AC 24: per blocking space, how many comparable epics with blocked work finished late. Only
  // epics with a due date count, because lateness needs one.
  const dated = comparison.epics.filter((e) => e.details && e.due !== null);
  const bySpace = new Map();
  for (const e of dated) {
    const spaces = new Set(e.details.blocked.flatMap((c) => c.blockerKeys.map((k) => blockers[k]?.space).filter(Boolean)));
    for (const space of spaces) bySpace.set(space, [...(bySpace.get(space) ?? []), e]);
  }
  const history = [...bySpace.entries()].sort(([sa, a], [sb, b]) => b.length - a.length || (sa < sb ? -1 : 1));
  for (const [space, epics] of history.slice(0, MAX_HISTORY)) {
    const n = epics.length;
    const k = epics.filter((e) => e.finish - e.due > 0).length;
    drafts.push(draft('blocker-history', `${k} of ${n} comparable epics that had work blocked by ${space} work items finished late (${percent(k, n)}%; ${n - k} on time).`,
      epics.slice(0, MAX_LINKS).map(link), n >= 2, { late: k, epics: n }));
  }

  // AC 25: the late comparable epic whose blocker was itself resolved after its own due date.
  const examples = [];
  for (const e of dated) {
    const daysLate = e.finish - e.due;
    if (daysLate <= 0) continue;
    for (const child of e.details.blocked) {
      for (const key of child.blockerKeys) {
        const b = blockers[key];
        if (b?.due != null && b.resolved != null && b.resolved > b.due) examples.push({ e, child, b, daysLate, after: b.resolved - b.due });
      }
    }
  }
  examples.sort((x, y) => y.daysLate - x.daysLate || y.after - x.after || compareKeys(x.e.key, y.e.key));
  if (examples.length) {
    const { e, child, b, daysLate, after } = examples[0];
    drafts.push(draft('blocker-example',
      `${e.key} ${shorten(e.summary)} finished ${daysLate} days late; its work item ${child.key} ${shorten(child.summary)} was blocked by ${b.key} ${shorten(b.summary)}, which was resolved ${after} days after its own due date.`,
      [link(e), link(child), link(b)], false, { daysLate, blockerDaysAfterOwnDue: after }));
  }

  const notes = open.length ? [...snapshot.notes] : ['No open blockers.', ...snapshot.notes];
  return { check: { status: drafts.length ? 'found' : 'clear', note: notes.join(' ') }, drafts };
}
