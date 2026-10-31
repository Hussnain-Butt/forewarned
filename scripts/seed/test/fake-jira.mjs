// A fake Jira for testing assign-personas.mjs without a site. Loaded with
// `node --import <this file>`, it replaces globalThis.fetch. FAKE_SEED_DIR points at a copy of
// the seed folder; FAKE_BASELINE sets every user's open work items outside CHK and PLT;
// FAKE_START_ASSIGNEE sets who the seeded work items start with: an account ID (as when the
// space's default assignee is its lead), "roles" (as after an earlier run), or unset (nobody);
// FAKE_START_LABELS=none starts them without the file's role labels (as on the demo site, which
// was imported before labels); FAKE_DROP_FIRST=1 leaves out the first seeded work item (as if
// it wasn't imported); FAKE_FAIL_EDIT=<key> makes every edit of that work item fail with HTTP
// 400 and an error body with an extra field the script must not print. Counts for assignee and
// label queries come from the fake's own state, so they verify the post-step's edits; other
// inventory lines answer with the answer key's expected values. Like the demo site (M1), search
// results hold only the requested fields and never the importer's "External issue ID" field.
// On exit it prints the number of successful edits to stderr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.FAKE_SEED_DIR;
const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const demo = read('forewarned-demo.json');
const key = read('answer-key.json');
const personas = read('personas.json');

const users = personas.roles.map((r) => ({ accountId: `acc-${r.role}`, accountType: 'atlassian', active: true, displayName: r.displayName }));
const roleOf = Object.fromEntries(personas.roles.map((r) => [r.prefix, r.role]));
const startMode = process.env.FAKE_START_ASSIGNEE;
const startAssignee = (ext) => {
  if (startMode !== 'roles') return startMode || null;
  const role = roleOf[ext.split('-')[0]];
  return role ? `acc-${role}` : null;
};
const issues = demo.projects.flatMap((p) => p.issues.map((i, n) => ({
  key: `${p.key}-${n + 3}`, ext: i.externalId, summary: i.summary, status: i.status, accountId: startAssignee(i.externalId),
  labels: process.env.FAKE_START_LABELS === 'none' ? [] : [...(i.labels ?? [])],
}))).slice(process.env.FAKE_DROP_FIRST ? 1 : 0);
const keyOf = Object.fromEntries(issues.map((i) => [i.ext, i.key]));
const fill = (jql) => jql
  .replace(/\{\{key:([^}]+)\}\}/g, (_, ext) => keyOf[ext])
  .replace(/\{\{accountId:([^}]+)\}\}/g, (_, role) => `acc-${role}`);
const expectedByJql = new Map(key.inventory.filter((l) => l.jql).map((l) => [fill(l.jql), l.expected]));
let edits = 0;
process.on('exit', () => process.stderr.write(`fake-jira edits: ${edits}\n`));

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, init = {}) => {
  const { pathname, searchParams } = new URL(url);
  const body = init.body ? JSON.parse(init.body) : undefined;
  const method = init.method ?? 'GET';
  if (!/^Basic /.test(init.headers?.Authorization ?? '')) return json({ errorMessages: ['no auth'] }, 401);
  if (body && init.headers['Content-Type'] !== 'application/json') return json({ errorMessages: ['Unsupported media type'] }, 415);

  if (method === 'GET' && pathname === '/rest/api/3/user/search') {
    return json(users.filter((u) => u.displayName.startsWith(searchParams.get('query'))));
  }
  let m = /^\/rest\/api\/3\/project\/(CHK|PLT)(\/versions)?$/.exec(pathname);
  if (method === 'GET' && m) {
    const project = demo.projects.find((p) => p.key === m[1]);
    return json(m[2] ? project.versions.map((v) => ({ name: v.name, released: v.released })) : { key: m[1], description: project.description });
  }
  if (method === 'POST' && pathname === '/rest/api/3/search/approximate-count') {
    if (body.jql.includes('project not in (CHK, PLT)')) return json({ count: Number(process.env.FAKE_BASELINE ?? 0) });
    const who = /assignee = "([^"]+)" AND statusCategory != Done/.exec(body.jql);
    if (who) return json({ count: issues.filter((i) => i.accountId === who[1] && i.status !== 'Done').length });
    const label = /AND labels = (\S+)$/.exec(body.jql);
    if (label) return json({ count: issues.filter((i) => i.labels.includes(label[1])).length });
    if (!expectedByJql.has(body.jql)) return json({ errorMessages: [`Unknown query in the fake: ${body.jql}`] }, 400);
    return json({ count: expectedByJql.get(body.jql) });
  }
  if (method === 'POST' && pathname === '/rest/api/3/search/jql') {
    const start = Number(body.nextPageToken ?? 0);
    const page = issues.slice(start, start + body.maxResults);
    const isLast = start + body.maxResults >= issues.length;
    const fieldsOf = (i) => ({ summary: i.summary, assignee: i.accountId ? { accountId: i.accountId } : null, labels: i.labels });
    return json({
      issues: page.map((i) => ({ key: i.key, fields: Object.fromEntries(body.fields.map((f) => [f, fieldsOf(i)[f]]).filter(([, v]) => v !== undefined)) })),
      isLast,
      ...(isLast ? {} : { nextPageToken: String(start + body.maxResults) }),
    });
  }
  m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)(\/assignee)?$/.exec(pathname);
  if (method === 'PUT' && m) {
    if (m[1] === process.env.FAKE_FAIL_EDIT) return json({ errorMessages: ['Edit refused.'], debug: 'SENTINEL-RESPONSE-BODY' }, 400);
    const issue = issues.find((i) => i.key === m[1]);
    if (m[2]) {
      issue.accountId = body.accountId;
    } else {
      if (searchParams.get('notifyUsers') !== 'false') return json({ errorMessages: ['The fake expects notifyUsers=false on edits.'] }, 400);
      for (const op of body.update.labels) issue.labels.push(op.add);
    }
    edits += 1;
    return new Response(null, { status: 204 });
  }
  return json({ errorMessages: [`Not faked: ${method} ${pathname}`] }, 404);
};
