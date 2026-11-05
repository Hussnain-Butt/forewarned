// The Rovo agent's actions (story 003 AC 1, 19–22). Each takes its dependencies (the Jira port as
// the user in session, KVS, the queue, the clock) so tests run them with fakes; the Forge
// functions in src/actions/index.js pass the real ones.
//
// The pack and the report are in KVS, which Jira's permissions don't cover, so every action first
// reads the epic as the user: someone who can't see it learns nothing, not even whether a run is
// in progress.

import { counted } from '../engine/format.js';
import { exactTime, headline, NO_BASE_RATE } from '../frontend/text.js';
import { citedEvidence, readerLists, savedReasonList } from './agent-view.js';
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
// A run takes seconds, so it often fails before get-evidence first looks. A failure this recent is
// the run the user just asked for; an older one doesn't block writing on the stored evidence.
const RECENT_FAILURE_MS = 5 * 60 * 1000;
const failedRecently = (status, nowMs) => status?.status === 'failed'
  && nowMs - Date.parse(status.finishedAt ?? status.startedAt ?? 0) < RECENT_FAILURE_MS;

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

// Story 009 AC 4: how long until the cap resets, "in 25 minutes" or "in about 16 hours".
function untilReset(resetsAt, nowMs) {
  const minutes = Math.ceil((Date.parse(resetsAt) - nowMs) / 60000);
  return minutes < 60 ? `in ${counted(minutes, 'minute')}` : `in about ${counted(Math.round(minutes / 60), 'hour')}`;
}
const OFFER_LAST = 'Offer to show the last pre-mortem.';

// run-premortem: the agent's way to start compute (the shared start function, AC 1). The agent never
// skips the cache: "Run again anyway" is the panel's (story 009 AC 7). It doesn't know the user's
// time zone, so times are in UTC.
export async function runPremortemAction({ deps, epicKey, accountId }) {
  const result = await startRun({ ...deps, epicKey, accountId, force: false });
  if (result.error) return result;
  if (result.status === 'capped') {
    return {
      error: result.cap > 0
        ? `Forewarned's daily limit on this site is reached. It resets at 00:00 UTC, ${untilReset(result.resetsAt, deps.now())}. ${OFFER_LAST}`
        : `New Forewarned runs are paused on this site for now. ${OFFER_LAST}`,
    };
  }
  if (result.status === 'cached') {
    const message = `Nothing in ${epicKey} has changed since the last run at ${exactTime(result.runAt, 'UTC')} UTC, so Forewarned kept that evidence. Call get-evidence now.`;
    return { epicKey, ...result, message };
  }
  const message = result.status === 'started'
    ? `Forewarned started building the evidence for ${epicKey}. ${callGetEvidence}`
    : `A run for ${epicKey} is already in progress. ${callGetEvidence}`;
  return { epicKey, ...result, message };
}

// get-evidence: the stored pack, so the agent cites exactly what submit-premortem checks against,
// without the evidence the reader can't see (story 002 AC 2), plus the panel's headline; the pack's
// builtAt says when it was built. A run in progress is waited for (story 008 AC 4, 7), counted from
// the start of the action so a slow epic read still leaves room in Rovo's 55 s. With no pack, or
// when the run it waited for failed, the failure says why, so the agent can tell the user before
// it tries again.
export async function getEvidenceAction({ deps, epicKey: requestedKey }) {
  const waitStart = deps.now();
  const { epic, error } = await epicFor(deps.port, requestedKey);
  if (error) return { error };
  let status = await readRunStatus(deps.kvs, epic.id);
  while (isRunInProgress(status, deps.now())) {
    if (deps.now() - waitStart + POLL_MS > EVIDENCE_WAIT_MS) return { epicKey: epic.key, status: 'running', message: STILL_RUNNING };
    await deps.sleep(POLL_MS);
    status = await readRunStatus(deps.kvs, epic.id);
  }
  // The user just asked for this run, so older evidence would answer the wrong question.
  if (failedRecently(status, deps.now())) return { error: lastRunFailed(status) };
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
  const { kept, droppedByRule, dropped: drops } = validateReasons(parsed.reasons, visiblePack);
  const dropped = drops.map((drop) => ({ ...drop, fix: DROP_FIXES[drop.code] }));
  for (const { code } of dropped) deps.log(`Reason dropped: ${code}`);
  if (!kept.length) {
    return { saved: false, error: 'No reason checked out against the evidence, so nothing was saved.', dropped };
  }
  const report = withAgentWriteUp(stored.report, { reasons: kept, droppedByRule, packId: stored.pack.packId, savedBy: accountId, now: deps.now() });
  await writePremortem(deps.kvs, epic.id, { pack: stored.pack, report });
  return { saved: true, epicKey, savedReasons: kept.length, reasons: savedReasonList(kept), dropped };
}

const noPremortem = (epicKey) => `No pre-mortem has been saved on ${epicKey} yet.`;
// The panel's notes (story 005), so chat and panel say the same.
const STALE_NOTE = "The agent's write-up is based on an earlier run. Ask the agent again to update it.";
const HIDDEN_REASONS_NOTE = "Some reasons are hidden because they name work items you can't see or that no longer exist.";
const LIST_NAMES = { agent: 'agent write-up', 'rule-based': 'rule-based pre-mortem' };

