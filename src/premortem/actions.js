// The Rovo agent's actions (story 003 AC 1, 19–22). Each takes its dependencies (the Jira port as
// the user in session, KVS, the queue, the clock) so tests run them with fakes; the Forge
// functions in src/actions/index.js pass the real ones.
//
// The pack and the report are in KVS, which Jira's permissions don't cover, so every action first
// reads the epic as the user: someone who can't see it learns nothing, not even whether a run is
// in progress.

import { notAnEpic, notVisible, readEpic } from './epic.js';
import { withAgentWriteUp } from './report.js';
import { isRunInProgress, startRun } from './run.js';
import { readPremortem, readRunStatus, writePremortem } from './store.js';
import { parseReasonsJson, validateReasons } from './validator.js';
import { hiddenEvidenceIds, packForReader, reportForReader } from './visibility.js';

const IN_PROGRESS = 'A new evidence run is in progress. Wait a moment, then call get-evidence again.';
const noEvidence = (epicKey) => `No evidence found for ${epicKey}. Call run-premortem first.`;

// The epic as the user sees it ({ key, id }; storage is keyed by the ID), or the message for a work
// item they can't see or that isn't an epic.
async function epicFor(port, requestedKey) {
  const epic = await readEpic(port, requestedKey);
  if (!epic) return { error: notVisible(requestedKey) };
  return epic.isEpic ? { epic } : { error: notAnEpic(epic.key) };
}

// run-premortem: the agent's way to start compute (the shared start function, AC 1).
export async function runPremortemAction({ deps, epicKey, accountId }) {
  const result = await startRun({ ...deps, epicKey, accountId });
  if (result.error) return result;
  const message = result.status === 'started'
    ? `Forewarned started building the evidence for ${epicKey}. Call get-evidence in about a minute.`
    : `A run for ${epicKey} is already in progress. Call get-evidence in about a minute.`;
  return { epicKey, ...result, message };
}

// get-evidence: the stored pack, so the agent cites exactly what submit-premortem checks against,
// without the evidence the reader can't see (story 002 AC 2). With no pack, a failed last run says
// why, so the agent can tell the user before it tries again.
export async function getEvidenceAction({ deps, epicKey: requestedKey }) {
  const { epic, error } = await epicFor(deps.port, requestedKey);
  if (error) return { error };
  const status = await readRunStatus(deps.kvs, epic.id);
  if (isRunInProgress(status, deps.now())) return { error: IN_PROGRESS };
  const stored = await readPremortem(deps.kvs, epic.id);
  if (!stored) {
    return { error: status?.status === 'failed' ? `The last run failed: ${status.error} Ask the user whether to run it again.` : noEvidence(epic.key) };
  }
  return { epicKey: epic.key, ...packForReader(stored.pack, await hiddenEvidenceIds(deps.port, stored.pack)) };
}

// submit-premortem: validates the agent's reasons against the part of the stored pack the user can
// see (AC 19; the drop codes then reveal nothing about hidden evidence) and stores only the
// validated fields in the report's agent part (AC 21). Each drop is logged by rule code.
export async function submitPremortemAction({ deps, epicKey: requestedKey, accountId, reasonsJson, packId }) {
  const parsed = parseReasonsJson(reasonsJson);
  if (parsed.error) return { saved: false, error: parsed.error };
  const { epic, error } = await epicFor(deps.port, requestedKey);
  if (error) return { saved: false, error };
  const epicKey = epic.key;
  if (isRunInProgress(await readRunStatus(deps.kvs, epic.id), deps.now())) return { saved: false, error: IN_PROGRESS };
  const stored = await readPremortem(deps.kvs, epic.id);
  if (!stored) return { saved: false, error: noEvidence(epicKey) };
  if (packId && packId !== stored.pack.packId) return { saved: false, error: 'The evidence changed since you read it. Call get-evidence again.' };
  // Only people who can edit the epic may change its pre-mortem (story 003 open question 3).
  const permissions = await deps.port.myPermissions(epicKey);
  if (!permissions.permissions?.EDIT_ISSUES?.havePermission) {
    return { saved: false, error: `You can view ${epicKey} but can't edit it, so the pre-mortem can't be saved.` };
  }

  const visiblePack = packForReader(stored.pack, await hiddenEvidenceIds(deps.port, stored.pack));
  const { kept, dropped, droppedByRule } = validateReasons(parsed.reasons, visiblePack);
  for (const { code } of dropped) deps.log(`Reason dropped: ${code}`);
  if (!kept.length) {
    return { saved: false, error: 'No reason checked out against the evidence, so nothing was saved.', dropped };
  }
  const report = withAgentWriteUp(stored.report, { reasons: kept, droppedByRule, packId: stored.pack.packId, savedBy: accountId, now: deps.now() });
  await writePremortem(deps.kvs, epic.id, { pack: stored.pack, report });
  return { saved: true, epicKey, savedReasons: kept.length, dropped };
}

// get-premortem (and the panel): the stored version 2 report, without the reasons built on
// evidence the reader can't see (story 002 AC 2).
export async function getPremortemAction({ deps, epicKey: requestedKey }) {
  const { epic, error } = await epicFor(deps.port, requestedKey);
  if (error) return { error };
  const stored = await readPremortem(deps.kvs, epic.id);
  if (!stored) return { epicKey: epic.key, report: null, message: `No pre-mortem has been saved on ${epic.key} yet.` };
  return { epicKey: epic.key, report: reportForReader(stored.report, await hiddenEvidenceIds(deps.port, stored.pack)) };
}
