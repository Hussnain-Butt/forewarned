// Date and number helpers of the evidence engine (story 002 AC 10, 26, 27, 30).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayOf, formatCount, formatDay, isoDay, percent, roundedMedian, shorten } from '../../src/engine/format.js';

test('dayOf reads date-only, date-time and epoch values as the same UTC day', () => {
  const day = dayOf('2026-03-12');
  assert.equal(dayOf('2026-03-12T00:00:00.000+0000'), day);
  assert.equal(dayOf('2026-03-12T23:30:00.000-0500'), day + 1); // 04:30 UTC on 13 Mar
  assert.equal(dayOf(1773273600), day); // epoch seconds
  assert.equal(dayOf(1773273600000), day); // epoch milliseconds
});

test('days are written as "12 Mar 2026" in facts and YYYY-MM-DD in machine fields', () => {
  assert.equal(formatDay(dayOf('2026-03-12')), '12 Mar 2026');
  assert.equal(formatDay(dayOf('2026-04-05')), '5 Apr 2026');
  assert.equal(isoDay(dayOf('2026-04-05')), '2026-04-05');
});

test('percentages and medians are whole numbers', () => {
  assert.equal(percent(5, 6), 83);
  assert.equal(percent(0, 6), 0);
  assert.equal(percent(3, 0), 0);
  assert.equal(roundedMedian([12, 14, 21, 30, 42]), 21);
  assert.equal(roundedMedian([20, 25]), 23);
});

test('summaries are cut to 80 characters and counts get commas', () => {
  const cut = shorten('a'.repeat(81));
  assert.equal(cut.length, 80);
  assert.ok(cut.endsWith('…'));
  assert.equal(shorten('short'), 'short');
  assert.equal(shorten('a'.repeat(80)), 'a'.repeat(80));
  // Emoji are two UTF-16 units; a cut must never leave half of one.
  const emoji = shorten('😀'.repeat(81));
  assert.equal(Array.from(emoji).length, 80);
  assert.ok(emoji.isWellFormed(), 'cut an emoji in half');
  assert.equal(formatCount(5121), '5,121');
  assert.equal(formatCount(725), '725');
});
