// Storage for the pre-mortem pipeline (story 003), all in Forge KVS and never on the epic: Jira
// lets anyone who can browse an epic read and edit its entity properties, which would skip both
// the reader filter (visibility.js) and the validator. Per epic there are two keys, by issue ID
// (a key changes when the epic moves, and a deleted space's keys can come back):
// - the run status (AC 4), replaced on every write so it never grows, expiring after 24 hours;
// - the latest pre-mortem, the evidence pack and the report as one value, so the two are always
//   written and read together and can't come from different runs.
// A third, per user, remembers for a few minutes that they asked the agent (below).
// The KVS object is passed in, so tests use a fake.

const RUN_STATUS_TTL = { unit: 'HOURS', value: 24 };
const runKey = (epicId) => `run:${epicId}`;
const premortemKey = (epicId) => `premortem:${epicId}`;

// The epic's run status, or null when there is none (or it expired).
export async function readRunStatus(kvs, epicId) {
  return (await kvs.get(runKey(epicId))) ?? null;
}

// Replaces the epic's run status; every write restarts the 24-hour expiry.
export const writeRunStatus = (kvs, epicId, status) => kvs.set(runKey(epicId), status, { ttl: RUN_STATUS_TTL });

// The epic's latest { pack, report }, or null when no run has saved one.
export async function readPremortem(kvs, epicId) {
  return (await kvs.get(premortemKey(epicId))) ?? null;
}

export const writePremortem = (kvs, epicId, { pack, report }) => kvs.set(premortemKey(epicId), { pack, report });

// "Waiting for the agent" (story 005 AC 19), per epic and user for 5 minutes: opening Rovo remounts
// the Jira panel, so the panel's own state can't hold it.
const AGENT_REQUEST_TTL = { unit: 'MINUTES', value: 5 };
const agentRequestKey = (epicId, accountId) => `agent:${epicId}:${accountId}`;

export async function readAgentRequest(kvs, epicId, accountId) {
  return (await kvs.get(agentRequestKey(epicId, accountId))) ?? null;
}

export const writeAgentRequest = (kvs, epicId, accountId, request) => kvs.set(agentRequestKey(epicId, accountId), request, { ttl: AGENT_REQUEST_TTL });

// Story 006 AC 10: which task each reason got, by fingerprint, and the last batch's results (so a
// panel that `view.refresh()` remounted can show them again). In KVS, not on the epic: anyone who
// can browse the epic could read the cited keys in an entity property (story 003 AC 6).
const actionsKey = (epicId) => `actions:${epicId}`;

export async function readActions(kvs, epicId) {
  return (await kvs.get(actionsKey(epicId))) ?? { tasks: {}, lastBatch: null };
}

export const writeActions = (kvs, epicId, actions) => kvs.set(actionsKey(epicId), actions);

// Story 006 AC 4: one create at a time per epic. The lock expires after 60 seconds, but KVS may
// return an expired value for up to 48 hours, so a lock 60 s or older (a crashed call) is taken over.
const TASKS_LOCK_MS = 60000;
const TASKS_LOCK_TTL = { unit: 'SECONDS', value: TASKS_LOCK_MS / 1000 };
const tasksLockKey = (epicId) => `tasks-lock:${epicId}`;

// True when this call now holds the lock.
export async function takeTasksLock(kvs, epicId, nowMs) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await kvs.set(tasksLockKey(epicId), { at: nowMs }, { keyPolicy: 'FAIL_IF_EXISTS', ttl: TASKS_LOCK_TTL });
      return true;
    } catch (error) {
      // KVS doesn't document the error for an existing key, so the lock itself is read: no lock
      // means the write failed for another reason.
      const held = await kvs.get(tasksLockKey(epicId));
      if (!held) throw error;
      if (nowMs - held.at < TASKS_LOCK_MS) return false;
      await kvs.delete(tasksLockKey(epicId));
    }
  }
  return false;
}

export const releaseTasksLock = (kvs, epicId) => kvs.delete(tasksLockKey(epicId));
