// The validator (story 003 AC 9–18): no reason without evidence. Every reason, from Forewarned's
// rules or from the Rovo agent, passes through validateReasons before it is stored or shown. It
// checks only what can be checked mechanically: evidence IDs, numbers, work item keys and links.

const MAX_JSON_CHARS = 20000;
const MAX_INPUT_REASONS = 20;
const MAX_KEPT = 5;
const LIMITS = { title: 120, explanation: 600, mitigation: 200 };
const LIKELIHOODS = { high: 'High', medium: 'Medium', low: 'Low' };

const KEY = /\b[A-Z][A-Z0-9_]*-\d+\b/g;
const EVIDENCE_ID = /\bE\d+\b/g;
// A number not glued to a letter, digit or dot before it: "42", "5,121", "1.5", "86 %", and also
// "3x", "40days" or "10k" (a unit after it still leaves a quantity), but not "v2" or the ordinals
// "1st", "2nd", "3rd", "21st".
const NUMBER = /(?<![\w.])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?!\d)(?!(?:st|nd|rd|th)\b)(?:\s?%)?/g;
// Spelled-out numbers count too (open question 2); "one" is left out, it is too common in English.
const NUMBER_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const NUMBER_WORD = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'gi');
// Web addresses and markdown links. Saved write-ups reach other users and their agents, so like
// keys, a reason may hold one only when the epic summary or its cited evidence already does.
const LINK = /https?:\/\/[^\s)\]]+|www\.[^\s)\]]+|\]\([^)]*\)/gi;
const linksIn = (text) => [...String(text ?? '').matchAll(LINK)].map(([link]) => link.replace(/[.,;:!?]+$/, ''));

// The quantities in a text, normalized ("5,121" → "5121", "86 %" → "86"). Work item keys and
// evidence IDs are removed first, so "CHK-12" and "E3" are not numbers.
export function numbersIn(text) {
  const clean = String(text ?? '').replace(KEY, ' ').replace(EVIDENCE_ID, ' ');
  const found = new Set();
  for (const [match] of clean.matchAll(NUMBER)) found.add(match.replace(/[,\s%]/g, ''));
  for (const [, word] of clean.matchAll(NUMBER_WORD)) found.add(String(NUMBER_WORDS[word.toLowerCase()]));
  return found;
}

// The work item keys in a text, such as "PLT-31".
export const keysIn = (text) => new Set(String(text ?? '').match(KEY) ?? []);

// Parses the agent's reasonsJson into an array, or explains plainly why it can't (AC 9).
export function parseReasonsJson(text) {
  if (typeof text !== 'string') return { error: 'reasonsJson is not valid JSON.' };
  if (text.length > MAX_JSON_CHARS) return { error: 'reasonsJson is longer than 20,000 characters.' };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'reasonsJson is not valid JSON.' };
  }
  if (!Array.isArray(parsed)) return { error: 'reasonsJson must be a JSON array of reasons.' };
  if (parsed.length > MAX_INPUT_REASONS) return { error: 'reasonsJson has more than 20 reasons.' };
  return { reasons: parsed };
}

// Cuts text to max characters at a word boundary, ending with "…" (AC 10), so no number or key is
// split. The rules cut the epic summary with it too.
export function cut(text, max) {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  let kept = chars.slice(0, max - 1).join('');
  const space = kept.lastIndexOf(' ');
  if (space > 0) kept = kept.slice(0, space);
  return `${kept.trimEnd()}…`;
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

// Checks one reason; returns { reason } or { code } (the drop code).
function check(input, byId, epic, keep) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { code: 'not-an-object', title: '' };
  const title = cut(text(input.title), LIMITS.title);
  if (!title) return { code: 'missing-title', title };
  const likelihood = LIKELIHOODS[text(input.likelihood).toLowerCase()];
  if (!likelihood) return { code: 'missing-likelihood', title };
  const mitigation = cut(text(input.mitigation), LIMITS.mitigation);
  if (!mitigation) return { code: 'missing-mitigation', title };
  const explanation = cut(text(input.explanation), LIMITS.explanation);
  const written = `${title} ${explanation} ${mitigation}`;

  // AC 11: only IDs that exist, and at least one history item (team input never counts alone).
  const ids = Array.isArray(input.evidenceIds) ? input.evidenceIds.filter((id) => typeof id === 'string' && byId.has(id)) : [];
  const evidenceIds = [...new Set(ids)];
  const cited = evidenceIds.map((id) => byId.get(id));
  if (!cited.some((item) => item.source === 'history')) return { code: 'no-history-evidence', title };

  // AC 12–13: every number and key in the reason must come from what it cites. The epic itself
  // (its key and summary) is the subject of the whole pack, so it is always known.
  const sources = [epic?.summary, ...cited.flatMap((item) => [item.fact, ...(item.links ?? []).map((l) => l.summary)])];
  const knownNumbers = new Set(sources.flatMap((s) => [...numbersIn(s)]));
  if ([...numbersIn(written)].some((n) => !knownNumbers.has(n))) return { code: 'unknown-number', title };
  const knownKeys = new Set([epic?.key, ...keysIn(epic?.summary), ...cited.flatMap((item) => [...keysIn(item.fact), ...(item.links ?? []).map((l) => l.key)])]);
  if ([...keysIn(written)].some((k) => !knownKeys.has(k))) return { code: 'unknown-key', title };
  const knownText = sources.join(' ');
  if (linksIn(written).some((link) => !knownText.includes(link))) return { code: 'link', title };

  // AC 14: High needs a cited base rate.
  const capped = likelihood === 'High' && !cited.some((item) => item.baseRate) ? 'Medium' : likelihood;
  const reason = { title, likelihood: capped, explanation, evidenceIds, mitigation };
  for (const field of keep) if (input[field] !== undefined) reason[field] = input[field];
  return { reason };
}

// Validates reasons against the pack, keeping at most 5 in the order given (AC 15) and never
// adding any (AC 16). `keep` names extra fields to carry over; only Forewarned's own rule-based
// reasons use it, never the agent's input.
export function validateReasons(reasons, pack, { keep = [] } = {}) {
  const byId = new Map(pack.evidence.map((item) => [item.id, item]));
  const kept = [];
  const dropped = [];
  const titles = new Set();
  for (const input of reasons) {
    const result = check(input, byId, pack.epic, keep);
    let code = result.code;
    if (!code && titles.has(result.reason.title.toLowerCase())) code = 'duplicate';
    if (!code && kept.length === MAX_KEPT) code = 'over-five';
    if (code) {
      dropped.push({ title: result.title ?? result.reason.title, code });
    } else {
      kept.push(result.reason);
      titles.add(result.reason.title.toLowerCase());
    }
  }
  const droppedByRule = {};
  for (const { code } of dropped) droppedByRule[code] = (droppedByRule[code] ?? 0) + 1;
  return { kept, dropped, droppedByRule };
}
