import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { Queue } from '@forge/events';
import { kvs } from '@forge/kvs';
import { randomUUID } from 'node:crypto';
import { forgeSenders } from '../engine/forge-jira.js';
import { createJira } from '../engine/jira.js';
import { startRun } from '../premortem/run.js';
import { REPORT_PROPERTY, readRunStatus } from '../premortem/store.js';

const resolver = new Resolver();
const runQueue = new Queue({ key: 'premortem-run' });
// Resolvers have 25 s; starting a run needs only a few requests.
const START_BUDGET_MS = 15000;

resolver.define('getPremortem', async ({ context }) => {
  const issueKey = context.extension?.issue?.key;
  if (!issueKey) {
    return { error: 'This panel needs a work item to show its pre-mortem.' };
  }
  try {
    const response = await api
      .asUser()
      .requestJira(route`/rest/api/3/issue/${issueKey}/properties/${REPORT_PROPERTY}`);
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
    console.error('startRun failed:', error instanceof Error ? error.message : 'Unknown error');
    return { error: "Forewarned couldn't start the run. Try again in a minute." };
  }
});

resolver.define('getRunStatus', async ({ context }) => {
  const epicKey = context.extension?.issue?.key;
  return { status: epicKey ? await readRunStatus(kvs, epicKey) : null };
});

export const handler = resolver.getDefinitions();
