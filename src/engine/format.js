// Date and number helpers for the evidence engine (story 002).
//
// The engine counts in whole UTC days: every Jira date becomes a "day number" (days since
// 1 Jan 1970, UTC), so "days late" and "days overdue" are simple subtractions (AC 10).

const DAY_MS = 86400000;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Jira sends "2026-03-12" (due dates), "2026-03-12T10:00:00.000+0100" (timestamps) and, in bulk
// changelogs, epoch numbers. Numbers below 1e11 are seconds, larger ones milliseconds. A missing
// or unreadable value gives null, so callers can fall back instead of computing with NaN.
export function dayOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? (value < 1e11 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / DAY_MS) : null;
}

// Day number -> "2026-03-12", for the pack's machine-readable fields.
export const isoDay = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

// Day number -> "12 Mar 2026", for fact text. A fixed month list keeps it independent of locale.
export function formatDay(day) {
  const date = new Date(day * DAY_MS);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// Whole-number percentage of part in whole (AC 27); 0 when the whole is 0.
export const percent = (part, whole) => (whole === 0 ? 0 : Math.round((100 * part) / whole));

// Median rounded to a whole number, so facts never show "21.5 days".
export function roundedMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

// Work item summaries inside facts and links are cut to 80 characters (AC 30). Counting code
// points (Array.from) instead of UTF-16 units keeps emoji and other astral characters whole.
export function shorten(text, max = 80) {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

// 5121 -> "5,121" (AC 27 example).
export const formatCount = (n) => n.toLocaleString('en-US');

// Sorts work item keys like Jira does: by space key, then by number ("CHK-9" before "CHK-10").
export function compareKeys(a, b) {
  const [spaceA, numberA] = a.split('-');
  const [spaceB, numberB] = b.split('-');
  return spaceA === spaceB ? Number(numberA) - Number(numberB) : spaceA < spaceB ? -1 : 1;
}

// The count with its noun in the right number: "1 work item", "5,121 work items", "1 person".
export const counted = (n, singular, plural = `${singular}s`) => `${formatCount(n)} ${n === 1 ? singular : plural}`;
