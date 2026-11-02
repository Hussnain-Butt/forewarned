// The pre-mortem report, version 2 (story 003 AC 23–25), stored in Forge KVS next to its pack
// (store.js). It holds the rule-based reasons of the latest run and, when the agent has saved one,
// its validated write-up; only validated fields are ever stored (AC 21).

export const MAX_REPORT_BYTES = 24000;
const MIN_COMPARABLE = 3;

const iso = (ms) => new Date(ms).toISOString();

// Reports stay under 24,000 bytes like the pack (AC 25), so the stored pre-mortem stays small.
function checked(report) {
  if (Buffer.byteLength(JSON.stringify(report), 'utf8') > MAX_REPORT_BYTES) {
    throw new Error('The pre-mortem report is larger than 24,000 bytes.');
  }
  return report;
}

// The report of a run. An agent write-up from an earlier version 2 report is kept, and marked
// stale when it was written against a different pack (AC 6). A version 1 spike report is dropped.
export function buildReport({ pack, ruleReasons, previous, accountId, now }) {
  let status = 'ok';
  if (pack.comparison.epics.length < MIN_COMPARABLE) status = 'insufficient-history';
  else if (!ruleReasons.length) status = 'no-signals';
  const agent = previous?.version === 2 && previous.agent ? { ...previous.agent, stale: previous.agent.packId !== pack.packId } : null;
  return checked({
    version: 2,
    epicKey: pack.epic.key,
    packId: pack.packId,
    status,
    checks: pack.checks,
    ruleBased: { generatedAt: iso(now), reasons: ruleReasons },
    agent,
    runBy: accountId,
    runAt: iso(now),
  });
}

// The report with a new agent write-up (validated reasons only) and who saved it; everything
// else stays.
export function withAgentWriteUp(report, { reasons, droppedByRule, packId, savedBy, now }) {
  return checked({ ...report, agent: { reasons, savedAt: iso(now), savedBy, packId, droppedByRule, stale: packId !== report.packId } });
}
