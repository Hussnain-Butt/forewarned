// Storage for the pre-mortem pipeline (story 003), all in Forge KVS and never on the epic: Jira
// lets anyone who can browse an epic read and edit its entity properties, which would skip both
// the reader filter (visibility.js) and the validator. Per epic there are two keys, by issue ID
// (a key changes when the epic moves, and a deleted space's keys can come back):
// - the run status (AC 4), replaced on every write so it never grows, expiring after 24 hours;
// - the latest pre-mortem, the evidence pack and the report as one value, so the two are always
//   written and read together and can't come from different runs.
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
