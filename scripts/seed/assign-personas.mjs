#!/usr/bin/env node
// Post-import step for the Forewarned seed (story 001, AC 20–25).
//
// After forewarned-demo.json is imported into CHK and PLT, this script assigns each role's
// seeded work items to the existing site user named in personas.json, adds any role label
// from the file that the site lacks, then runs every inventory line of answer-key.json and
// prints PASS or FAIL per line. It can be run again: work items that are already right are
// skipped.
//
// Credentials come only from environment variables set in your own terminal:
//   JIRA_SITE_URL   for example https://your-site.atlassian.net
//   JIRA_EMAIL      the email of the Atlassian account that owns the API token
//   JIRA_API_TOKEN  a short-lived classic API token (revoke it when you are done)
// The script writes no files and never prints the token, the email or API responses.
//
// Usage: node scripts/seed/assign-personas.mjs   (Node 22+, no npm dependencies)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_VARS = ['JIRA_SITE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'];
const UNASSIGNED = 'un';
const PARALLEL_REQUESTS = 5;
const COUNT_ATTEMPTS = 3; // search counts can lag a few seconds behind assignments

class StopError extends Error {}

const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });
const readJson = (name) => JSON.parse(readFileSync(join(HERE, name), 'utf8'));

function readEnv() {
  const missing = ENV_VARS.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    throw new StopError(`Missing environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Set ${missing.length > 1 ? 'them' : 'it'} in this terminal and run again.`);
  }
  let site;
  try {
    site = new URL(process.env.JIRA_SITE_URL.trim());
  } catch {
    throw new StopError('JIRA_SITE_URL is not a valid URL. Expected something like https://your-site.atlassian.net');
  }
  if (site.protocol !== 'https:') throw new StopError('JIRA_SITE_URL must start with https://');
  const credentials = `${process.env.JIRA_EMAIL.trim()}:${process.env.JIRA_API_TOKEN.trim()}`;
  return { origin: site.origin, auth: `Basic ${Buffer.from(credentials).toString('base64')}` };
}

// A short reason from Jira's error body (never the whole response).
function reason(status, text) {
  if (status === 401) {
    return 'check JIRA_EMAIL and JIRA_API_TOKEN. An API token with scopes does not work against the site URL; create a classic API token.';
  }
  try {
    const body = JSON.parse(text);
    const messages = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})];
    if (messages.length) return messages.join(' ').slice(0, 300);
  } catch {
    // not JSON
  }
  return status === 403 ? 'the account lacks a permission (Browse users and groups, or Assign issues).' : 'no details.';
}

function jiraClient({ origin, auth }) {
  return async function jira(method, path, body) {
    for (let attempt = 1; ; attempt += 1) {
      let res;
      try {
        res = await fetch(`${origin}${path}`, {
          method,
          headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new StopError(`Could not reach the site for ${method} ${path.split('?')[0]}. Check JIRA_SITE_URL and your connection.`);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await sleep(Math.min(Number(res.headers.get('retry-after')) || 2 ** attempt, 30) * 1000);
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        const error = new StopError(`${method} ${path.split('?')[0]} failed with HTTP ${res.status}: ${reason(res.status, text)}`);
        error.status = res.status;
        throw error;
      }
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        throw new StopError(`${method} ${path.split('?')[0]} returned a response that is not JSON. Check JIRA_SITE_URL.`);
      }
    }
  };
}

const countJql = async (jira, jql) => (await jira('POST', '/rest/api/3/search/approximate-count', { jql })).count;

// The first failure stops every worker, so no edits continue after "Stopped" is printed.
async function runPool(jobs, size) {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < jobs.length) {
      const job = jobs[next];
      next += 1;
      try {
        await job();
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker));
}

async function findUsers(jira, roles) {
  const accountIds = {};
  const problems = [];
  for (const r of roles) {
    const users = await jira('GET', `/rest/api/3/user/search?query=${encodeURIComponent(r.displayName)}&maxResults=50`);
    const matches = users.filter((u) => u.accountType === 'atlassian' && u.active && u.displayName === r.displayName);
    if (matches.length === 1) accountIds[r.role] = matches[0].accountId;
    else problems.push(`${r.displayName} (${r.role}): ${matches.length ? `${matches.length} active users have this name` : 'no active user with this exact name'}`);
  }
  if (problems.length) throw new StopError(`Fix these users in personas.json first:\n  ${problems.join('\n  ')}`);
  return accountIds;
}

