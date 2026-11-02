// Starting a pre-mortem run (story 003 AC 1–2): the one start function behind the panel's "Run
// pre-mortem" and the agent's run-premortem action. It runs as the user, checks the work item is an
// epic they can edit (the report is saved on it), and queues one event per epic at a time.

import { readRunStatus, writeRunStatus } from './store.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
// The consumer times out after 300 s; a run "in progress" for longer than this died without
// writing its result, so it must not block new runs for the rest of its 24-hour status expiry.
const STUCK_AFTER_MS = 10 * 60 * 1000;

const inProgress = (status, now) => status && ['queued', 'running'].includes(status.status)
  && now - Date.parse(status.startedAt ?? 0) < STUCK_AFTER_MS;

// Returns { runId, status: 'started' | 'already-running' } or { error } (a message for the user).
// `accountId` must come from the Forge context of the caller, never from agent inputs.
export async function startRun({ port, kvs, queue, epicKey: requestedKey, accountId, now, newId }) {
  if (!ISSUE_KEY.test(requestedKey ?? '') || !accountId) return { error: 'No valid epic key was given.' };
  let issue;
  try {
    issue = await port.issue(requestedKey, ['issuetype']);
  } catch (error) {
    if (error.status === 404) return { error: `${requestedKey} doesn't exist, or you don't have permission to see it.` };
    throw error;
  }
  const epicKey = issue.key;
  if (issue.fields.issuetype?.hierarchyLevel !== 1) return { error: `${epicKey} is not an epic. Forewarned runs pre-mortems on epics only.` };
  const permissions = await port.myPermissions(epicKey);
  if (!permissions.permissions?.EDIT_ISSUES?.havePermission) {
    return { error: `You can view ${epicKey} but can't edit it, so Forewarned can't save a pre-mortem on it.` };
  }

  const current = await readRunStatus(kvs, epicKey);
  if (inProgress(current, now())) return { runId: current.runId, status: 'already-running' };

  // The status is written before the push, so a second click finds the run (AC 2); the queue's
  // concurrency key also keeps two events for one epic from running at the same time.
  const runId = newId();
  await writeRunStatus(kvs, epicKey, { runId, status: 'queued', step: null, startedAt: new Date(now()).toISOString(), finishedAt: null, error: null });
  await queue.push({ body: { runId, epicKey, accountId }, concurrency: { key: `run:${epicKey}`, limit: 1 } });
  return { runId, status: 'started' };
}
