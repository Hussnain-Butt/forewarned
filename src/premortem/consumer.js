// Queue consumer of the pre-mortem run (story 003). For now this is the platform check of M3 Task 1:
// it counts the epic's children as the user who started the run (offline user impersonation,
// `api.asUser(accountId)`) and stores the result in the run status. Task 6 replaces the body with
// the full run (evidence pack, rule-based reasons, validator, report).

import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { writeRunStatus } from './store.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

export async function handler(event) {
  const { runId, epicKey, accountId } = event.body ?? {};
  if (!ISSUE_KEY.test(epicKey ?? '') || !accountId) {
    console.log('Platform check skipped: the event has no valid epic key or account');
    return;
  }
  const finish = (fields) => writeRunStatus(kvs, epicKey, { runId, step: 'check', finishedAt: new Date().toISOString(), ...fields });
  try {
    const response = await api.asUser(accountId).requestJira(route`/rest/api/3/search/approximate-count`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql: `parent = "${epicKey}"` }),
    });
    const count = response.ok ? (await response.json()).count : null;
    await finish({ status: response.ok ? 'done' : 'failed', count, error: response.ok ? null : `Jira returned status ${response.status}.` });
    console.log(`Platform check: status ${response.status}, ${count} children`);
  } catch (error) {
    // Returning normally stops the queue from retrying for 24 hours (story 003 AC 8).
    await finish({ status: 'failed', count: null, error: 'The platform check failed.' });
    console.log(`Platform check failed: ${error.name}`);
  }
}
