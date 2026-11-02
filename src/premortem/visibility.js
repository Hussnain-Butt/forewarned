// Stored packs and reports for other readers (story 002 AC 2). A pack is built with the
// permissions of the user who ran it, but anyone who can view the epic reads it later. Before
// another user sees it, every work item it links is read again as that user; evidence naming one
// they can't see, and every reason citing such evidence, is left out of what they get.

import { readVisible } from '../engine/fetch.js';

const HIDDEN_NOTE = "Some evidence is hidden because it names work items you can't see.";

// The IDs of the pack's evidence items the reader can't fully see. The builder sees everything,
// so their reads cost no request.
export async function hiddenEvidenceIds(port, pack, readerAccountId) {
  if (!pack || !readerAccountId || readerAccountId === pack.builtFor) return new Set();
  const keys = [...new Set(pack.evidence.flatMap((item) => item.links.map((link) => link.key)))];
  const visible = new Set((await readVisible(port, keys, ['summary'])).map((issue) => issue.key));
  return new Set(pack.evidence.filter((item) => item.links.some((link) => !visible.has(link.key))).map((item) => item.id));
}

// The pack without the hidden evidence (IDs stay as they are, so reasons still match).
export function packForReader(pack, hidden) {
  if (!hidden.size) return pack;
  return { ...pack, evidence: pack.evidence.filter((item) => !hidden.has(item.id)), notes: [...pack.notes, HIDDEN_NOTE] };
}

// The report without the reasons that cite hidden evidence, rule-based or the agent's.
export function reportForReader(report, hidden) {
  if (!hidden.size || !report) return report;
  const visibleReasons = (reasons) => reasons.filter((reason) => !reason.evidenceIds.some((id) => hidden.has(id)));
  return {
    ...report,
    ruleBased: { ...report.ruleBased, reasons: visibleReasons(report.ruleBased.reasons) },
    agent: report.agent ? { ...report.agent, reasons: visibleReasons(report.agent.reasons) } : null,
    hiddenForReader: true,
  };
}
