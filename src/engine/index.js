// Entry point of the evidence engine (story 002): fetch the Snapshot, compute the pack, stamp it
// and log one line per run (AC 33). Callers pass the senders, so the same code runs in Forge
// (forge-jira.js), in tests and in the site runner.

import { fetchSnapshot } from './fetch.js';
import { dayOf } from './format.js';
import { createJira } from './jira.js';
import { computePack } from './pack.js';

// Retries stop once they would end after this many milliseconds; Rovo actions get 55 s in total.
const BUDGET_MS = 45000;

// Returns { pack } or { error } (a message for the user). Jira failures throw a JiraError. With
// `onSummary`, the counts go to it instead of the log line, so the pre-mortem run can log one line
// of its own (story 009 AC 11).
export async function buildEvidencePack({ senders, epicKey, accountId, now = Date.now, onStep, onSummary }) {
  const started = now();
  const port = createJira(senders, { deadline: started + BUDGET_MS, now });
  let pack = null;
  try {
    const result = await fetchSnapshot(port, epicKey, { today: dayOf(started), now: started, accountId, onStep });
    if (result.error) return { error: result.error };
    pack = { ...computePack(result.snapshot), builtAt: new Date(started).toISOString() };
    return { pack };
  } finally {
    // One line per run, also when it fails (AC 33). Counts only: no keys, summaries or names.
    const summary = {
      requests: port.requestCount,
      ms: now() - started,
      bytes: pack ? Buffer.byteLength(JSON.stringify(pack), 'utf8') : null,
      evidence: pack ? pack.evidence.length : null,
    };
    const spent = `${summary.requests} Jira requests, ${summary.ms} ms`;
    if (onSummary) onSummary(summary);
    else console.log(pack ? `Evidence pack: ${spent}, ${summary.bytes} bytes, ${summary.evidence} evidence items` : `Evidence pack: not built, ${spent}`);
  }
}
