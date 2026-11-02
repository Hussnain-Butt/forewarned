import Resolver from '@forge/resolver';
import { Queue } from '@forge/events';
import { kvs } from '@forge/kvs';
import { randomUUID } from 'node:crypto';
import { forgeSenders } from '../engine/forge-jira.js';
import { createJira } from '../engine/jira.js';
import { getPanelData } from '../premortem/panel.js';
import { startRun } from '../premortem/run.js';
import { readRunStatus } from '../premortem/store.js';

const resolver = new Resolver();
const runQueue = new Queue({ key: 'premortem-run' });
// Resolvers have 25 s; starting a run needs only a few requests.
const START_BUDGET_MS = 15000;

// Everything the panel shows, filtered for this viewer (story 005; story 002 AC 2).
resolver.define('getPanel', async ({ context }) => {
  const issueKey = context.extension?.issue?.key;
  if (!issueKey) {
    return { error: 'This panel needs a work item to show its pre-mortem.' };
  }
  try {
    const port = createJira(forgeSenders(), { deadline: Date.now() + START_BUDGET_MS });
    return await getPanelData({ deps: { port, kvs }, epicKey: issueKey });
  } catch (error) {
    console.error('getPanel failed:', error instanceof Error ? error.name : 'Unknown error');
    return { error: "Forewarned couldn't load the pre-mortem (Jira didn't respond). Try again in a minute." };
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

// The panel's own work item comes from the signed Forge context, so this needs no Jira read.
resolver.define('getRunStatus', async ({ context }) => {
  const epicId = context.extension?.issue?.id;
  return { status: epicId ? await readRunStatus(kvs, String(epicId)) : null };
});

export const handler = resolver.getDefinitions();
