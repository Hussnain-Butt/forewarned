// Entry point of the evidence engine (story 002): fetch the Snapshot, compute the pack, stamp it
// and log one line per run (AC 33). Callers pass the senders, so the same code runs in Forge
// (forge-jira.js), in tests and in the site runner.

import { fetchSnapshot } from './fetch.js';
import { dayOf } from './format.js';
import { createJira } from './jira.js';
import { computePack } from './pack.js';

// Retries stop once they would end after this many milliseconds; Rovo actions get 55 s in total.
const BUDGET_MS = 45000;

// Returns { pack } or { error } (a message for the user). Jira failures throw a JiraError.
export async function buildEvidencePack({ senders, epicKey, accountId, now = Date.now }) {
  const started = now();
  const port = createJira(senders, { deadline: started + BUDGET_MS, now });
  const result = await fetchSnapshot(port, epicKey, { today: dayOf(started), accountId });
  if (result.error) return { error: result.error };
  const pack = { ...computePack(result.snapshot), builtAt: new Date(started).toISOString() };
  // Counts only: no keys, summaries or names reach the logs.
  console.log(`Evidence pack: ${port.requestCount} Jira requests, ${now() - started} ms, ${Buffer.byteLength(JSON.stringify(pack), 'utf8')} bytes, ${pack.evidence.length} evidence items`);
  return { pack };
}
