// What a mitigation task holds (story 006): the reason's fingerprint, the task's summary and ADF
// description, and the work item type it is created as. Pure, so it is tested in Node.

import { dayOf, formatDay } from '../engine/format.js';
import { cardParts } from '../frontend/text.js';
import { cut } from './validator.js';

const SUMMARY_CHARS = 255;

const citedItems = (reason, evidenceById) => (reason.evidenceIds || []).map((id) => evidenceById.get(id)).filter(Boolean);

// What an evidence item is about, when that tells one reason from another: the blocker it names or
// the person whose load it is. Base rates, examples and people's other epics change as the space's
// history grows, so they don't count (M5 review).
const subjectOf = (item) => ({ 'open-blocker': item.about?.blocker, 'load-person': item.about?.name }[item.type] ?? null);

// AC 10: the rule ID (rule-based) or the normalized title (agent), plus the sorted subjects of its
// cited evidence, so the same reason in a later run finds its task even after more epics finish.
// Case and punctuation don't count, so an agent title reworded only in those still matches.
export function fingerprintOf(reason, evidenceById) {
  const subjects = [...new Set(citedItems(reason, evidenceById).map(subjectOf).filter(Boolean))].sort();
  const name = reason.ruleId
    ? `rule:${reason.ruleId}`
    : `agent:${String(reason.title ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;
  return `${name}|${subjects.join(',')}`;
}

// AC 6 and the markup edge case: the mitigation as one plain line, cut at a word boundary.
export function taskSummary(mitigation) {
  const plain = String(mitigation ?? '').replace(/<[^>]*>/g, '').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
  return cut(plain, SUMMARY_CHARS);
}

// ADF building blocks. Jira rejects empty text nodes, so callers pass only non-empty text.
const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content) => ({ type: 'paragraph', content });
const linkTo = (url) => [{ type: 'link', attrs: { href: url } }];

// One evidence line: "E2: ‹fact› (PLT-31, CHK-7)", each key a link to its work item.
function evidenceItem(item, epicKey) {
  const links = (item.links || []).filter((link, i, all) => link.key !== epicKey && all.findIndex((other) => other.key === link.key) === i);
  const content = [text(`${item.id}: ${item.fact}`)];
  if (links.length) {
    content.push(text(' ('));
    links.forEach((link, i) => {
      if (i) content.push(text(', '));
      content.push(text(link.key, linkTo(link.url)));
    });
    content.push(text(')'));
  }
  return { type: 'listItem', content: [paragraph(...content)] };
}

// AC 6: the reason title, likelihood, base-rate fact, explanation, the evidence as links to the
// work items, and the date of the pre-mortem.
export function taskDescription({ reason, evidenceById, epicKey, runAt }) {
  const { baseRateLine, explanation } = cardParts(reason, evidenceById, epicKey);
  const cited = citedItems(reason, evidenceById);
  const content = [
    paragraph(text(reason.title, [{ type: 'strong' }])),
    paragraph(text(`Likelihood: ${reason.likelihood}`)),
    paragraph(text(baseRateLine)),
  ];
  if (explanation) content.push(paragraph(text(explanation)));
  if (cited.length) content.push(paragraph(text('Evidence:')), { type: 'bulletList', content: cited.map((item) => evidenceItem(item, epicKey)) });
  content.push(paragraph(text(`Created from the Forewarned pre-mortem of ${formatDay(dayOf(runAt))}.`)));
  return { type: 'doc', version: 1, content };
}

// AC 5: "Task" when the space has it at hierarchy level 0, else the first other type at that level.
// Jira's create metadata lists only the types the user can create.
export function pickTaskType(issueTypes) {
  const candidates = (issueTypes || []).filter((type) => type.subtask !== true && type.hierarchyLevel === 0);
  const picked = candidates.find((type) => type.name === 'Task') ?? candidates[0];
  return picked ? { id: picked.id, name: picked.name } : null;
}
