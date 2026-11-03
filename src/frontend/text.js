// The epic panel's wording and dates (story 005), kept out of the JSX so they are tested in Node.
// Dates read "15 Mar 2027" everywhere (open question 3), like the evidence facts.

import { MONTHS, counted, dayOf, formatDay } from '../engine/format.js';
import { cut } from '../premortem/validator.js';

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const CHIP_SUMMARY_CHARS = 30;
const NO_BASE_RATE = 'No base rate in this history, so likelihood is capped at Medium.';
const RANK = { High: 0, Medium: 1, Low: 2 };

const day = (iso) => formatDay(dayOf(iso));

// `date` plus `months`, on the same day of the month or the month's last day (30 Nov → 28 Feb).
function plusMonths(date, months) {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return first;
}

// AC 8: launch day is the due date, or today plus 3 months when there is none.
export function headline({ summary, due, today }) {
  const date = due ? day(due) : formatDay(dayOf(plusMonths(today, 3).getTime()));
  return {
    text: `It's ${date}, and ${summary} has failed. Here's why.`,
    note: due ? null : 'No due date is set, so Forewarned imagines launch day 3 months from today.',
  };
}

// AC 5: the run's steps (src/premortem/consumer.js) in order, with the current one marked. An
// unknown or missing step leaves every line still to do.
const STEPS = ['comparable epics', 'past epics', 'scope', 'load', 'dependencies', 'writing'];
const stepLabel = (step, count) => ({
  'comparable epics': 'Finding comparable epics',
  'past epics': Number.isInteger(count) ? `Reading ${counted(count, 'past epic')}` : 'Reading past epics',
  scope: 'Checking scope growth',
  load: 'Checking team load',
  dependencies: 'Checking dependencies',
  writing: 'Writing the pre-mortem',
}[step]);

export function stepLines(status) {
  const current = status?.status === 'running' ? STEPS.indexOf(status.step) : -1;
  return STEPS.map((step, i) => {
    let state = 'todo';
    if (current >= 0 && i < current) state = 'done';
    if (current >= 0 && i === current) state = 'current';
    return { step, label: stepLabel(step, status?.count), state };
  });
}

// AC 9: the lozenge says the level in words, never by colour alone.
export function likelihoodLozenge(level) {
  const appearance = { High: 'removed', Medium: 'moved' }[level] ?? 'default';
  return { text: `${level} likelihood`, appearance };
}

// AC 9–11: what one reason card shows. `evidenceById` is a Map of the reader's evidence items; the
// epic itself is never a chip, and a work item linked by several cited items is one chip. The
// specific work items come first and a base rate's comparison epics last, so the 4 chips shown
// first are the ones the reason is about.
export function cardParts(reason, evidenceById, epicKey) {
  const cited = (reason.evidenceIds || []).map((id) => evidenceById.get(id)).filter(Boolean);
  const baseRateLine = reason.baseRateFact ?? cited.find((item) => item.baseRate)?.fact ?? NO_BASE_RATE;
  const rest = (reason.explanation || '').replace(baseRateLine, '').replace(/\s{2,}/g, ' ').trim();
  const chips = [];
  const specificFirst = [...cited.filter((item) => !item.baseRate), ...cited.filter((item) => item.baseRate)];
  for (const link of specificFirst.flatMap((item) => item.links || [])) {
    if (link.key === epicKey || chips.some((chip) => chip.key === link.key)) continue;
    chips.push({ key: link.key, label: `${link.key} ${cut(link.summary, CHIP_SUMMARY_CHARS)}`, url: link.url, name: `Open ${link.key}, ${link.summary}, in a new tab` });
  }
  return { baseRateLine, explanation: rest || null, chips, facts: cited.map(({ id, fact }) => ({ id, fact })) };
}

// AC 21: shown only when the validator dropped some of the agent's reasons.
export function droppedLine(agent) {
  const dropped = Object.values(agent?.droppedByRule || {}).reduce((sum, n) => sum + n, 0);
  if (!dropped) return null;
  const proposed = (agent.reasons || []).length + dropped;
  const verb = dropped === 1 ? 'was dropped because its evidence' : 'were dropped because their evidence';
  return `The agent proposed ${counted(proposed, 'reason')}; ${dropped} ${verb} didn't check out.`;
}

