// Signal 1, slip history (story 002 AC 10–15): how late comparable epics finished, how long they
// took, and whether the current plan is shorter than that history.

import { compareKeys, counted, formatDay, percent, roundedMedian, shorten } from './format.js';

const MIN_EPICS = 3;
const MAX_EXAMPLES = 3;
const MAX_LINKS = 10;

const link = (e) => ({ key: e.key, summary: e.summary });
const draft = (type, fact, links, baseRate, numbers) => ({ type, signal: 'slip', fact, links, baseRate, numbers });

// Returns the slip check and its draft evidence, strongest first: the late base rate, the plan
// against history, the duration base rate, then up to 3 of the largest slips.
export function slipSignal(snapshot, comparison) {
  const { epic } = snapshot;
  const epics = comparison.epics.map((e) => ({ ...e, daysLate: e.due === null ? null : e.finish - e.due, duration: e.finish - e.start }));
  const late = epics.filter((e) => e.daysLate > 0).sort((a, b) => b.daysLate - a.daysLate || compareKeys(a.key, b.key));
  const notes = [];
  const drafts = [];
  const enough = epics.length >= MIN_EPICS;

  if (!enough) {
    const found = epics.length ? `Only ${counted(epics.length, 'finished epic')}` : 'No finished epics';
    notes.push(`${found} found in ${epic.space} in the last 12 months; Forewarned needs ${MIN_EPICS} for slip patterns.`);
  } else {
    // AC 11: the share of comparable epics with a due date that finished late.
    const withDue = epics.filter((e) => e.daysLate !== null);
    if (withDue.length) {
      const m = withDue.length;
      const days = late.map((e) => e.daysLate);
      const share = `${late.length} of ${counted(m, 'comparable epic')} with a due date finished late (${percent(late.length, m)}%; ${m - late.length} on time)`;
      let fact = `${share}.`;
      if (late.length === 1) fact = `${share}, by ${counted(days[0], 'day')}.`;
      if (late.length > 1) fact = `${share}, by a median of ${counted(roundedMedian(days), 'day')} (from ${Math.min(...days)} to ${Math.max(...days)} days).`;
      // Links the late epics, or the epics it counted when none was late (AC 26).
      drafts.push(draft('slip-base-rate', fact, (late.length ? late : withDue).slice(0, MAX_LINKS).map(link), true, {
        late: late.length,
        withDueDate: m,
        onTime: m - late.length,
        latePercent: percent(late.length, m),
        medianDaysLate: days.length ? roundedMedian(days) : null,
        minDaysLate: days.length ? Math.min(...days) : null,
        maxDaysLate: days.length ? Math.max(...days) : null,
      }));
    }

    // AC 14: the plan (start to due) against how long comparable epics took.
    if (epic.due !== null && epic.due <= epic.start) {
      notes.push(`${epic.key}'s due date is not after its start, so its plan can't be compared with history.`);
    } else if (epic.due !== null) {
      const p = epic.due - epic.start;
      const n = epics.length;
      const k = epics.filter((e) => e.duration > p).length;
      drafts.push(draft(
        'plan-vs-history',
        `${epic.key} is planned for ${counted(p, 'day')} (started ${formatDay(epic.start)}, due ${formatDay(epic.due)}); ${k} of ${n} comparable epics took longer than ${counted(p, 'day')} (${percent(k, n)}%; ${n - k} took ${counted(p, 'day')} or less).`,
        [link(epic)],
        true,
        { plannedDays: p, longerThanPlan: k, epics: n },
      ));
    }

    // AC 13: every comparable epic counts here, with or without a due date.
    const n = epics.length;
    const withoutDue = epics.filter((e) => e.due === null).length;
    const median = roundedMedian(epics.map((e) => e.duration));
    drafts.push(draft(
      'duration-base-rate',
      `Comparable epics took a median of ${counted(median, 'day')} from start to done (${n} epics: ${n - withoutDue} with a due date and ${withoutDue} without).`,
      epics.slice(0, MAX_LINKS).map(link),
      true,
      { medianDurationDays: median, epics: n, withDueDate: n - withoutDue, withoutDueDate: withoutDue },
    ));
  }

  if (epic.due === null) notes.push(`${epic.key} has no due date, so its plan can't be compared with history.`);

  // AC 12: the largest slips, also when there are too few epics for a base rate (AC 15).
  for (const e of late.slice(0, MAX_EXAMPLES)) {
    drafts.push(draft(
      'slip-example',
      `${e.key} ${shorten(e.summary)} was due ${formatDay(e.due)} and finished ${formatDay(e.finish)}, ${counted(e.daysLate, 'day')} late.`,
      [link(e)],
      false,
      { daysLate: e.daysLate },
    ));
  }

  if (!enough) return { check: { status: 'insufficient', note: notes.join(' ') }, drafts };
  if (!drafts.length) return { check: { status: 'clear', note: ['No comparable epic finished late.', ...notes].join(' ') }, drafts };
  return { check: { status: 'found', note: notes.join(' ') }, drafts };
}
