// Queue consumer of the pre-mortem run (story 003 AC 3, 6–8). For one queued event it re-checks
// the epic, builds the evidence pack (story 002) as the user who started the run, derives the
// rule-based reasons (story 004), validates them, and writes the pack and the report to the
// epic. It never throws back to the queue: Forge would retry a failing event for up to 24 hours.

import api from '@forge/api';
import { kvs } from '@forge/kvs';
import { forgeSenders } from '../engine/forge-jira.js';
import { buildEvidencePack } from '../engine/index.js';
import { createJira } from '../engine/jira.js';
import { buildReport } from './report.js';
import { ruleBasedReasons } from './rules.js';
import { EVIDENCE_PROPERTY, REPORT_PROPERTY, readProperty, readRunStatus, writeProperty, writeRunStatus } from './store.js';
import { validateReasons } from './validator.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
const WRITE_BUDGET_MS = 30000;

// A failure with a message that is safe to show the user, and a short code for the log.
class RunFailure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Runs one queued pre-mortem. `senders` must act as the user in event.body.accountId.
export async function handleRun({ event, senders, kvs: store, now = Date.now, log = console.log }) {
  const { runId, epicKey, accountId } = event.body ?? {};
  if (!runId || !accountId || !ISSUE_KEY.test(epicKey ?? '')) {
    log('Pre-mortem run skipped: invalid event');
    return;
  }
  // A newer run (or none) for this epic means this event is out of date.
  const current = await readRunStatus(store, epicKey);
  if (current?.runId !== runId) {
    log('Pre-mortem run skipped: replaced by a newer run');
    return;
  }
  const setStatus = (fields) => writeRunStatus(store, epicKey, { runId, startedAt: current.startedAt, step: null, finishedAt: null, error: null, ...fields });
  // One KVS write per step: a step the status already shows is not written again.
  let shownStep = null;
  const showStep = (step) => {
    if (step === shownStep) return undefined;
    shownStep = step;
    return setStatus({ status: 'running', step });
  };

  try {
    await showStep('comparable epics');
    const result = await buildEvidencePack({ senders, epicKey, accountId, now, onStep: showStep }).catch((error) => { throw new RunFailure(error.name ?? 'Error', `Forewarned couldn't build the evidence for ${epicKey}. Try again in a minute.`); });
    if (result.error) throw new RunFailure('not-an-epic', `${epicKey} is no longer an epic or no longer exists.`);
    const { pack } = result;

    await showStep('writing');
    // Forewarned's own reasons go through the same validator as the agent's (004 AC 3); a drop
    // here is a bug in a rule, so it is logged.
    const { kept, dropped } = validateReasons(ruleBasedReasons(pack), pack, { keep: ['ruleId', 'baseRateFact'] });
    for (const { code } of dropped) log(`Rule-based reason dropped: ${code}`);

    const port = createJira(senders, { deadline: now() + WRITE_BUDGET_MS, now });
    try {
      const previous = await readProperty(port, epicKey, REPORT_PROPERTY);
      const report = buildReport({ pack, ruleReasons: kept, previous, accountId, now: now() });
      await writeProperty(port, epicKey, EVIDENCE_PROPERTY, pack);
      await writeProperty(port, epicKey, REPORT_PROPERTY, report);
    } catch {
      throw new RunFailure('save', `Forewarned couldn't save the report on ${epicKey}.`);
    }
    await setStatus({ status: 'done', finishedAt: new Date(now()).toISOString() });
  } catch (error) {
    const failure = error instanceof RunFailure ? error : new RunFailure(error?.name ?? 'Error', `Forewarned couldn't build the evidence for ${epicKey}. Try again in a minute.`);
    try {
      await setStatus({ status: 'failed', finishedAt: new Date(now()).toISOString(), error: failure.message });
    } catch {
      // Nothing more to do; the status expires on its own.
    }
    log(`Pre-mortem run failed: ${failure.code}`);
  }
}

// The Forge function behind the consumer module. The account ID was put in the event by
// startRun from the Forge context of the user who clicked Run; if the platform passes a principal,
// it must be the same user.
export async function handler(event, context) {
  const accountId = event.body?.accountId;
  if (context?.principal?.accountId && accountId && context.principal.accountId !== accountId) {
    console.log('Pre-mortem run skipped: the event does not match its principal');
    return;
  }
  await handleRun({ event, senders: forgeSenders(api.asUser(accountId)), kvs });
}
