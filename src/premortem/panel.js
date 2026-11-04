// The epic panel's data calls (story 005). getPanelData returns the stored report and evidence,
// filtered for the reader (story 002 AC 2), the comparison set, whether the user may run, and
// whether they asked the agent a moment ago. The epic's summary and due date come from the stored
// pack, so the headline matches the report below it. For story 006 it adds each reason's
// fingerprint, the tasks that still exist, whether the user may create work items, and their last
// create results. For story 007 it says whether the app is installed in Confluence (`deps.installed`,
// from the Forge app context) and links the epic's Confluence page once there is one.

import { readVisible } from '../engine/fetch.js';
import { EPICS_ONLY, notVisible, readEpic } from './epic.js';
import { readActions, readAgentRequest, readPage, readPremortem, writeAgentRequest } from './store.js';
import { browseUrl, withFingerprints } from './tasks.js';
import { hiddenEvidenceIds, packForReader, reportForReader } from './visibility.js';

// view.refresh() may remount the panel after a create (story 006 open question 2), so its creator
// gets the results back for a few minutes.
const RESULTS_FOR_MS = 5 * 60 * 1000;

export async function getPanelData({ deps, epicKey: requestedKey, accountId }) {
  const epic = await readEpic(deps.port, requestedKey);
  if (!epic) return { error: notVisible(requestedKey) };
  if (!epic.isEpic) return { error: EPICS_ONLY };
  // The five reads don't depend on each other, so they run together (the panel waits on them).
  const [permissions, agentRequest, stored, actions, page] = await Promise.all([
    deps.port.myPermissions(epic.key),
    accountId ? readAgentRequest(deps.kvs, epic.id, accountId) : null,
    readPremortem(deps.kvs, epic.id),
    readActions(deps.kvs, epic.id),
    readPage(deps.kvs, epic.id),
  ]);
  // Only people who can edit the epic may run (story 003 open question 3, story 005 AC 26).
  const canRun = Boolean(permissions.permissions?.EDIT_ISSUES?.havePermission);
  // Story 006 AC 3: tasks go to the epic's current space, as the user.
  const canCreate = Boolean(permissions.permissions?.CREATE_ISSUES?.havePermission);
  const space = epic.project.key;
  // Story 007 AC 11 and 15: unknown counts as available; Confluence's own answer decides on the click.
  const confluence = {
    available: deps.installed !== false,
    page: page && { url: page.url, title: page.title, spaceId: page.spaceId, spaceName: page.spaceName },
  };
  if (!stored) {
    return { issueKey: epic.key, canRun, canCreate, space, report: null, evidence: [], comparison: null, epic: null, agentRequest, tasks: {}, taskResults: null, confluence };
  }

  // The comparison set lists epics by key and summary, so it is read again as the reader too, and
  // so are the tasks: one the reader can't read was deleted and its reason can be ticked again
  // (story 006 AC 11).
  const { comparison } = stored.pack;
  const [hidden, seenEpics, seenTasks] = await Promise.all([
    hiddenEvidenceIds(deps.port, stored.pack),
    readVisible(deps.port, (comparison?.epics ?? []).map((e) => e.key), ['summary']),
    readVisible(deps.port, Object.values(actions.tasks).map((task) => task.id), ['summary']),
  ]);
  const seen = new Set(seenEpics.map((issue) => issue.key));
  const report = withFingerprints(reportForReader(stored.report, hidden), stored.pack);
  const currentKeys = new Map(seenTasks.map((issue) => [issue.id, issue.key]));
  const tasks = {};
  for (const { fingerprint } of [...report.ruleBased.reasons, ...(report.agent?.reasons ?? [])]) {
    const key = currentKeys.get(actions.tasks[fingerprint]?.id);
    if (key) tasks[fingerprint] = { key, url: browseUrl(stored.pack, key) };
  }
  const batch = actions.lastBatch;
  return {
    issueKey: epic.key,
    canRun,
    canCreate,
    space,
    report,
    evidence: packForReader(stored.pack, hidden).evidence.map(({ id, fact, baseRate, links }) => ({ id, fact, baseRate, links })),
    comparison: comparison && { ...comparison, epics: comparison.epics.filter((e) => seen.has(e.key)) },
    epic: { summary: stored.pack.epic.summary, due: stored.pack.epic.due },
    // The age comes from the server clock, so the panel's 3-minute wait doesn't depend on the
    // reader's computer clock.
    agentRequest: agentRequest && { ...agentRequest, ageMs: deps.now() - Date.parse(agentRequest.requestedAt) },
    tasks,
    taskResults: batch && batch.by === accountId && deps.now() - Date.parse(batch.at) < RESULTS_FOR_MS ? batch.results : null,
    confluence,
  };
}

// The panel calls this as it opens Rovo: opening Rovo remounts the panel, and the new panel uses
// the request to keep waiting for the agent's write-up (AC 19). `savedBefore` tells a new
// write-up from the one already there.
export async function requestAgentAction({ deps, epicKey: requestedKey, accountId }) {
  const epic = await readEpic(deps.port, requestedKey);
  if (!epic) return { error: notVisible(requestedKey) };
  if (!epic.isEpic) return { error: EPICS_ONLY };
  const stored = await readPremortem(deps.kvs, epic.id);
  const savedBefore = stored?.report?.agent?.savedAt ?? null;
  await writeAgentRequest(deps.kvs, epic.id, accountId, { savedBefore, requestedAt: new Date(deps.now()).toISOString() });
  return { requested: true };
}
