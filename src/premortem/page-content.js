// The Confluence pre-mortem page (story 007): its title and its body, in ADF, in the structure of
// Atlassian's premortem template: Project overview; Brainstorm (what could go wrong, what could go
// right); Make a plan. "How this pre-mortem was made" takes the place of the template's Pre-work,
// which is meeting preparation (AC 9). Pure, so it is tested in Node; the caller passes only what
// the writer may see (story 002 AC 2).

import { counted, dayOf, formatDay } from '../engine/format.js';
import { cardParts, checkLines, comparisonParts } from '../frontend/text.js';
import { bulletList, heading, infoPanel, item, linkTo, paragraph, table, text } from './adf.js';
import { evidenceItem } from './task-content.js';
import { cut } from './validator.js';

const TITLE_CHARS = 255;
// Column widths in pixels, within Confluence's default page width of 760, so the reason and the
// action get room and short values (#, likelihood, key) don't take a sixth of the table each.
const WRONG_WIDTHS = [40, 220, 80, 140, 120, 160];
const PLAN_WIDTHS = [40, 280, 90, 130, 110, 110];
const day = (iso) => formatDay(dayOf(iso));

// AC 1: the page says where its reasons come from, in the panel's own words.
export const SOURCE_LINES = {
  agent: 'Reasons: written by the Forewarned agent in Rovo and checked against the evidence.',
  rule: 'Reasons: from your Jira history (rule-based, no AI).',
};

// AC 3 and 13: "Pre-mortem: ‹epic summary› (‹KEY›)", with the date added when the title is taken.
// Confluence allows 255 characters, so a long summary is cut at a word boundary.
export function pageTitle(summary, epicKey, datedOn = null) {
  const prefix = 'Pre-mortem: ';
  const suffix = ` (${epicKey})${datedOn ? ` (${datedOn})` : ''}`;
  return `${prefix}${cut(summary, TITLE_CHARS - prefix.length - suffix.length)}${suffix}`;
}

// AC 7: what went right, only from the evidence: comparable epics that finished on or before their
// due date, then the checks that found no risk. Nothing is invented, so the list may be empty.
export function successFactors(comparison, checks) {
  const onTime = (comparison?.epics ?? []).filter((e) => typeof e.daysLate === 'number' && e.daysLate <= 0).map((e) => ({
    key: e.key,
    url: e.url,
    text: `${e.key} ${e.summary} finished ${e.daysLate < 0 ? `${counted(-e.daysLate, 'day')} early` : 'on time'} (due ${day(e.due)})`,
  }));
  const clear = checkLines(checks).filter((line) => line.status === 'Clear').map((line) => ({ text: `${line.label}: ${line.note || 'No risk found.'}` }));
  return [...onTime, ...clear];
}

// A table cell holding one line of text, and one with nothing in it.
const cell = (value) => [paragraph(text(value))];
const EMPTY = [paragraph()];

// AC 5: the epic as a link, its status, due date and assignee, the panel's headline and the
// comparison set.
const overview = ({ epic, headline, comparison, space }) => [
  heading(2, 'Project overview'),
  paragraph(text('Epic: '), text(`${epic.key} ${epic.summary}`, linkTo(epic.url))),
  paragraph(text(`Status: ${epic.status}`)),
  paragraph(text(`Due date: ${epic.due ? day(epic.due) : 'No due date'}`)),
  paragraph(text(`Assignee: ${epic.assignee ?? 'Unassigned'}`)),
  paragraph(text(headline, [{ type: 'em' }])),
  paragraph(text(comparisonParts(comparison, space).line)),
];

// The evidence IDs a reason cites, then each of their work items as a link (never the epic).
function evidenceCell(reason, chips) {
  const ids = (reason.evidenceIds || []).join(', ');
  const content = ids ? [text(chips.length ? `${ids}: ` : ids)] : [];
  chips.forEach((chip, i) => {
    if (i) content.push(text(', '));
    content.push(text(chip.key, linkTo(chip.url)));
  });
  return [paragraph(...content)];
}

// AC 6: one row per reason; long text wraps inside its cell and is never cut.
function wrongRows({ reasons, evidence, epic }) {
  if (!reasons.length) return [paragraph(text('No failure reasons in this report. See how this pre-mortem was made below.'))];
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  return [table(['#', 'Reason', 'Likelihood', 'Base rate', 'Evidence', 'Mitigation'], reasons.map((reason, i) => {
    const parts = cardParts(reason, evidenceById, epic.key);
    const reasonCell = [paragraph(text(reason.title, [{ type: 'strong' }])), ...(parts.explanation ? [paragraph(text(parts.explanation))] : [])];
    return [cell(String(i + 1)), reasonCell, cell(reason.likelihood), cell(parts.baseRateLine), evidenceCell(reason, parts.chips), cell(reason.mitigation)];
  }), WRONG_WIDTHS)];
}

function rightItems({ comparison, checks }) {
  const factors = successFactors(comparison, checks);
  if (!factors.length) return [paragraph(text('No success patterns found in this history yet. Add your own.'))];
  return [bulletList(factors.map((f) => (f.key ? item(text(f.key, linkTo(f.url)), text(f.text.slice(f.key.length))) : item(text(f.text)))))];
}

// AC 8: one row per action item, with the task's owner, due date and status as Jira had them when
// the page was written.
function planRows({ plan }) {
  if (!plan.length) return [paragraph(text('No action items yet.'))];
  return [table(['#', 'Action', 'Task', 'Owner', 'Due date', 'Status'], plan.map(({ action, task }, i) => (task
    ? [cell(String(i + 1)), cell(action), [paragraph(text(task.key, linkTo(task.url)))], cell(task.owner ?? 'Unassigned'), cell(task.due ? day(task.due) : 'No due date'), cell(task.status)]
    : [cell(String(i + 1)), cell(action), cell('No task yet'), EMPTY, EMPTY, EMPTY])), PLAN_WIDTHS)];
}

// AC 9: the signals checked, with their notes, and every evidence item with its work item links.
const howMade = ({ space, checks, evidence, epic }) => [
  heading(2, 'How this pre-mortem was made'),
  paragraph(text(`Forewarned read finished epics in ${space} and this epic's work items, links and assignees, then checked four signals:`)),
  bulletList(checkLines(checks).map((line) => item(text(line.note ? `${line.label}: ${line.status}. ${line.note}` : `${line.label}: ${line.status}.`)))),
  ...(evidence.length ? [paragraph(text('Evidence:')), bulletList(evidence.map((e) => evidenceItem(e, epic.key)))] : []),
];

// The page body. `epic` = { key, url, summary, status, due, assignee } read from Jira as the writer;
// `plan` = [{ action, task: { key, url, owner, due, status } | null }]; `writtenOn` = "4 Nov 2026".
export function pageDoc(input) {
  return {
    type: 'doc',
    version: 1,
    content: [
      // AC 4 and AC 1: when and how the page was made.
      infoPanel(
        paragraph(text(`Created by Forewarned from Jira history on ${input.writtenOn}. Every reason links to its evidence in Jira.`)),
        paragraph(text(SOURCE_LINES[input.source])),
      ),
      ...overview(input),
      heading(2, 'Brainstorm'),
      heading(3, 'What could go wrong'),
      ...wrongRows(input),
      heading(3, 'What could go right'),
      ...rightItems(input),
      heading(2, 'Make a plan'),
      ...planRows(input),
      ...howMade(input),
    ],
  };
}
