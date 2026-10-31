// Test helpers for the Forewarned seed. loadSeed() turns forewarned-demo.json into plain
// records with whole-day numbers (0 = import day), the shape story 002's tests can reuse.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CODEGEIST_DIR = join(SEED_DIR, '..', '..');
export const DEMO_FILE = 'forewarned-demo.json';
export const KEY_FILE = 'answer-key.json';

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export const tempDir = () => mkdtempSync(join(tmpdir(), 'forewarned-seed-'));

// Runs a script with node and returns { status, stdout, stderr }.
export function runNode(script, args = [], env = {}) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

// Runs the generator into a fresh temporary folder.
export function generate(args = []) {
  const out = tempDir();
  return { out, ...runNode(join(SEED_DIR, 'generate.mjs'), ['--out', out, ...args]) };
}

// "P-150D" -> -150, "P42D" -> 42; absolute dates need the day they count from.
export function parseDay(value, today) {
  const relative = /^P(-?\d+)D$/.exec(value);
  if (relative) return Number(relative[1]);
  const absolute = /^(\d{4}-\d{2}-\d{2})T09:00:00\.000\+0000$/.exec(value);
  if (absolute && today) {
    return Math.round((Date.parse(`${absolute[1]}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  }
  throw new Error(`Unexpected date value ${JSON.stringify(value)}`);
}

export function loadSeed(demo, today) {
  const day = (value) => parseDay(value, today);
  const records = new Map();
  for (const project of demo.projects) {
    for (const issue of project.issues) {
      const moveTo = (status) => issue.history?.find((h) => h.items.some((i) => i.toString === status));
      const start = moveTo('In Progress');
      const finish = moveTo('Done');
      records.set(issue.externalId, {
        id: issue.externalId,
        role: issue.externalId.split('-')[0],
        space: project.key,
        type: issue.issueType,
        status: issue.status,
        resolution: issue.resolution ?? null,
        summary: issue.summary,
        created: day(issue.created),
        updated: day(issue.updated),
        due: issue.duedate ? day(issue.duedate) : null,
        start: start ? day(start.created) : null,
        finish: finish ? day(finish.created) : null,
        components: issue.components ?? [],
        fixVersions: issue.fixedVersions ?? [],
        labels: issue.labels ?? [],
        parent: null,
        blockedBy: [],
        blocks: [],
      });
    }
  }
  for (const link of demo.links) {
    if (link.name === 'Epic-Story Link') records.get(link.destinationId).parent = link.sourceId;
    if (link.name === 'Blocks') {
      records.get(link.destinationId).blockedBy.push(link.sourceId);
      records.get(link.sourceId).blocks.push(link.destinationId);
    }
  }
  return records;
}

export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