// Matched by space and summary, which are unique in the seed. The importer also stores each
// externalId in its "External issue ID" field, but on the demo site the REST API never returns
// that field (JQL can still search it), so it can't be read here (M1).
async function findSeededItems(jira, demo) {
  const idBySummary = new Map(demo.projects.flatMap((p) => p.issues.map((i) => [`${p.key}:${i.summary}`, i.externalId])));
  const found = new Map();
  const duplicates = new Set();
  let unknown = 0;
  let nextPageToken;
  do {
    const page = await jira('POST', '/rest/api/3/search/jql', {
      jql: 'project in (CHK, PLT) ORDER BY key ASC', fields: ['summary', 'assignee', 'labels'], maxResults: 100, nextPageToken,
    });
    for (const issue of page.issues) {
      const id = idBySummary.get(`${issue.key.split('-')[0]}:${issue.fields.summary}`);
      if (id === undefined) {
        unknown += 1;
      } else {
        if (found.has(id)) duplicates.add(id);
        found.set(id, { key: issue.key, accountId: issue.fields.assignee?.accountId ?? null, labels: issue.fields.labels ?? [] });
      }
    }
    nextPageToken = page.isLast ? undefined : page.nextPageToken;
  } while (nextPageToken);

  if (duplicates.size) {
    throw new StopError(`${duplicates.size} seeded work items exist more than once, so the file was imported twice. Delete and recreate CHK and PLT, then import once.`);
  }
  const expectedIds = [...idBySummary.values()];
  const missing = expectedIds.filter((id) => !found.has(id));
  if (missing.length) {
    throw new StopError(`${missing.length} of ${expectedIds.length} seeded work items were not found by space and summary (for example ${missing.slice(0, 5).join(', ')}). Import forewarned-demo.json first, and don't rename seeded work items before this step.`);
  }
  if (unknown) {
    console.log(`Note: ${unknown} work item(s) in CHK and PLT are not in forewarned-demo.json, probably the template's sample work items. Delete them; the space totals FAIL until you do.`);
  }
  return found;
}

async function measure(jira, line, fill) {
  if (line.jql) return countJql(jira, fill(line.jql));
  if (line.versionsOf) {
    const versions = await jira('GET', `/rest/api/3/project/${line.versionsOf}/versions`);
    return { released: versions.filter((v) => v.released).length, unreleased: versions.filter((v) => !v.released).length };
  }
  if (line.descriptionOf) {
    const project = await jira('GET', `/rest/api/3/project/${line.descriptionOf}`);
    return (project.description ?? '').trim();
  }
  throw new StopError(`Inventory line ${line.id} has no query.`);
}

const shown = (value, line) => (line.descriptionOf ? (value === line.expected ? 'matches' : 'differs') : JSON.stringify(value));

