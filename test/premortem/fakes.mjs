// Fakes for the pre-mortem pipeline tests: Forge KVS, the async event queue, and the Jira senders
// of the seed port plus entity properties and permissions.

import { createJira } from '../../src/engine/jira.js';
import { seedPort } from '../engine/seed-port.mjs';

// `writes` keeps every value set, in order, so tests can check the steps of a run.
export function fakeKvs() {
  const data = new Map();
  const writes = [];
  return {
    data,
    writes,
    get: async (key) => data.get(key)?.value,
    set: async (key, value, options) => {
      data.set(key, { value: structuredClone(value), options });
      writes.push({ key, value: structuredClone(value) });
    },
  };
}

// Records every push, together with what the KVS held at that moment.
export function fakeQueue(kvs) {
  const pushes = [];
  return { pushes, push: async (event) => { pushes.push({ event, kvsAtPush: structuredClone([...(kvs?.data ?? new Map())]) }); return { jobId: `job-${pushes.length}` }; } };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Seed-port senders plus entity properties, edit permission and optional write failures.
export function fakeSenders({ canEdit = true, failWrite = false, ...seedOptions } = {}) {
  const { senders, log, keys } = seedPort(seedOptions);
  const properties = new Map();
  return {
    log,
    keys,
    properties,
    senders: {
      ...senders,
      issueProperty: async (key, name) => (properties.has(`${key}/${name}`)
        ? json({ key: name, value: properties.get(`${key}/${name}`) })
        : json({ errorMessages: ['The property was not found.'] }, 404)),
      setIssueProperty: async (key, name, value) => {
        if (failWrite) return json({ errorMessages: ['Forbidden'] }, 403);
        properties.set(`${key}/${name}`, structuredClone(value));
        return new Response(null, { status: 200 });
      },
      myPermissions: async () => json({ permissions: { EDIT_ISSUES: { havePermission: canEdit } } }),
    },
  };
}

export const portOf = (senders) => createJira(senders, { deadline: Infinity, sleep: async () => {} });
