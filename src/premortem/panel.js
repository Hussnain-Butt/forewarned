// The epic panel's one data call (story 005): the stored report and evidence, filtered for the
// reader (story 002 AC 2), the comparison set, and whether the user may run. The epic's summary
// and due date come from the stored pack, so the headline matches the report below it.

import { notVisible, readEpic } from './epic.js';
import { readPremortem } from './store.js';
import { hiddenEvidenceIds, packForReader, reportForReader } from './visibility.js';

export async function getPanelData({ deps, epicKey: requestedKey }) {
  const epic = await readEpic(deps.port, requestedKey);
  if (!epic) return { error: notVisible(requestedKey) };
  if (!epic.isEpic) return { error: 'This panel works on epics only.' };
  // Only people who can edit the epic may run (story 003 open question 3, story 005 AC 26).
  const permissions = await deps.port.myPermissions(epic.key);
  const canRun = Boolean(permissions.permissions?.EDIT_ISSUES?.havePermission);
  const stored = await readPremortem(deps.kvs, epic.id);
  if (!stored) return { issueKey: epic.key, canRun, report: null, evidence: [], comparison: null, epic: null };

  const hidden = await hiddenEvidenceIds(deps.port, stored.pack);
  return {
    issueKey: epic.key,
    canRun,
    report: reportForReader(stored.report, hidden),
    evidence: packForReader(stored.pack, hidden).evidence.map(({ id, fact, baseRate, links }) => ({ id, fact, baseRate, links })),
    comparison: stored.pack.comparison,
    epic: { summary: stored.pack.epic.summary, due: stored.pack.epic.due },
  };
}
