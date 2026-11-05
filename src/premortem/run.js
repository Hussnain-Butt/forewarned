// Starting a pre-mortem run (story 003 AC 1–2): the one start function behind the panel's "Run
// pre-mortem" and the agent's run-premortem action. It runs as the user, checks the work item is an
// epic they can edit (everyone who can see the epic reads its pre-mortem), and queues one event per
// epic at a time. Story 009 keeps it inside Forge's free allowance: an epic that hasn't changed since
// its last run in the past 24 hours gets that run back, and each installation starts at most `cap`
// runs per UTC day.

import { notAnEpic, notVisible, readEpic } from './epic.js';
import { readRunCount, readRunStatus, writeRunCount, writeRunStatus } from './store.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
const ISSUE_ID = /^\d+$/;
const DAY_MS = 24 * 60 * 60 * 1000;
// The consumer times out after 300 s; a run "in progress" for longer than this died without
// writing its result, so it must not block new runs for the rest of its 24-hour status expiry.
const STUCK_AFTER_MS = 10 * 60 * 1000;

// Story 009 AC 1, 5: runs per installation per UTC day. The developer's emergency brake is the
// Forge variable FW_DAILY_RUN_CAP: 0 stops every new run after the next deploy.
export const DEFAULT_DAILY_RUN_CAP = 15;

// The cap from the variable's value: a whole number, or the default when it is unset. Anything else
// logs one error line (without the value) and uses the default.
export function dailyRunCap(value, logError) {
  const text = (value ?? '').trim();
  if (!text) return DEFAULT_DAILY_RUN_CAP;
  if (/^\d+$/.test(text)) return Number(text);
  logError(`FW_DAILY_RUN_CAP is not a whole number, so the daily cap is ${DEFAULT_DAILY_RUN_CAP}.`);
  return DEFAULT_DAILY_RUN_CAP;
}

// True while a run is queued or running and not stuck. Shared with the Rovo actions.
export const isRunInProgress = (status, now) => Boolean(status && ['queued', 'running'].includes(status.status)
  && now - Date.parse(status.startedAt ?? 0) < STUCK_AFTER_MS);

// Story 009 AC 6: true when the epic's last run is done, started under 24 hours ago, and neither the
// epic nor any of its children was updated since it started (one count query, as the user). A "done"
// status means the stored pack is from that run: the consumer saves the pack before it writes "done".
// "Updated more than N minutes ago" has no time zone, unlike a JQL date; the extra minute errs
// towards a new run. KVS may return a status after its 24-hour expiry, so the age is checked here.
async function unchangedSince(port, epicId, status, nowMs) {
  const age = nowMs - Date.parse(status?.startedAt);
  if (status?.status !== 'done' || !(age < DAY_MS) || !ISSUE_ID.test(epicId)) return false;
  const minutes = Math.ceil(Math.max(age, 0) / 60000) + 1;
  const { count } = await port.count(`(issue = ${epicId} OR parent = ${epicId}) AND updated >= "-${minutes}m"`);
  return count === 0;
}

// Returns { runId, status: 'started' | 'already-running' }, { status: 'cached', runAt } (the last
// run's finish time), { status: 'capped', cap, resetsAt } (the next 00:00 UTC) or { error } (a
// message for the user). `accountId` must come from the Forge context of the caller, never from
// agent inputs; only `force: true` (the panel's "Run again anyway", AC 7) skips the cache.
export async function startRun({ port, kvs, queue, epicKey: requestedKey, accountId, now, newId, cap = DEFAULT_DAILY_RUN_CAP, force = false }) {
  if (!ISSUE_KEY.test(requestedKey ?? '')) return { error: 'No valid epic key was given.' };
  if (!accountId) return { error: "Forewarned couldn't tell who is asking, so it can't start a run." };
  const epic = await readEpic(port, requestedKey);
  if (!epic) return { error: notVisible(requestedKey) };
  const { key: epicKey, id: epicId } = epic;
  if (!epic.isEpic) return { error: notAnEpic(epicKey) };
  const permissions = await port.myPermissions(epicKey);
  if (!permissions.permissions?.EDIT_ISSUES?.havePermission) {
    return { error: `You can view ${epicKey} but can't edit it, so Forewarned can't save a pre-mortem on it.` };
  }

  const nowMs = now();
  const current = await readRunStatus(kvs, epicId);
  if (isRunInProgress(current, nowMs)) return { runId: current.runId, status: 'already-running' };
  if (force !== true && await unchangedSince(port, epicId, current, nowMs)) {
    return { status: 'cached', runAt: current.finishedAt ?? current.startedAt };
  }

  // Story 009 AC 1–4: counted for the UTC day the run starts, before anything is enqueued; a push that fails
  // afterwards still counts (rare, and on the safe side). Two starts at the same moment can let one
  // extra run through (story 009 edge cases).
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const runsToday = await readRunCount(kvs, day);
  if (runsToday >= cap) return { status: 'capped', cap, resetsAt: new Date(Date.parse(day) + DAY_MS).toISOString() };
  await writeRunCount(kvs, day, runsToday + 1);

  // The status is written before the push, so a second click finds the run (AC 2); the queue's
  // concurrency key also keeps two events for one epic from running at the same time.
  // The concurrency key uses only letters, digits and dashes, like queue names.
  const runId = newId();
  const startedAt = new Date(nowMs).toISOString();
  await writeRunStatus(kvs, epicId, { runId, status: 'queued', step: null, startedAt, finishedAt: null, error: null });
  try {
    await queue.push({ body: { runId, epicKey, epicId, accountId }, concurrency: { key: `run-${epicId}`, limit: 1 } });
  } catch (error) {
    // Without this, the epic would show a run "in progress" that never started.
    await writeRunStatus(kvs, epicId, { runId, status: 'failed', step: null, startedAt, finishedAt: startedAt, error: "Forewarned couldn't start the run. Try again in a minute." });
    throw error;
  }
  return { runId, status: 'started' };
}
