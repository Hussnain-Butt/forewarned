// A fake Jira for testing assign-personas.mjs without a site. Loaded with
// `node --import <this file>`, it replaces globalThis.fetch. FAKE_SEED_DIR points at a copy of
// the seed folder; FAKE_BASELINE sets every user's open work items outside CHK and PLT;
// FAKE_START_ASSIGNEE sets who the seeded work items start with: an account ID (as when the
// space's default assignee is its lead), "roles" (as after an earlier run), or unset (nobody).
// Counts for assignee queries come from the fake's own state, so they verify the assignments;
// other inventory lines answer with the answer key's expected values.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.FAKE_SEED_DIR;
const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const demo = read('forewarned-demo.json');
const key = read('answer-key.json');
const personas = read('personas.json');
const FIELD = 'customfield_10042';

const users = personas.roles.map((r) => ({ accountId: `acc-${r.role}`, accountType: 'atlassian', active: true, displayName: r.displayName }));
const roleOf = Object.fromEntries(personas.roles.map((r) => [r.prefix, r.role]));
const startMode = process.env.FAKE_START_ASSIGNEE;
const startAssignee = (ext) => {
  if (startMode !== 'roles') return startMode || null;
  const role = roleOf[ext.split('-')[0]];
  return role ? `acc-${role}` : null;
};
const issues = demo.projects.flatMap((p) => p.issues.map((i, n) => ({
  key: `${p.key}-${n + 3}`, ext: i.externalId, status: i.status, accountId: startAssignee(i.externalId),
})));
const keyOf = Object.fromEntries(issues.map((i) => [i.ext, i.key]));
const fill = (jql) => jql
  .replace(/\{\{key:([^}]+)\}\}/g, (_, ext) => keyOf[ext])
  .replace(/\{\{accountId:([^}]+)\}\}/g, (_, role) => `acc-${role}`);
const expectedByJql = new Map(key.inventory.filter((l) => l.jql).map((l) => [fill(l.jql), l.expected]));
globalThis.fakeJira = { puts: 0 };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, init = {}) => {
  const { pathname, searchParams } = new URL(url);
  const body = init.body ? JSON.parse(init.body) : undefined;
  const method = init.method ?? 'GET';
  if (!/^Basic /.test(init.headers?.Authorization ?? '')) return json({ errorMessages: ['no auth'] }, 401);

  if (method === 'GET' && pathname === '/rest/api/3/user/search') {
    return json(users.filter((u) => u.displayName.startsWith(searchParams.get('query'))));
  }
  if (method === 'GET' && pathname === '/rest/api/3/field') {
    return json([{ id: 'summary', name: 'Summary' }, { id: FIELD, name: 'External issue ID' }]);
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
    if (!expectedByJql.has(body.jql)) return json({ errorMessages: [`Unknown query in the fake: ${body.jql}`] }, 400);
    return json({ count: expectedByJql.get(body.jql) });
  }
  if (method === 'POST' && pathname === '/rest/api/3/search/jql') {
    const start = Number(body.nextPageToken ?? 0);
    const page = issues.slice(start, start + body.maxResults);
    const isLast = start + body.maxResults >= issues.length;
    return json({
      issues: page.map((i) => ({ key: i.key, fields: { [FIELD]: i.ext, assignee: i.accountId ? { accountId: i.accountId } : null } })),
      isLast,
      ...(isLast ? {} : { nextPageToken: String(start + body.maxResults) }),
    });
  }
  m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/assignee$/.exec(pathname);
  if (method === 'PUT' && m) {
    issues.find((i) => i.key === m[1]).accountId = body.accountId;
    globalThis.fakeJira.puts += 1;
    return new Response(null, { status: 204 });
  }
  return json({ errorMessages: [`Not faked: ${method} ${pathname}`] }, 404);
};
