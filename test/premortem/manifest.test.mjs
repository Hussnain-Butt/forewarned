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

// Story 009 AC 12–13: every run starts from a click or a Rovo request, inside the free allowance.
test('the manifest starts nothing in the background', () => {
  for (const banned of [/^\s*scheduledTrigger:/m, /^\s*trigger:/m, /^\s*llm:/m, /container/i, /^\s*external:/m]) {
    assert.doesNotMatch(manifest, banned);
  }
  const timeouts = [...manifest.matchAll(/timeoutSeconds: (\d+)/g)].map(([, seconds]) => Number(seconds));
  assert.ok(timeouts.length > 0 && timeouts.every((seconds) => seconds <= 300), `timeouts ${timeouts}`);
  assert.match(manifest, /^ {4}memoryMB: 256\r?$/m);
});

// forge lint refuses action descriptions over 255 characters (M7 ledger); run-premortem tells the
// agent about the cache and the cap (story 009 AC 4, 6).
test('action descriptions fit Forge, and run-premortem names the cache and the daily limit', () => {
  for (const key of ACTIONS) {
    const [, description] = actionBlock(key).match(/description: \|\r?\n {8}([^\r\n]+)/);
    assert.ok(description.length <= 255, `${key}: ${description.length} characters`);
  }
  assert.match(actionBlock('run-premortem'), /It reuses the last run if nothing changed in 24 hours and refuses at the daily limit\./);
});

// Story 008 AC 2 (say "saved" only on saved: true). M8 site QA S2: after the user cancelled the Save
// card, the agent still said the saved pre-mortem shows in the panel, because that sentence had no
// condition and the prompt didn't cover a cancelled save.
test('the prompt points to the panel only after saved: true, and reports a cancelled save as nothing saved', () => {
  assert.doesNotMatch(manifest, /Then say the saved pre-mortem shows in the Forewarned panel on the epic\./);
  assert.match(manifest, /If it returned saved: true, say the pre-mortem was saved, [^\r\n]*and say the saved pre-mortem shows in the Forewarned panel on the epic\./);
  assert.match(manifest, /If it returned saved: false, or the user cancelled the save so it didn't run, say plainly that nothing was saved, and don't say that it shows in the panel\./);
});
