// Queue consumer of the pre-mortem run (story 003 AC 3, 6–8). For one queued event it re-checks
// the epic, builds the evidence pack (story 002) as the user who started the run, derives the
// rule-based reasons (story 004), validates them, and stores the pack and the report in Forge KVS.
// It never throws back to the queue: Forge would retry a failing event for up to 24 hours.

import api from '@forge/api';
import { kvs } from '@forge/kvs';
import { forgeSenders } from '../engine/forge-jira.js';
import { buildEvidencePack } from '../engine/index.js';
import { buildReport } from './report.js';
import { ruleBasedReasons } from './rules.js';
import { readPremortem, readRunStatus, writePremortem, writeRunStatus } from './store.js';
import { validateReasons } from './validator.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
const ISSUE_ID = /^\d+$/;

// A failure with a message that is safe to show the user, and a short code for the log.
class RunFailure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Runs one queued pre-mortem. `senders` must act as the user in event.body.accountId; `principal`
// is the account ID the platform gives the consumer, when it gives one. Every run ends with one log
// line of counts (story 009 AC 11), and nothing is thrown back to the queue, not even a KVS failure
// before the run starts (AC 14).
export async function handleRun({ event, principal, senders, kvs: store, now = Date.now, log = console.log }) {
  const { runId, epicKey, epicId, accountId } = event.body ?? {};
  if (!runId || !accountId || !ISSUE_KEY.test(epicKey ?? '') || !ISSUE_ID.test(epicId ?? '')) {
    log('Pre-mortem run skipped: invalid event');
    return;
  }
  const startedMs = now();
  const counts = { requests: 0, evidence: 0 };
  const onSummary = ({ requests, evidence }) => Object.assign(counts, { requests, evidence: evidence ?? 0 });
  let outcome;
  try {
    outcome = await runEvent({ event, principal, senders, store, now, log, onSummary });
  } catch (error) {
    outcome = `failed (${error?.name ?? 'Error'})`;
  }
  if (outcome) log(`Pre-mortem run ${runId}: ${outcome}, ${now() - startedMs} ms, ${counts.requests} Jira requests, ${counts.evidence} evidence items`);
}

// The run itself. Returns "done" or "failed (‹code›)", or null when the event is out of date.
async function runEvent({ event, principal, senders, store, now, log, onSummary }) {
  const { runId, epicKey, epicId, accountId } = event.body;
  // A newer run (or none) for this epic means this event is out of date; a finished run's event
  // can arrive again because delivery is "at least once".
  const current = await readRunStatus(store, epicId);
  if (current?.runId !== runId || ['done', 'failed'].includes(current.status)) {
    log('Pre-mortem run skipped: replaced by a newer run, or already finished');
    return null;
  }
  const setStatus = (fields) => writeRunStatus(store, epicId, { runId, startedAt: current.startedAt, step: null, count: null, finishedAt: null, error: null, ...fields });
  const fail = async (code, message) => {
    await setStatus({ status: 'failed', finishedAt: new Date(now()).toISOString(), error: message });
    return `failed (${code})`;
  };
  // The event was written by startRun from the Forge context of the user who clicked Run; if the
  // platform names a different user, nothing runs on their behalf.
  if (principal && principal !== accountId) {
    return fail('principal', "Forewarned couldn't confirm who started this run. Try again.");
  }
  // "running" before this event started means an earlier delivery timed out (300 s) or crashed;
  // running again would only time out again, so the run ends here.
  if (current.status === 'running' || event.retryContext) {
    return fail('retried', 'The run took too long. Try again in a minute.');
  }
  // One KVS write per step: a step the status already shows is not written again. "past epics"
  // carries how many epics are read, and later steps keep it (story 005 AC 5).
  let shownStep = null;
  let count = null;
  const showStep = (step, extra = {}) => {
    if (step === shownStep) return undefined;
    shownStep = step;
    count = extra.count ?? count;
    return setStatus({ status: 'running', step, count });
  };

  try {
    await showStep('comparable epics');
    const result = await buildEvidencePack({ senders, epicKey, accountId, now, onStep: showStep, onSummary });
    if (result.error) throw new RunFailure('not-an-epic', `${epicKey} is no longer an epic or no longer exists.`);
    const { pack } = result;

    await showStep('writing');
    // Forewarned's own reasons go through the same validator as the agent's (004 AC 3); a drop
    // here is a bug in a rule, so it is logged.
    const { kept, dropped } = validateReasons(ruleBasedReasons(pack), pack, { keep: ['ruleId', 'baseRateFact'] });
    for (const { code } of dropped) log(`Rule-based reason dropped: ${code}`);

    let report;
    try {
      const previous = (await readPremortem(store, epicId))?.report;
      report = buildReport({ pack, ruleReasons: kept, previous, accountId, now: now() });
      await writePremortem(store, epicId, { pack, report });
    } catch {
      throw new RunFailure('save', `Forewarned couldn't save the report on ${epicKey}.`);
    }
    // The finish time is the report's run time, so the panel can tell whether the report it shows
    // is this run's (story 009 AC 6).
    await setStatus({ status: 'done', finishedAt: report.runAt });
    return 'done';
  } catch (error) {
    const failure = error instanceof RunFailure ? error : new RunFailure(error?.name ?? 'Error', `Forewarned couldn't build the evidence for ${epicKey}. Try again in a minute.`);
    try {
      await setStatus({ status: 'failed', finishedAt: new Date(now()).toISOString(), error: failure.message });
    } catch {
      // Nothing more to do; the status expires on its own.
    }
    return `failed (${failure.code})`;
  }
}

// The Forge function behind the consumer module. It impersonates the user named in the event
// (offline user impersonation); handleRun checks that against the platform's principal first.
export async function handler(event, context) {
  await handleRun({
    event,
    principal: context?.principal?.accountId,
    senders: forgeSenders(api.asUser(event.body?.accountId)),
    kvs,
  });
}
