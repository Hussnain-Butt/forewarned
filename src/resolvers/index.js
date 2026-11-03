import Resolver from '@forge/resolver';
import { Queue } from '@forge/events';
import { kvs } from '@forge/kvs';
import { randomUUID } from 'node:crypto';
import { forgeSenders } from '../engine/forge-jira.js';
import { createJira } from '../engine/jira.js';
import { getPanelData, requestAgentAction } from '../premortem/panel.js';
import { startRun } from '../premortem/run.js';
import { readRunStatus } from '../premortem/store.js';
import { createTasksAction } from '../premortem/tasks.js';

const resolver = new Resolver();
const runQueue = new Queue({ key: 'premortem-run' });
// Resolvers have 25 s; starting a run needs only a few requests.
const START_BUDGET_MS = 15000;
// Creating tasks makes one request per task, so it gets most of the 25 s.
const TASKS_BUDGET_MS = 20000;

// Everything the panel shows, filtered for this viewer (story 005; story 002 AC 2).
resolver.define('getPanel', async ({ context }) => {
  const issueKey = context.extension?.issue?.key;
  if (!issueKey) {
    return { error: 'This panel needs a work item to show its pre-mortem.' };
  }
  try {
    const port = createJira(forgeSenders(), { deadline: Date.now() + START_BUDGET_MS });
    return await getPanelData({ deps: { port, kvs, now: Date.now }, epicKey: issueKey, accountId: context.accountId });
  } catch (error) {
    console.error('getPanel failed:', error instanceof Error ? error.name : 'Unknown error');
    return { error: "Forewarned couldn't load the pre-mortem (Jira didn't respond). Try again in a minute." };
  }
});

// Story 005 AC 19: remembers, for this user and epic, that they just asked the agent.
resolver.define('requestAgent', async ({ context }) => {
  const issueKey = context.extension?.issue?.key;
  if (!issueKey || !context.accountId) return { error: 'This panel needs a work item and a signed-in user.' };
  try {
    const port = createJira(forgeSenders(), { deadline: Date.now() + START_BUDGET_MS });
    return await requestAgentAction({ deps: { port, kvs, now: Date.now }, epicKey: issueKey, accountId: context.accountId });
  } catch (error) {
    console.error('requestAgent failed:', error instanceof Error ? error.name : 'Unknown error');
    return { error: "Forewarned couldn't note the request. The agent's write-up will show after a refresh." };
  }
});

// Story 003 AC 1: "Run pre-mortem" for the epic in view. The account ID comes from the Forge
// context, never from the panel.
resolver.define('startRun', async ({ context }) => {
  try {
    return await startRun({
      port: createJira(forgeSenders(), { deadline: Date.now() + START_BUDGET_MS }),
      kvs,
      queue: runQueue,
      epicKey: context.extension?.issue?.key,
      accountId: context.accountId,
      now: Date.now,
      newId: randomUUID,
    });
  } catch (error) {
    console.error('startRun failed:', error instanceof Error ? error.name : 'Unknown error');
    return { error: "Forewarned couldn't start the run. Try again in a minute." };
  }
});

// Story 006: creates a task for each reason the user ticked. The panel sends only fingerprints; the
// epic and the account come from the Forge context.
resolver.define('createTasks', async ({ payload, context }) => {
  const issueKey = context.extension?.issue?.key;
  if (!issueKey || !context.accountId) return { error: 'This panel needs a work item and a signed-in user.' };
  try {
    const deadline = Date.now() + TASKS_BUDGET_MS;
    const port = createJira(forgeSenders(), { deadline });
    return await createTasksAction({ deps: { port, kvs, now: Date.now, deadline }, epicKey: issueKey, accountId: context.accountId, fingerprints: payload?.fingerprints });
  } catch (error) {
    console.error('createTasks failed:', error instanceof Error ? error.name : 'Unknown error');
    return { error: "Forewarned couldn't create the tasks. Try again in a minute." };
  }
});

// The panel's own work item comes from the signed Forge context, so this needs no Jira read.
resolver.define('getRunStatus', async ({ context }) => {
  const epicId = context.extension?.issue?.id;
  return { status: epicId ? await readRunStatus(kvs, String(epicId)) : null };
});

export const handler = resolver.getDefinitions();