// The agent's reasons, High before Medium before Low; the order within a level stays.
export const sortByLikelihood = (reasons) => [...(reasons || [])].sort((a, b) => (RANK[a.likelihood] ?? 3) - (RANK[b.likelihood] ?? 3));

// AC 13: the comparison set line and one row per epic.
export function comparisonParts(comparison, space) {
  const epics = comparison?.epics || [];
  const detail = (e) => {
    if (!e.due) return `no due date, finished ${day(e.finish)}`;
    let late = 'on time';
    if (e.daysLate > 0) late = `${counted(e.daysLate, 'day')} late`;
    if (e.daysLate < 0) late = `${counted(-e.daysLate, 'day')} early`;
    return `due ${day(e.due)}, finished ${day(e.finish)}, ${late}`;
  };
  return {
    line: `Compared with ${counted(epics.length, 'finished epic')} in ${space} (${comparison?.rule})`,
    rows: epics.map((e) => ({ key: e.key, label: `${e.key} ${e.summary}`, url: e.url, detail: detail(e) })),
  };
}

// AC 22: the insufficient-history message. The count is in the slip check's note just below.
export const historyLine = (space) => `Not enough history in ${space} for slip patterns. Here is what Forewarned could still check:`;

// AC 22–23: each check, in a fixed order.
export function checkLines(checks) {
  const labels = { slip: 'Slip history', scope: 'Scope growth', load: 'Team load', dependencies: 'Dependencies' };
  const statuses = { found: 'Found', clear: 'Clear', insufficient: 'Not enough data' };
  return Object.entries(labels).map(([signal, label]) => ({
    label,
    status: statuses[checks?.[signal]?.status] ?? 'Not checked',
    note: checks?.[signal]?.note ?? '',
  }));
}

// AC 14: "Last run 5 minutes ago".
export function relativeTime(iso, now) {
  const ms = now - Date.parse(iso);
  if (ms < 60000) return 'just now';
  if (ms < HOUR_MS) return `${counted(Math.floor(ms / 60000), 'minute')} ago`;
  if (ms < DAY_MS) return `${counted(Math.floor(ms / HOUR_MS), 'hour')} ago`;
  return `${counted(Math.floor(ms / DAY_MS), 'day')} ago`;
}

// The exact date and time, in the reader's time zone unless `timeZone` is given: "2 Nov 2026, 17:26".
export function exactTime(iso, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
  }).formatToParts(new Date(iso)).map(({ type, value }) => [type, value]));
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

// AC 27: a report more than 24 hours old.
export const isOld = (iso, now) => now - Date.parse(iso) > DAY_MS;

// Story 006: the ticked reasons in the order the panel shows them, so the new keys follow that order.
export const inReasonOrder = (reasons, selected) => reasons.map((reason) => reason.fingerprint).filter((fp) => selected.has(fp));

// Story 006 AC 2: the button's live count.
export const createLabel = (count) => (count ? `Create ${counted(count, 'task')}` : 'Create tasks');

// Story 006 AC 8, 12–13: the results message for one create, in words. `line` comes before the new
// keys, which the panel shows as links joined with ", " and ending with "."; an existing task counts
// as created. `notes` say when a new task isn't under the epic (AC 5).
export function taskResultParts(results) {
  const created = results.filter((result) => result.key).map(({ key, url }) => ({ key, url }));
  const failures = results.filter((result) => result.error).map(({ title, error }) => ({ title, error }));
  const notes = results.filter((result) => result.key && !result.existed && result.asChild === false).map((result) => (result.linked
    ? `${result.key} couldn't go under the epic, so it is linked to it with 'relates to'.`
    : `${result.key} couldn't go under the epic or be linked to it. Link it to the epic in Jira.`));
  if (!created.length) {
    return { appearance: 'error', line: `Forewarned couldn't create the ${results.length === 1 ? 'task' : 'tasks'}.`, created, notes, failures };
  }
  const all = created.length === results.length;
  return {
    appearance: all ? 'success' : 'warning',
    line: all ? `Created ${counted(created.length, 'task')}: ` : `Created ${created.length} of ${counted(results.length, 'task')}: `,
    created,
    notes,
    failures,
  };
}
