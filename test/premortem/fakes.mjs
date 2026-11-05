// Fakes for the pre-mortem pipeline tests: Forge KVS, the async event queue, and the Jira senders
// of the seed port plus the edit permission.

import { createJira } from '../../src/engine/jira.js';
import { seedPort } from '../engine/seed-port.mjs';

// `writes` keeps every value set, in order, so tests can check the steps of a run. A key for which
// `failSet` returns true makes `set` throw, like a KVS write that fails. Like Forge KVS, a set with
// `keyPolicy: 'FAIL_IF_EXISTS'` throws when the key exists; values never expire here, like an
// expired value KVS hasn't deleted yet.
export function fakeKvs({ failSet = () => false } = {}) {
  const data = new Map();
  const writes = [];
  return {
    data,
    writes,
    get: async (key) => data.get(key)?.value,
    set: async (key, value, options) => {
      if (failSet(key)) throw new Error('KVS write failed');
      if (options?.keyPolicy === 'FAIL_IF_EXISTS' && data.has(key)) throw new Error('The key already exists');
      data.set(key, { value: structuredClone(value), options });
      writes.push({ key, value: structuredClone(value) });
    },
    delete: async (key) => { data.delete(key); },
  };
}

// The stored pre-mortem ({ pack, report }) of an epic, by issue ID, or undefined.
export const storedOf = (kvs, epicId) => kvs.data.get(`premortem:${epicId}`)?.value;

// The seed's issue ID for a key (storage is keyed by issue ID).
export async function idOf(key) {
  const { senders } = seedPort();
  return (await (await senders.issue(key, ['summary'])).json()).id;
}

