import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { Queue } from '@forge/events';
import { kvs } from '@forge/kvs';
import { randomUUID } from 'node:crypto';
import { PREMORTEM_PROPERTY } from '../actions';
import { readRunStatus, writeRunStatus } from '../premortem/store.js';

const resolver = new Resolver();
const runQueue = new Queue({ key: 'premortem-run' });

resolver.define('getPremortem', async ({ context }) => {
  const issueKey = context.extension?.issue?.key;
  if (!issueKey) {
    return { error: 'This panel needs a work item to show its pre-mortem.' };
  }
  try {
    const response = await api
      .asUser()
      .requestJira(route`/rest/api/3/issue/${issueKey}/properties/${PREMORTEM_PROPERTY}`);
    if (response.status === 404) {
      return { issueKey, report: null };
    }
    if (!response.ok) {
      return { issueKey, error: `The pre-mortem couldn't be loaded (status ${response.status}).` };
    }
    const { value } = await response.json();
    return { issueKey, report: value };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('getPremortem failed:', message);
    return { issueKey, error: message };
  }
});

// M3 Task 1 platform check: queue a run for the epic in view. The account ID comes from the
// Forge context, never from the panel. Task 5 replaces this with the full start function.
resolver.define('startRun', async ({ context }) => {
  const epicKey = context.extension?.issue?.key;
  if (!epicKey || !context.accountId) {
    return { error: 'This panel needs an epic and a signed-in user to start a run.' };
  }
  const runId = randomUUID();
  await writeRunStatus(kvs, epicKey, { runId, status: 'queued', step: null, startedAt: new Date().toISOString(), finishedAt: null, error: null });
  await runQueue.push({ body: { runId, epicKey, accountId: context.accountId } });
  return { runId };
});

resolver.define('getRunStatus', async ({ context }) => {
  const epicKey = context.extension?.issue?.key;
  return { status: epicKey ? await readRunStatus(kvs, epicKey) : null };
});

export const handler = resolver.getDefinitions();