// The stored pack and report without what the reader can't see (story 002 AC 2), or `stored: false`.
async function readerPremortem(deps, requestedKey) {
  const { epic, error } = await epicFor(deps.port, requestedKey);
  if (error) return { error };
  const stored = await readPremortem(deps.kvs, epic.id);
  if (!stored) return { epic, stored: false };
  const hidden = await hiddenEvidenceIds(deps.port, stored.pack);
  return { epic, stored: true, storedReport: stored.report, pack: packForReader(stored.pack, hidden), report: reportForReader(stored.report, hidden) };
}

// get-premortem (story 008 AC 4, 11): the headline, both lists of reasons numbered as the panel
// numbers them, the facts they cite and when the run was. Who ran or saved it stays out.
export async function getPremortemAction({ deps, epicKey: requestedKey }) {
  const { epic, error, stored, pack, report } = await readerPremortem(deps, requestedKey);
  if (error) return { error };
  if (!stored) return { epicKey: epic.key, message: noPremortem(epic.key) };
  const lists = readerLists(report);
  let agentWriteUp = null;
  if (lists.agentStale) agentWriteUp = { stale: true, note: STALE_NOTE };
  else if (lists.agent) agentWriteUp = { savedAt: report.agent.savedAt, reasons: lists.agent, droppedByRule: report.agent.droppedByRule };
  return {
    epicKey: epic.key,
    ...headlineOf(pack, deps.now()),
    runAt: report.runAt,
    status: report.status,
    shownFirst: lists.shownFirst,
    agentWriteUp,
    ruleBased: { reasons: lists.ruleBased },
    evidence: citedEvidence(pack, [...(lists.agent ?? []), ...lists.ruleBased]),
    ...(report.hiddenForReader ? { notes: [HIDDEN_REASONS_NOTE] } : {}),
  };
}

// The agent fills reasonNumber from the chat: a whole number 1–5, also as digits in a string.
function reasonNumberOf(value) {
  let number = NaN;
  if (typeof value === 'number') number = value;
  else if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : null;
}

// "agent" or "rule-based" in any letter case, with spaces or underscores for the dash; none given
// means the list the panel shows first.
function sourceOf(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s_]+/g, '-') : '';
  if (!text) return { source: null };
  return Object.hasOwn(LIST_NAMES, text) ? { source: text } : { error: 'source must be "agent" or "rule-based".' };
}

// explain-reason (story 008 AC 4, 10): one numbered reason with every fact it cites in full, so the
// agent explains it from the evidence only. Inputs are checked before anything is read.
export async function explainReasonAction({ deps, epicKey: requestedKey, reasonNumber, source: requestedSource }) {
  const number = reasonNumberOf(reasonNumber);
  if (!number) return { error: 'reasonNumber must be a whole number from 1 to 5.' };
  const asked = sourceOf(requestedSource);
  if (asked.error) return { error: asked.error };
  const { epic, error, stored, storedReport, pack, report } = await readerPremortem(deps, requestedKey);
  if (error) return { error };
  if (!stored) return { error: noPremortem(epic.key) };
  const lists = readerLists(report);
  const source = asked.source ?? lists.shownFirst;
  // Asked without a list while the agent's write-up is stale, the agent learns why the numbers
  // refer to the rule-based reasons, in an answer or in an error.
  const fellBack = !asked.source && lists.agentStale;
  const withStaleNote = (message) => (fellBack ? `${message} The agent's write-up on ${epic.key} is based on an earlier run, so the numbers refer to the rule-based reasons.` : message);
  if (source === 'agent' && lists.agentStale) {
    return { error: `The agent's write-up on ${epic.key} is based on an earlier run. Ask me to write the pre-mortem again, or ask about a rule-based reason.` };
  }
  if (source === 'agent' && !lists.agent) {
    return { error: `${epic.key} has no write-up from the Forewarned agent yet. Ask about a rule-based reason, or ask me to write the pre-mortem.` };
  }
  const reasons = source === 'agent' ? lists.agent : lists.ruleBased;
  // A list the reader filter emptied says why, instead of "has 0 reasons"; a list that was empty
  // anyway (no rule fired) doesn't.
  const storedCount = source === 'agent' ? storedReport.agent?.reasons.length ?? 0 : storedReport.ruleBased.reasons.length;
  if (!reasons.length && storedCount) {
    return { error: withStaleNote(`The ${LIST_NAMES[source]} for ${epic.key} has no reasons you can see: they name work items you can't see or that no longer exist.`) };
  }
  const listed = reasons[number - 1];
  if (!listed) return { error: withStaleNote(`The ${LIST_NAMES[source]} for ${epic.key} has ${counted(reasons.length, 'reason')}, so there is no reason ${number}.`) };
  const { title, likelihood, explanation, evidenceIds, mitigation } = listed;
  const evidence = citedEvidence(pack, [listed]);
  return {
    epicKey: epic.key,
    source,
    number,
    reason: { title, likelihood, explanation, evidenceIds, mitigation },
    evidence,
    ...(evidence.some((item) => item.baseRate) ? {} : { baseRateNote: NO_BASE_RATE }),
    ...(fellBack ? { note: `The agent's write-up on ${epic.key} is based on an earlier run, so this is a rule-based reason.` } : {}),
  };
}
