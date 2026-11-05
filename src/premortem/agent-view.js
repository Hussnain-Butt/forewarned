// What the Forewarned agent reads about a saved pre-mortem (story 008 AC 4, 10–11): the reasons
// numbered exactly as the panel numbers them, so "reason 2" means the same in chat and in the
// panel, and the facts they cite. Pure; it works on a report and a pack already filtered for the
// reader (visibility.js).

import { sortByLikelihood } from '../frontend/text.js';

const numbered = (reasons) => reasons.map(({ title, likelihood, explanation, evidenceIds, mitigation }, i) => (
  { number: i + 1, title, likelihood, explanation, evidenceIds, mitigation }));

// Both lists as the panel shows them: the agent's write-up High before Medium before Low, the
// rule-based reasons in their stored order. The panel (and the Confluence page) opens on the
// agent's write-up when it is on the current evidence and has reasons for this reader.
export function readerLists(report) {
  const agentStale = Boolean(report.agent?.stale);
  const agent = report.agent ? numbered(agentStale ? [] : sortByLikelihood(report.agent.reasons)) : null;
  return {
    shownFirst: agent?.length ? 'agent' : 'rule-based',
    agent,
    agentStale,
    ruleBased: numbered(report.ruleBased.reasons),
  };
}

// The pack's evidence items that the reasons cite, in pack order, with what the agent quotes and
// links.
export function citedEvidence(pack, reasons) {
  const cited = new Set(reasons.flatMap((reason) => reason.evidenceIds));
  return pack.evidence.filter((item) => cited.has(item.id)).map(({ id, fact, baseRate, links }) => ({ id, fact, baseRate, links }));
}
