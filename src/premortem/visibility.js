// Stored packs and reports for other readers (story 002 AC 2). A pack is built with the
// permissions of the user who ran it, but anyone who can view the epic reads it later. Before
// another user sees it, every work item it links is read again as that user; evidence naming one
// they can't see, and every reason citing such evidence, is left out of what they get.

import { readVisible } from '../engine/fetch.js';

const HIDDEN_NOTE = "Some evidence is hidden because it names work items you can't see.";

// The IDs of the pack's evidence items the user in session (the port's user) can't fully see. The
// builder is checked too, because access can be taken away after a run.
export async function hiddenEvidenceIds(port, pack) {
  if (!pack) return new Set();
  const keys = [...new Set(pack.evidence.flatMap((item) => item.links.map((link) => link.key)))];
  const visible = new Set((await readVisible(port, keys, ['summary'])).map((issue) => issue.key));
  return new Set(pack.evidence.filter((item) => item.links.some((link) => !visible.has(link.key))).map((item) => item.id));
}

// The pack without the hidden evidence (IDs stay as they are, so reasons still match).
export function packForReader(pack, hidden) {
  if (!hidden.size) return pack;
  return { ...pack, evidence: pack.evidence.filter((item) => !hidden.has(item.id)), notes: [...pack.notes, HIDDEN_NOTE] };
}

// The report without the reasons that cite hidden evidence, rule-based or the agent's. An agent
// write-up from an older pack cites that pack's evidence IDs, which the stored pack numbers
// differently, so it can't be checked for anyone: no reader gets its reasons, the builder included.
export function reportForReader(report, hidden) {
  if (!report) return report;
  const visibleReasons = (reasons) => reasons.filter((reason) => !reason.evidenceIds.some((id) => hidden.has(id)));
  const agent = report.agent && (report.agent.packId === report.packId ? report.agent : { ...report.agent, reasons: [], stale: true });
  const ruleReasons = visibleReasons(report.ruleBased.reasons);
  const agentReasons = agent ? visibleReasons(agent.reasons) : [];
  const shown = {
    ...report,
    ruleBased: { ...report.ruleBased, reasons: ruleReasons },
    agent: agent && { ...agent, reasons: agentReasons },
  };
  const removed = ruleReasons.length < report.ruleBased.reasons.length || agentReasons.length < (agent?.reasons.length ?? 0);
  return removed ? { ...shown, hiddenForReader: true } : shown;
}
