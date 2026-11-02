// Storage for the pre-mortem pipeline (story 003). The run status lives in Forge KVS under one key
// per epic (AC 4), so it never grows; it expires after 24 hours. The KVS object is passed in, so
// tests use a fake and the app passes `kvs` from @forge/kvs.

const RUN_STATUS_TTL = { unit: 'HOURS', value: 24 };
const runKey = (epicKey) => `run:${epicKey}`;

// The epic's run status, or null when there is none (or it expired).
export async function readRunStatus(kvs, epicKey) {
  return (await kvs.get(runKey(epicKey))) ?? null;
}

// Replaces the epic's run status; every write restarts the 24-hour expiry.
export const writeRunStatus = (kvs, epicKey, status) => kvs.set(runKey(epicKey), status, { ttl: RUN_STATUS_TTL });
