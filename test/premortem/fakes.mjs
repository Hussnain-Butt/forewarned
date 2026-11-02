// Fakes for the pre-mortem pipeline tests: Forge KVS, the async event queue, and the Jira senders
// of the seed port plus the edit permission.

import { createJira } from '../../src/engine/jira.js';
import { seedPort } from '../engine/seed-port.mjs';

// `writes` keeps every value set, in order, so tests can check the steps of a run. A key for which
// `failSet` returns true makes `set` throw, like a KVS write that fails.
export function fakeKvs({ failSet = () => false } = {}) {
  const data = new Map();
  const writes = [];
  return {
    data,
    writes,
    get: async (key) => data.get(key)?.value,
    set: async (key, value, options) => {
      if (failSet(key)) throw new Error('KVS write failed');
      data.set(key, { value: structuredClone(value), options });
      writes.push({ key, value: structuredClone(value) });
    },
  };
}

// The stored pre-mortem ({ pack, report }) of an epic, or undefined.
export const storedOf = (kvs, epicKey) => kvs.data.get(`premortem:${epicKey}`)?.value;

// Records every push, together with what the KVS held at that moment.
export function fakeQueue(kvs) {
  const pushes = [];
  return { pushes, push: async (event) => { pushes.push({ event, kvsAtPush: structuredClone([...(kvs?.data ?? new Map())]) }); return { jobId: `job-${pushes.length}` }; } };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Seed-port senders plus the user's edit permission on the epic.
export function fakeSenders({ canEdit = true, ...seedOptions } = {}) {
  const { senders, log, keys } = seedPort(seedOptions);
  return {
    log,
    keys,
    senders: {
      ...senders,
      myPermissions: async () => json({ permissions: { EDIT_ISSUES: { havePermission: canEdit } } }),
    },
  };
}

export const portOf = (senders) => createJira(senders, { deadline: Infinity, sleep: async () => {} });
