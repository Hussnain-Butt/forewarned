// Test helpers that compare engine output with answer-key.json (story 002 AC 36).

import assert from 'node:assert/strict';
import { answerKey, keyOf } from './seed-snapshot.mjs';

// The answer key's expected evidence entries of one planted risk and type, in key order.
export const expectedEvidence = (riskId, type) => answerKey.plantedRisks
  .find((r) => r.id === riskId).expectedEvidence.filter((e) => e.type === type);

// Day counts may differ by the key's tolerance (time zones); every other number must be exact.
const isDayCount = (name) => /days/i.test(name);

// True when `actual` has every number of `expected` (within tolerance for day counts).
export function numbersMatch(actual, expected) {
  return Object.entries(expected).every(([name, value]) => (isDayCount(name)
    ? typeof actual?.[name] === 'number' && Math.abs(actual[name] - value) <= answerKey.toleranceDays
    : actual?.[name] === value));
}

// True when the item links every external ID in `mustLink`.
export const linksAll = (item, mustLink) => mustLink.every((id) => item.links.some((l) => l.key === keyOf(id)));

// Asserts that some item of the expected type matches the expected numbers and links.
export function assertEvidence(items, expected, label = expected.type) {
  const hit = items.find((i) => i.type === expected.type && numbersMatch(i.numbers, expected.numbers) && linksAll(i, expected.mustLink));
  assert.ok(hit, `${label}: no ${expected.type} item with ${JSON.stringify(expected.numbers)}; got ${JSON.stringify(items.filter((i) => i.type === expected.type).map((i) => i.numbers))}`);
  return hit;
}