async function main() {
  const env = readEnv();
  const personas = readJson('personas.json');
  const key = readJson('answer-key.json');
  const demo = readJson('forewarned-demo.json');

  const todo = personas.roles.filter((r) => !r.displayName?.trim() || r.displayName.startsWith('TODO'));
  if (todo.length) {
    throw new StopError(`personas.json has no demo-site user yet for: ${todo.map((r) => r.role).join(', ')}. Pick an existing user for each role first.`);
  }
  const names = personas.roles.map((r) => r.displayName);
  if (new Set(names).size !== names.length) {
    throw new StopError('personas.json maps two roles to the same user. Each role needs its own user, or the load pattern (P5) breaks.');
  }

  const jira = jiraClient(env);
  console.log(`Site: ${new URL(env.origin).host}`);
  for (const space of ['CHK', 'PLT']) {
    await jira('GET', `/rest/api/3/project/${space}`).catch((error) => {
      if (error.status !== 404) throw error;
      throw new StopError(`Space ${space} was not found. Create CHK and PLT as company-managed Scrum spaces and import first.`);
    });
  }

  // 1. Users, and the open work they already have elsewhere (AC 22)
  const accountIds = await findUsers(jira, personas.roles);
  const limit = key.postStep.maxExistingOpenPerPerson;
  console.log(`\nOpen work items each user already has outside CHK and PLT (limit ${limit}):`);
  const heavy = [];
  for (const r of personas.roles) {
    const n = await countJql(jira, `assignee = "${accountIds[r.role]}" AND statusCategory != Done AND project not in (CHK, PLT)`);
    console.log(`  ${r.title} (${r.displayName}): ${n}`);
    if (n > limit) heavy.push(`${r.displayName} (${n})`);
  }
  if (heavy.length) {
    throw new StopError(`Nothing assigned. These users have more than ${limit} open work items, which would hide the planted load pattern (P5): ${heavy.join(', ')}. Pick other users in personas.json.`);
  }

  // 2. Seeded work items, found by space and summary (AC 23)
  const expectedIds = demo.projects.flatMap((p) => p.issues.map((i) => i.externalId));
  const found = await findSeededItems(jira, demo);

  // 3. Assign each role's work items ("un-" work items stay unassigned), and add role labels
  // the import file has but the site lacks (the demo site was imported before labels, M1)
  const roleByPrefix = Object.fromEntries(personas.roles.map((r) => [r.prefix, r]));
  const labelsOf = new Map(demo.projects.flatMap((p) => p.issues.map((i) => [i.externalId, i.labels ?? []])));
  const tally = {};
  const labelTally = { changed: 0, unchanged: 0 };
  const jobs = [];
  for (const id of expectedIds) {
    const prefix = id.split('-')[0];
    if (prefix !== UNASSIGNED && !roleByPrefix[prefix]) throw new StopError(`External ID ${id} has an unknown role prefix "${prefix}".`);
    const target = prefix === UNASSIGNED ? null : accountIds[roleByPrefix[prefix].role];
    const item = found.get(id);
    const t = (tally[prefix] ??= { changed: 0, unchanged: 0 });
    const edits = [];
    if (item.accountId === target) {
      t.unchanged += 1;
    } else {
      t.changed += 1;
      edits.push(() => jira('PUT', `/rest/api/3/issue/${item.key}/assignee`, { accountId: target }));
    }
    const missingLabels = labelsOf.get(id).filter((label) => !item.labels.includes(label));
    if (missingLabels.length) {
      labelTally.changed += 1;
      edits.push(() => jira('PUT', `/rest/api/3/issue/${item.key}?notifyUsers=false`, { update: { labels: missingLabels.map((add) => ({ add })) } }));
    } else if (labelsOf.get(id).length) {
      labelTally.unchanged += 1;
    }
    // One job per work item: parallel edits of the same work item can lose an update.
    if (edits.length) jobs.push(async () => { for (const edit of edits) await edit(); });
  }
  await runPool(jobs, PARALLEL_REQUESTS);
  console.log('\nAssignments:');
  for (const [prefix, t] of Object.entries(tally)) {
    const who = prefix === UNASSIGNED ? 'Unassigned' : `${roleByPrefix[prefix].title} -> ${roleByPrefix[prefix].displayName}`;
    console.log(`  ${who}: ${t.changed} changed, ${t.unchanged} already right`);
  }
  console.log(`Role labels on child work items: ${labelTally.changed} changed, ${labelTally.unchanged} already right`);

  // 4. Inventory (AC 23, 27)
  const fill = (jql) => jql
    .replace(/\{\{key:([^}]+)\}\}/g, (_, ext) => found.get(ext).key)
    .replace(/\{\{accountId:([^}]+)\}\}/g, (_, role) => accountIds[role]);
  console.log('\nInventory:');
  let failures = 0;
  for (const line of key.inventory) {
    let actual;
    let error;
    for (let attempt = 1; attempt <= COUNT_ATTEMPTS; attempt += 1) {
      try {
        actual = await measure(jira, line, fill);
        error = undefined;
      } catch (e) {
        if (!(e instanceof StopError)) throw e;
        error = e.message;
      }
      if (!error && JSON.stringify(actual) === JSON.stringify(line.expected)) break;
      if (attempt < COUNT_ATTEMPTS && !error && line.jql) await sleep(3000);
      else break;
    }
    const pass = !error && JSON.stringify(actual) === JSON.stringify(line.expected);
    if (!pass) failures += 1;
    const detail = error ? `error: ${error}` : `expected ${shown(line.expected, line)}, got ${shown(actual, line)}`;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${line.id}: ${line.description} (${detail})`);
  }
  console.log(failures
    ? `\n${failures} of ${key.inventory.length} inventory lines FAIL. See Troubleshooting in scripts/seed/README.md.`
    : `\nAll ${key.inventory.length} inventory lines PASS.`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof StopError ? `Stopped: ${error.message}` : `Error: ${error.message}`);
  process.exitCode = 1;
});
