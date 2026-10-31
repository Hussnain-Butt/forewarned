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

// Spike M0f (temporary): write, read back and delete reports of growing size on the epic.
const SIZE_CHECK_PROPERTY = 'forewarned-size-check';
const SIZE_CHECK_BYTES = [20000, 32000, 33000];

resolver.define('checkPropertySize', async ({ context }) => {
  const issueKey = context.extension?.issue?.key;
  if (!issueKey) {
    return { error: 'This check needs a work item.' };
  }
  const propertyRoute = route`/rest/api/3/issue/${issueKey}/properties/${SIZE_CHECK_PROPERTY}`;
  const results = [];
  try {
    for (const bytes of SIZE_CHECK_BYTES) {
      // ASCII padding only, so the character count equals the byte count.
      const shell = JSON.stringify({ check: 'M0f', bytes, padding: '' });
      const body = JSON.stringify({ check: 'M0f', bytes, padding: 'x'.repeat(bytes - shell.length) });

      const startedAt = Date.now();
      const write = await api.asUser().requestJira(propertyRoute, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const writeMs = Date.now() - startedAt;
      if (!write.ok) {
        results.push({ bytes, saved: false, status: write.status, writeMs });
        continue;
      }

      const readStartedAt = Date.now();
      const read = await api.asUser().requestJira(propertyRoute);
      const readMs = Date.now() - readStartedAt;
      const { value } = await read.json();
      results.push({ bytes, saved: true, sameOnReadBack: JSON.stringify(value) === body, writeMs, readMs });
    }
    return { issueKey, results };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('checkPropertySize failed:', message);
    return { issueKey, results, error: message };
  } finally {
    await api.asUser().requestJira(propertyRoute, { method: 'DELETE' }).catch(() => {});
  }
});

export const handler = resolver.getDefinitions();
