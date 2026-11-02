// The Forewarned agent's Rovo actions (stories 003 and 008). Each Forge function resolves the epic
// key, builds the real dependencies (Jira as the user in session, KVS, the run queue) and calls
// the action in src/premortem/actions.js. The user's account ID comes from the function context,
// never from the agent's inputs (Rovo action guidance).

import { Queue } from '@forge/events';
import { kvs } from '@forge/kvs';
import { randomUUID } from 'node:crypto';
import { forgeSenders } from '../engine/forge-jira.js';
import { createJira } from '../engine/jira.js';
import { getEvidenceAction, getPremortemAction, runPremortemAction, submitPremortemAction } from '../premortem/actions.js';

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;
// Rovo actions get 55 s; retries stop once they would end after this.
const ACTION_BUDGET_MS = 40000;
const runQueue = new Queue({ key: 'premortem-run' });

// The agent fills epicKey from the chat, so check its shape and fall back to the work item in view.
const resolveEpicKey = (payload) => {
  const fromInput = typeof payload.epicKey === 'string' ? payload.epicKey.trim().toUpperCase() : '';
  if (ISSUE_KEY_PATTERN.test(fromInput)) {
    return fromInput;
  }
  const fromContext = payload.context?.jira?.issueKey;
  return typeof fromContext === 'string' && ISSUE_KEY_PATTERN.test(fromContext) ? fromContext : null;
};

const realDeps = () => ({
  port: createJira(forgeSenders(), { deadline: Date.now() + ACTION_BUDGET_MS }),
  kvs,
  queue: runQueue,
  now: Date.now,
  newId: randomUUID,
  log: console.log,
});

// Wraps an action: a missing epic key and any failure become a plain message for the agent.
const action = (name, run) => async (payload, context) => {
  const epicKey = resolveEpicKey(payload);
  if (!epicKey) {
    return { error: 'No valid epic key was given. Ask the user which epic to use, for example PLAT-1.' };
  }
  try {
    return await run({ deps: realDeps(), epicKey, payload, context });
  } catch (error) {
    console.error(`${name} failed:`, error instanceof Error ? error.name : 'Unknown error');
    // JiraError messages are written to be shown; anything else gets a generic one.
    return { error: error?.name === 'JiraError' ? error.message : `Forewarned couldn't finish ${name}. Try again in a minute.` };
  }
};

export const runPremortem = action('run-premortem', ({ deps, epicKey, context }) => (
  runPremortemAction({ deps, epicKey, accountId: context?.principal?.accountId })));

export const getEvidence = action('get-evidence', ({ deps, epicKey, context }) => (
  getEvidenceAction({ deps, epicKey, readerAccountId: context?.principal?.accountId })));

export const submitPremortem = action('submit-premortem', ({ deps, epicKey, payload }) => submitPremortemAction({
  deps,
  epicKey,
  reasonsJson: payload.reasonsJson,
  packId: typeof payload.packId === 'string' && payload.packId.trim() ? payload.packId.trim() : undefined,
}));

export const getPremortem = action('get-premortem', ({ deps, epicKey, context }) => (
  getPremortemAction({ deps, epicKey, readerAccountId: context?.principal?.accountId })));
