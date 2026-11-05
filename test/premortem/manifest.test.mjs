// The agent's wiring in manifest.yml (story 008 AC 1, 4): forge lint checks the module structure,
// but not that the agent lists every action or that each handler exists, so a typo would deploy
// and only fail in Rovo chat. The manifest is read as text (no YAML dependency).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const manifest = await readFile(new URL('../../manifest.yml', import.meta.url), 'utf8');
const actionsModule = await readFile(new URL('../../src/actions/index.js', import.meta.url), 'utf8');
const ACTIONS = ['run-premortem', 'get-evidence', 'submit-premortem', 'get-premortem', 'explain-reason'];

// The lines of a YAML list under `key:` inside the agent, until the next key at the same indent.
function agentList(key) {
  const lines = manifest.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:` && line.startsWith('      '));
  assert.ok(start >= 0, `the agent has ${key}`);
  const items = [];
  for (const line of lines.slice(start + 1)) {
    const item = line.match(/^ {8}- (.+)$/);
    if (!item) break;
    items.push(item[1].trim());
  }
  return items;
}

// The block of one action module, from its key to the next action.
const actionBlock = (key) => manifest.split(/\n {4}- key: /).find((block) => block.startsWith(`${key}\r`) || block.startsWith(`${key}\n`));

test('the agent offers the three starters and all five actions', () => {
  assert.deepEqual(agentList('conversationStarters'), ['Run a pre-mortem on this epic', 'Why is reason 1 likely?', 'Show the last pre-mortem for this epic']);
  assert.deepEqual(agentList('actions'), ACTIONS);
  for (const key of ACTIONS) assert.ok(actionBlock(key), `action module ${key}`);
  assert.match(actionBlock('explain-reason'), /actionVerb: GET/);
  assert.match(actionBlock('explain-reason'), /reasonNumber:\s+title: [^\n]+\s+type: integer\s+required: true/);
  assert.match(actionBlock('run-premortem'), /actionVerb: TRIGGER/);
});

test('every action function has a handler the actions module exports', () => {
  const handlers = [...manifest.matchAll(/handler: actions\/index\.(\w+)/g)].map(([, name]) => name);
  assert.equal(handlers.length, ACTIONS.length);
  for (const name of handlers) assert.match(actionsModule, new RegExp(`export const ${name} = `), name);
});
