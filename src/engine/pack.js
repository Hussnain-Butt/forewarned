// The evidence pack (story 002 AC 26–31): every signal's facts, numbered E1…En, with links, the
// comparison set and the checks, kept within 25 items and 24,000 bytes so it fits in a Jira
// entity property (limit 32,768 bytes, proven in M0f).

import { createHash } from 'node:crypto';
import { selectComparable } from './comparable.js';
import { dependencySignal } from './dependencies.js';
import { isoDay, shorten } from './format.js';
import { loadSignal } from './load.js';
import { scopeSignal } from './scope.js';
import { slipSignal } from './slip.js';

export const MAX_ITEMS = 25;
export const MAX_BYTES = 24000;
// index.js adds builtAt later; its value always has this length, so the size check counts it now.
const BUILT_AT_PLACEHOLDER = '0000-00-00T00:00:00.000Z';

const byteSize = (pack) => Buffer.byteLength(JSON.stringify({ ...pack, builtAt: BUILT_AT_PLACEHOLDER }), 'utf8');

// Builds the pack from a Snapshot. Pure: the same Snapshot always gives the same pack (AC 31).
export function computePack(snapshot) {
  const { epic, siteUrl } = snapshot;
  const url = (key) => `${siteUrl}/browse/${key}`;
  const comparison = selectComparable(epic, snapshot.candidates, snapshot.today);
  const results = {
    slip: slipSignal(snapshot, comparison),
    scope: scopeSignal(snapshot, comparison),
    load: loadSignal(snapshot),
    dependencies: dependencySignal(snapshot, comparison),
  };
  const groups = Object.values(results).map((r) => [...r.drafts]);

  const build = (dropped) => ({
    version: 1,
    packId: '',
    builtFor: snapshot.builtFor,
    epic: { key: epic.key, summary: epic.summary, url: url(epic.key), due: epic.due === null ? null : isoDay(epic.due), start: isoDay(epic.start), statusCategory: epic.statusCategory },
    comparison: {
      rule: comparison.rule,
      epics: comparison.epics.map((e) => ({
        key: e.key,
        summary: shorten(e.summary),
        url: url(e.key),
        due: e.due === null ? null : isoDay(e.due),
        finish: isoDay(e.finish),
        daysLate: e.due === null ? null : e.finish - e.due,
        durationDays: e.finish - e.start,
      })),
    },
    checks: Object.fromEntries(Object.entries(results).map(([signal, r]) => [signal, r.check])),
    evidence: groups.flat().map((d, i) => ({
      id: `E${i + 1}`,
      type: d.type,
      signal: d.signal,
      source: 'history',
      fact: d.fact,
      links: d.links.map((l) => ({ key: l.key, summary: shorten(l.summary), url: url(l.key) })),
      baseRate: d.baseRate,
      numbers: d.numbers,
      ...(d.about ? { about: d.about } : {}),
    })),
    notes: dropped
      ? [...snapshot.notes, `Dropped ${dropped} weaker evidence items to keep the pack within ${MAX_ITEMS} items and 24,000 bytes.`]
      : [...snapshot.notes],
  });

  // AC 30: drop the last (weakest) item of the signal with the most items until the pack fits.
  // Ties go to the later signal, so slip patterns, the strongest base rates, survive longest.
  let dropped = 0;
  let pack = build(dropped);
  while (pack.evidence.length > MAX_ITEMS || byteSize(pack) > MAX_BYTES) {
    let target = -1;
    groups.forEach((g, i) => { if (g.length && (target < 0 || g.length >= groups[target].length)) target = i; });
    if (target < 0) throw new Error('The evidence pack is too large even without evidence items.');
    groups[target].pop();
    dropped += 1;
    pack = build(dropped);
  }

  // The packId is a hash of the pack's content, so any change in the data changes it. Who built it
  // is left out: teammates looking at the same data get the same packId (AC 31).
  const { builtFor, ...content } = pack;
  pack.packId = createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16);
  return pack;
}
