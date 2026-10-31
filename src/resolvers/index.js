import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { PREMORTEM_PROPERTY } from '../actions';

const resolver = new Resolver();

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

export const handler = resolver.getDefinitions();
