// Storage for the pre-mortem pipeline (story 003). The pack and the report live in entity
// properties on the epic (read and written as the user, through the Jira port); the run status
// lives in Forge KVS under one key per epic (AC 4), so it never grows, and expires after 24 hours.
// The port and the KVS object are passed in, so tests use fakes.

export const EVIDENCE_PROPERTY = 'forewarned-evidence';
export const REPORT_PROPERTY = 'forewarned-premortem';

const RUN_STATUS_TTL = { unit: 'HOURS', value: 24 };
const runKey = (epicKey) => `run:${epicKey}`;

// The value of an entity property on the epic, or null when it isn't set.
export async function readProperty(port, epicKey, name) {
  try {
    return (await port.issueProperty(epicKey, name)).value;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export const writeProperty = (port, epicKey, name, value) => port.setIssueProperty(epicKey, name, value);

// The epic's run status, or null when there is none (or it expired).
export async function readRunStatus(kvs, epicKey) {
  return (await kvs.get(runKey(epicKey))) ?? null;
}

// Replaces the epic's run status; every write restarts the 24-hour expiry.
export const writeRunStatus = (kvs, epicKey, status) => kvs.set(runKey(epicKey), status, { ttl: RUN_STATUS_TTL });
