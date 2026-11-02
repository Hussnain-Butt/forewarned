// The Rovo agent's actions (story 003 AC 1, 19–22). Each takes its dependencies (the Jira port as
// the user in session, KVS, the queue, the clock) so tests run them with fakes; the Forge
// functions in src/actions/index.js pass the real ones.

import { withAgentWriteUp } from './report.js';
import { isRunInProgress, startRun } from './run.js';
import { EVIDENCE_PROPERTY, REPORT_PROPERTY, readProperty, readRunStatus, writeProperty } from './store.js';
import { parseReasonsJson, validateReasons } from './validator.js';
import { hiddenEvidenceIds, packForReader, reportForReader } from './visibility.js';

const IN_PROGRESS = 'A new evidence run is in progress. Wait a moment, then call get-evidence again.';
const noEvidence = (epicKey) => `No evidence found for ${epicKey}. Call run-premortem first.`;
const running = async ({ kvs, now }, epicKey) => isRunInProgress(await readRunStatus(kvs, epicKey), now());

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
// without the evidence the reader can't see (story 002 AC 2).
export async function getEvidenceAction({ deps, epicKey, readerAccountId }) {
  if (await running(deps, epicKey)) return { error: IN_PROGRESS };
  const pack = await readProperty(deps.port, epicKey, EVIDENCE_PROPERTY);
  if (!pack) return { error: noEvidence(epicKey) };
  return { epicKey, ...packForReader(pack, await hiddenEvidenceIds(deps.port, pack, readerAccountId)) };
}

// submit-premortem: validates the agent's reasons against the stored pack (AC 19) and stores only
// the validated fields in the report's agent part (AC 21). Each drop is logged by rule code.
export async function submitPremortemAction({ deps, epicKey, reasonsJson, packId }) {
  const parsed = parseReasonsJson(reasonsJson);
  if (parsed.error) return { saved: false, error: parsed.error };
  if (await running(deps, epicKey)) return { saved: false, error: IN_PROGRESS };
  const pack = await readProperty(deps.port, epicKey, EVIDENCE_PROPERTY);
  if (!pack) return { saved: false, error: noEvidence(epicKey) };
  if (packId && packId !== pack.packId) return { saved: false, error: 'The evidence changed since you read it. Call get-evidence again.' };

  const { kept, dropped, droppedByRule } = validateReasons(parsed.reasons, pack);
  for (const { code } of dropped) deps.log(`Reason dropped: ${code}`);
  if (!kept.length) {
    return { saved: false, error: 'No reason checked out against the evidence, so nothing was saved.', dropped };
  }
  const report = await readProperty(deps.port, epicKey, REPORT_PROPERTY);
  if (report?.version !== 2) return { saved: false, error: noEvidence(epicKey) };
  // A run that saved its pack but not its report leaves the two out of step.
  if (report.packId !== pack.packId) return { saved: false, error: "The last run didn't finish saving. Call run-premortem again." };
  try {
    await writeProperty(deps.port, epicKey, REPORT_PROPERTY, withAgentWriteUp(report, { reasons: kept, droppedByRule, packId: pack.packId, now: deps.now() }));
  } catch (error) {
    if (error.status === 403) return { saved: false, error: `You can view ${epicKey} but can't edit it, so the pre-mortem can't be saved.` };
    throw error;
  }
  return { saved: true, epicKey, savedReasons: kept.length, dropped };
}

// get-premortem (and the panel): the stored version 2 report, without the reasons built on
// evidence the reader can't see (story 002 AC 2).
export async function getPremortemAction({ deps, epicKey, readerAccountId }) {
  const report = await readProperty(deps.port, epicKey, REPORT_PROPERTY);
  if (!report) return { epicKey, report: null, message: `No pre-mortem has been saved on ${epicKey} yet.` };
  const pack = await readProperty(deps.port, epicKey, EVIDENCE_PROPERTY);
  return { epicKey, report: reportForReader(report, await hiddenEvidenceIds(deps.port, pack, readerAccountId)) };
}
