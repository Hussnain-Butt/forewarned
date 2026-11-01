import api, { route } from '@forge/api';
import { forgeSenders } from '../engine/forge-jira.js';
import { buildEvidencePack } from '../engine/index.js';

// The Rovo agent reads the evidence pack and saves its reasons on the epic (spike M0a, story 002).
export const PREMORTEM_PROPERTY = 'forewarned-premortem';

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;
const MAX_REASONS = 5;
const MAX_TITLE_LENGTH = 120;
const MAX_EXPLANATION_LENGTH = 600;

// The agent fills epicKey from the chat, so check its shape and fall back to the work item in view.
const resolveEpicKey = (payload) => {
  const fromInput = typeof payload.epicKey === 'string' ? payload.epicKey.trim().toUpperCase() : '';
  if (ISSUE_KEY_PATTERN.test(fromInput)) {
    return fromInput;
  }
  const fromContext = payload.context?.jira?.issueKey;
  return typeof fromContext === 'string' && ISSUE_KEY_PATTERN.test(fromContext) ? fromContext : null;
};

// Story 002: the evidence engine builds the pack as the requesting user. The user's account ID
// comes from the function context, never from the agent's inputs (Rovo action guidance).
const buildPack = (epicKey, context) => buildEvidencePack({
  senders: forgeSenders(),
  epicKey,
  accountId: context?.principal?.accountId ?? null,
});

const errorMessage = (error) => (error instanceof Error ? error.message : 'Unknown error');

export async function getEvidence(payload, context) {
  const epicKey = resolveEpicKey(payload);
  if (!epicKey) {
    return { error: 'No valid epic key was given. Ask the user which epic to use, for example PLAT-1.' };
  }
  try {
    const { pack, error } = await buildPack(epicKey, context);
    return error ? { error } : { epicKey, ...pack };
  } catch (error) {
    console.error('getEvidence failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
}

// Spike M0e: an action reads the report back from the epic's entity property.
export async function getPremortem(payload) {
  const epicKey = resolveEpicKey(payload);
  if (!epicKey) {
    return { error: 'No valid epic key was given. Ask the user which epic to use, for example PLAT-1.' };
  }
  try {
    const response = await api
      .asUser()
      .requestJira(route`/rest/api/3/issue/${epicKey}/properties/${PREMORTEM_PROPERTY}`);
    if (response.status === 404) {
      return { epicKey, report: null, message: `No pre-mortem has been saved on ${epicKey} yet.` };
    }
    if (!response.ok) {
      throw new Error(`Reading the pre-mortem on ${epicKey} failed: ${response.status}`);
    }
    const { value } = await response.json();
    return { epicKey, report: value };
  } catch (error) {
    console.error('getPremortem failed:', errorMessage(error));
    return { error: errorMessage(error) };
  }
}

export async function submitPremortem(payload, context) {
  const epicKey = resolveEpicKey(payload);
  if (!epicKey) {
    return { saved: false, error: 'No valid epic key was given.' };
  }

  let proposed;
  try {
    proposed = JSON.parse(payload.reasonsJson);
  } catch {
    return { saved: false, error: 'reasonsJson is not valid JSON.' };
  }
  if (!Array.isArray(proposed)) {
    return { saved: false, error: 'reasonsJson must be a JSON array of reasons.' };
  }

  try {
    // Rebuild the evidence so a reason can only cite IDs that really exist for this epic.
    const { pack, error } = await buildPack(epicKey, context);
    if (error) {
      return { saved: false, error };
    }
    const validIds = new Set(pack.evidence.map((item) => item.id));

    const reasons = [];
    const dropped = [];
    for (const item of proposed) {
      const title = typeof item?.title === 'string' ? item.title.trim().slice(0, MAX_TITLE_LENGTH) : '';
      const explanation =
        typeof item?.explanation === 'string' ? item.explanation.trim().slice(0, MAX_EXPLANATION_LENGTH) : '';
      const evidenceIds = Array.isArray(item?.evidenceIds)
        ? [...new Set(item.evidenceIds.filter((id) => validIds.has(id)))]
        : [];
      if (!title || evidenceIds.length === 0 || reasons.length === MAX_REASONS) {
        dropped.push(title || '(untitled reason)');
        continue;
      }
      reasons.push({ title, explanation, evidenceIds });
    }

    if (reasons.length === 0) {
      return { saved: false, error: 'No reason cited valid evidence, so nothing was saved.', dropped };
    }

    const report = {
      version: 1,
      savedAt: new Date().toISOString(),
      source: 'rovo-agent',
      evidence: pack.evidence,
      reasons,
      droppedCount: dropped.length,
    };
    const response = await api
      .asUser()
      .requestJira(route`/rest/api/3/issue/${epicKey}/properties/${PREMORTEM_PROPERTY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
    if (!response.ok) {
      throw new Error(`Saving the pre-mortem on ${epicKey} failed: ${response.status}`);
    }
    return { saved: true, epicKey, savedReasons: reasons.length, dropped };
  } catch (error) {
    console.error('submitPremortem failed:', errorMessage(error));
    return { saved: false, error: errorMessage(error) };
  }
}
