// The Rovo agent's actions (story 003 AC 1, 19–22). Each takes its dependencies (the Jira port as
// the user in session, KVS, the queue, the clock) so tests run them with fakes; the Forge
// functions in src/actions/index.js pass the real ones.
//
// The pack and the report are in KVS, which Jira's permissions don't cover, so every action first
// reads the epic as the user: someone who can't see it learns nothing, not even whether a run is
// in progress.

import { headline } from '../frontend/text.js';
import { notAnEpic, notVisible, readEpic } from './epic.js';
import { withAgentWriteUp } from './report.js';
import { isRunInProgress, startRun } from './run.js';
import { readPremortem, readRunStatus, writePremortem } from './store.js';
import { parseReasonsJson, validateReasons } from './validator.js';
import { hiddenEvidenceIds, packForReader, reportForReader } from './visibility.js';

const IN_PROGRESS = 'A new evidence run is in progress. Wait a moment, then call get-evidence again.';
const noEvidence = (epicKey) => `No evidence found for ${epicKey}. Call run-premortem first.`;
const lastRunFailed = (status) => `The last run failed: ${status.error} Ask the user whether to run it again.`;
const callGetEvidence = 'Call get-evidence now; it waits up to 40 seconds for the run.';

// Story 008 AC 7: get-evidence waits for a run in progress, checking every 2 s, and stops before
// 40 s so the action ends well inside Rovo's 55 s limit.
const EVIDENCE_WAIT_MS = 40000;
const POLL_MS = 2000;
const STILL_RUNNING = 'Still running. Ask me to continue in a moment.';

// Story 008 AC 2: one line per drop code on how to fix the reason, so the agent resubmits only
// what it changed (M3 QA: it resent unchanged reasons).
const DROP_FIXES = {
  'not-an-object': 'Send each reason as a JSON object.',
  'missing-title': 'Add a short title.',
  'missing-likelihood': 'Set likelihood to High, Medium or Low.',
  'missing-mitigation': 'Add a one-sentence mitigation.',
  'no-history-evidence': 'Cite at least one evidence ID from get-evidence.',
  'unknown-number': 'Use only numbers that appear in the facts this reason cites, copied exactly.',
  'unknown-key': 'Use only work item keys that appear in the evidence this reason cites.',
  link: 'Remove web addresses and links.',
  duplicate: 'Give each reason its own title.',
  'over-five': 'Keep at most 5 reasons.',
};

// The panel's headline for the stored pack ("It's ‹date›, and ‹epic› has failed. Here's why."),
// with the note when launch day is imagined because the epic has no due date.
function headlineOf(pack, nowMs) {
  const { text, note } = headline({ summary: pack.epic.summary, due: pack.epic.due, today: new Date(nowMs) });
  return note ? { headline: text, headlineNote: note } : { headline: text };
}

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
    ? `Forewarned started building the evidence for ${epicKey}. ${callGetEvidence}`
    : `A run for ${epicKey} is already in progress. ${callGetEvidence}`;
  return { epicKey, ...result, message };
}

// get-evidence: the stored pack, so the agent cites exactly what submit-premortem checks against,
// without the evidence the reader can't see (story 002 AC 2), plus the panel's headline. A run in
// progress is waited for (story 008 AC 4, 7). With no pack, or when the run it waited for failed,
// the failure says why, so the agent can tell the user before it tries again.
export async function getEvidenceAction({ deps, epicKey: requestedKey }) {
  const { epic, error } = await epicFor(deps.port, requestedKey);
  if (error) return { error };
  const waitStart = deps.now();
  let status = await readRunStatus(deps.kvs, epic.id);
  const waited = isRunInProgress(status, waitStart);
  while (isRunInProgress(status, deps.now())) {
    if (deps.now() - waitStart + POLL_MS > EVIDENCE_WAIT_MS) return { epicKey: epic.key, status: 'running', message: STILL_RUNNING };
    await deps.sleep(POLL_MS);
    status = await readRunStatus(deps.kvs, epic.id);
  }
  // The user asked for this run, so older evidence would answer the wrong question.
  if (waited && status?.status === 'failed') return { error: lastRunFailed(status) };
  const stored = await readPremortem(deps.kvs, epic.id);
  if (!stored) return { error: status?.status === 'failed' ? lastRunFailed(status) : noEvidence(epic.key) };
  return { epicKey: epic.key, ...headlineOf(stored.pack, deps.now()), ...packForReader(stored.pack, await hiddenEvidenceIds(deps.port, stored.pack)) };
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
  const { kept, droppedByRule, ...validated } = validateReasons(parsed.reasons, visiblePack);
  const dropped = validated.dropped.map((drop) => ({ ...drop, fix: DROP_FIXES[drop.code] }));
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
