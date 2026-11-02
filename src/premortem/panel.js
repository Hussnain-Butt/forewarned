// The epic panel's data calls (story 005). getPanelData returns the stored report and evidence,
// filtered for the reader (story 002 AC 2), the comparison set, whether the user may run, and
// whether they asked the agent a moment ago. The epic's summary and due date come from the stored
// pack, so the headline matches the report below it.

import { notVisible, readEpic } from './epic.js';
import { readAgentRequest, readPremortem, writeAgentRequest } from './store.js';
import { hiddenEvidenceIds, packForReader, reportForReader } from './visibility.js';

const NOT_AN_EPIC = 'This panel works on epics only.';

export async function getPanelData({ deps, epicKey: requestedKey, accountId }) {
  const epic = await readEpic(deps.port, requestedKey);
  if (!epic) return { error: notVisible(requestedKey) };
  if (!epic.isEpic) return { error: NOT_AN_EPIC };
  // Only people who can edit the epic may run (story 003 open question 3, story 005 AC 26).
  const permissions = await deps.port.myPermissions(epic.key);
  const canRun = Boolean(permissions.permissions?.EDIT_ISSUES?.havePermission);
  const agentRequest = accountId ? await readAgentRequest(deps.kvs, epic.id, accountId) : null;
  const stored = await readPremortem(deps.kvs, epic.id);
  if (!stored) return { issueKey: epic.key, canRun, report: null, evidence: [], comparison: null, epic: null, agentRequest };

  const hidden = await hiddenEvidenceIds(deps.port, stored.pack);
  return {
    issueKey: epic.key,
    canRun,
    report: reportForReader(stored.report, hidden),
    evidence: packForReader(stored.pack, hidden).evidence.map(({ id, fact, baseRate, links }) => ({ id, fact, baseRate, links })),
    comparison: stored.pack.comparison,
    epic: { summary: stored.pack.epic.summary, due: stored.pack.epic.due },
    agentRequest,
  };
}

// The panel calls this as it opens Rovo: opening Rovo remounts the panel, and the new panel uses
// the request to keep waiting for the agent's write-up (AC 19). `savedBefore` tells a new
// write-up from the one already there.
export async function requestAgentAction({ deps, epicKey: requestedKey, accountId }) {
  const epic = await readEpic(deps.port, requestedKey);
  if (!epic) return { error: notVisible(requestedKey) };
  if (!epic.isEpic) return { error: NOT_AN_EPIC };
  const stored = await readPremortem(deps.kvs, epic.id);
  const savedBefore = stored?.report?.agent?.savedAt ?? null;
  await writeAgentRequest(deps.kvs, epic.id, accountId, { savedBefore, requestedAt: new Date(deps.now()).toISOString() });
  return { requested: true };
}