// Records every push, together with what the KVS held at that moment.
export function fakeQueue(kvs) {
  const pushes = [];
  return { pushes, push: async (event) => { pushes.push({ event, kvsAtPush: structuredClone([...(kvs?.data ?? new Map())]) }); return { jobId: `job-${pushes.length}` }; } };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Work item types and create fields as Jira's create metadata lists them (story 006 AC 5).
export const CREATE_TYPES = [
  { id: '10000', name: 'Epic', hierarchyLevel: 1, subtask: false },
  { id: '10001', name: 'Story', hierarchyLevel: 0, subtask: false },
  { id: '10002', name: 'Task', hierarchyLevel: 0, subtask: false },
  { id: '10003', name: 'Bug', hierarchyLevel: 0, subtask: false },
  { id: '10004', name: 'Sub-task', hierarchyLevel: -1, subtask: true },
];
const field = (fieldId, name, required = false, hasDefaultValue = false) => ({ fieldId, key: fieldId, name, required, hasDefaultValue });
export const CREATE_FIELDS = [
  field('summary', 'Summary', true), field('issuetype', 'Work type', true), field('project', 'Space', true),
  field('parent', 'Parent'), field('description', 'Description'), field('labels', 'Labels'), field('reporter', 'Reporter', true, true),
];

// Seed-port senders plus the user's permissions on the epic and work item creation. `created`
// (bodies of the work items created, with their new IDs and keys CHK-901, CHK-902, …), `links` and
// `deleted` (keys deleted since) can be shared between senders, so another user reads the same
// Jira. `failCreate(n)` gives an HTTP status for the n-th create request (retries count), or 0.
export function fakeSenders({
  canEdit = true, canCreate = true, types = CREATE_TYPES, fields = CREATE_FIELDS, failCreate = () => 0,
  created = [], links = [], deleted = [], ...seedOptions
} = {}) {
  const { senders, log, keys } = seedPort(seedOptions);
  let createRequests = 0;
  const visibleCreated = (idsOrKeys) => created.filter((t) => !deleted.includes(t.key) && (idsOrKeys.includes(t.id) || idsOrKeys.includes(t.key)));
  return {
    log,
    keys,
    created,
    links,
    deleted,
    senders: {
      ...senders,
      myPermissions: async () => json({ permissions: { EDIT_ISSUES: { havePermission: canEdit }, CREATE_ISSUES: { havePermission: canCreate } } }),
      createMetaTypes: async () => json({ issueTypes: types, startAt: 0, maxResults: 200, total: types.length }),
      createMetaFields: async () => json({ fields, startAt: 0, maxResults: 200, total: fields.length }),
      createIssue: async (fields) => {
        const body = { fields };
        createRequests += 1;
        const status = failCreate(createRequests);
        if (status) return json({ errorMessages: ['Failed'] }, status);
        const n = created.length + 1;
        const task = { id: String(30000 + n), key: `${body.fields.project.key}-${900 + n}`, body };
        created.push(task);
        return json({ id: task.id, key: task.key, self: `https://seed.example/rest/api/3/issue/${task.id}` }, 201);
      },
      createLink: async (body) => { links.push(body); return new Response(null, { status: 201 }); },
      bulkIssues: async (body) => {
        const page = await (await senders.bulkIssues(body)).json();
        // A test sets `task.fields` (assignee, duedate, status) to change a task after it was created.
        const tasks = visibleCreated(body.issueIdsOrKeys).map((t) => ({
          id: t.id, key: t.key, fields: { summary: t.body.fields.summary, status: { name: 'To Do' }, assignee: null, duedate: null, ...t.fields },
        }));
        return json({ ...page, issues: [...page.issues, ...tasks] });
      },
    },
  };
}

export const portOf = (senders) => createJira(senders, { deadline: Infinity, sleep: async () => {} });

// Confluence spaces as REST v2 lists them (story 007): two the user can create pages in, one they can
// only view, and a personal space.
export const SPACES = [
  { id: '101', key: 'ZETA', name: 'Zeta', type: 'global' },
  { id: '102', key: 'ALPHA', name: 'Alpha', type: 'global' },
  { id: '103', key: 'BETA', name: 'Beta', type: 'global' },
  { id: '104', key: '~me', name: 'My space', type: 'personal' },
];

// The Confluence senders of forge-confluence.js. `creatable` lists the space IDs where the user may
// create pages; `pages` is the site's pages (shared and changed by creates and updates); `fail` maps a
// sender name to the HTTP status it answers with. `requests` names every request in order.
export function fakeConfluence({ spaces = SPACES, creatable = ['101', '102', '104'], pages = [], fail = {} } = {}) {
  const created = [];
  const updated = [];
  const requests = [];
  const spaceOf = (id) => spaces.find((space) => space.id === String(id));
  const senders = {
    spaces: async () => json({ results: [...spaces].sort((a, b) => a.name.localeCompare(b.name)), _links: {} }),
    space: async (id) => (spaceOf(id) ? json(spaceOf(id)) : json({}, 404)),
    spaceOperations: async (id) => json({
      operations: [{ operation: 'read', targetType: 'space' }, ...(creatable.includes(String(id)) ? [{ operation: 'create', targetType: 'page' }] : [])],
    }),
    page: async (id) => {
      const page = pages.find((p) => p.id === String(id));
      return page ? json(page) : json({}, 404);
    },
    // Like the sender's request: published and archived pages with that exact title.
    pagesByTitle: async (spaceId, title) => json({ results: pages.filter((p) => p.spaceId === String(spaceId) && p.title === title && ['current', 'archived'].includes(p.status)) }),
    createPage: async (body) => {
      const id = String(7001 + created.length);
      created.push(body);
      const page = { id, status: 'current', title: body.title, spaceId: body.spaceId, version: { number: 1 }, body: body.body, _links: { base: 'https://seed.example/wiki', webui: `/spaces/${spaceOf(body.spaceId)?.key}/pages/${id}` } };
      pages.push(page);
      return json(page);
    },
    updatePage: async (id, body) => {
      const page = pages.find((p) => p.id === String(id));
      updated.push({ id: String(id), body });
      Object.assign(page, { title: body.title, version: body.version, body: body.body });
      return json(page);
    },
  };
  // Every sender records its request and answers with its `fail` status when there is one.
  for (const [name, send] of Object.entries(senders)) {
    senders[name] = async (...args) => {
      requests.push(name);
      return fail[name] ? json({ message: 'Failed' }, fail[name]) : send(...args);
    };
  }
  return { senders, created, updated, requests, pages };
}
