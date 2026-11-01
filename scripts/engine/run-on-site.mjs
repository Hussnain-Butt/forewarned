#!/usr/bin/env node
// Runs the Forewarned evidence engine (story 002) against a real Jira site from your own terminal,
// for QA: it prints the request count and duration (AC 33), the comparison set, the checks and
// every fact, so the pack can be checked against Jira by hand. It is not part of the app.
//
// Credentials come only from environment variables set in your own terminal:
//   JIRA_SITE_URL   for example https://your-site.atlassian.net
//   JIRA_EMAIL      the email of the Atlassian account that owns the API token
//   JIRA_API_TOKEN  a short-lived classic API token (revoke it when you are done)
// The script writes no files and never prints the token or the email.
//
// Usage: node scripts/engine/run-on-site.mjs <EPIC-KEY>   (or: npm run engine:run -- CHK-12)

import { buildEvidencePack } from '../../src/engine/index.js';

const ENV_VARS = ['JIRA_SITE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'];
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

class StopError extends Error {}

function readEnv() {
  const missing = ENV_VARS.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    throw new StopError(`Missing environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Set them in your own terminal (see the comment at the top of this script).`);
  }
  let origin;
  try {
    origin = new URL(process.env.JIRA_SITE_URL.trim()).origin;
  } catch {
    throw new StopError('JIRA_SITE_URL is not a valid URL. Use the form https://your-site.atlassian.net');
  }
  const auth = `Basic ${Buffer.from(`${process.env.JIRA_EMAIL.trim()}:${process.env.JIRA_API_TOKEN.trim()}`).toString('base64')}`;
  return { origin, auth };
}

// The same eight calls as src/engine/forge-jira.js, sent with Basic auth instead of asUser().
function siteSenders({ origin, auth }) {
  const send = async (path, init = {}) => {
    try {
      return await fetch(`${origin}${path}`, { ...init, headers: { Accept: 'application/json', ...init.headers, Authorization: auth } });
    } catch {
      throw new StopError('Could not reach the site. Check JIRA_SITE_URL and your connection.');
    }
  };
  const post = (path, body) => send(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const enc = encodeURIComponent;
  return {
    myself: () => send('/rest/api/3/myself'),
    serverInfo: () => send('/rest/api/3/serverInfo'),
    statuses: () => send('/rest/api/3/status'),
    linkTypes: () => send('/rest/api/3/issueLinkType'),
    issue: (key, fields) => send(`/rest/api/3/issue/${enc(key)}?fields=${enc(fields.join(','))}`),
    projectIssueTypes: (projectId) => send(`/rest/api/3/issuetype/project?projectId=${enc(projectId)}`),
    search: (body) => post('/rest/api/3/search/jql', body),
    count: (jql) => post('/rest/api/3/search/approximate-count', { jql }),
    changelogs: (body) => post('/rest/api/3/changelog/bulkfetch', body),
  };
}

async function main() {
  const epicKey = process.argv[2] ?? '';
  if (!ISSUE_KEY.test(epicKey)) throw new StopError('Usage: node scripts/engine/run-on-site.mjs <EPIC-KEY>, for example CHK-12');
  const { myself, ...senders } = siteSenders(readEnv());

  const me = await myself();
  if (!me.ok) throw new StopError(`The site refused the credentials (HTTP ${me.status}). Use a classic API token for this site.`);
  const { pack, error } = await buildEvidencePack({ senders, epicKey, accountId: (await me.json()).accountId });
  if (error) throw new StopError(error);

  console.log(`Comparison: ${pack.comparison.rule} (${pack.comparison.epics.length} epics)`);
  for (const [signal, check] of Object.entries(pack.checks)) console.log(`Check ${signal}: ${check.status}${check.note ? ` (${check.note})` : ''}`);
  for (const note of pack.notes) console.log(`Note: ${note}`);
  for (const item of pack.evidence) console.log(`${item.id} ${item.type}: ${item.fact}`);
  console.log(`packId ${pack.packId}`);
}

main().catch((error) => {
  console.error(error instanceof StopError || error.name === 'JiraError' ? `Stopped: ${error.message}` : `Error: ${error.message}`);
  process.exitCode = 1;
});
