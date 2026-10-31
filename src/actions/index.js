import api, { route } from '@forge/api';

// Spike M0a: the Rovo agent reads a small evidence pack and saves its reasons on the epic.
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

const countIssues = async (jql) => {
  const response = await api.asUser().requestJira(route`/rest/api/3/search/approximate-count`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql }),
  });
  if (!response.ok) {
    throw new Error(`Counting work items failed: ${response.status}`);
  }
  return (await response.json()).count;
};

const buildEvidence = async (epicKey) => {
  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${epicKey}?fields=summary,duedate,status,issuetype`);
  if (response.status === 404) {
    return { error: `${epicKey} doesn't exist, or you don't have permission to see it.` };
  }
  if (!response.ok) {
    throw new Error(`Reading ${epicKey} failed: ${response.status}`);
  }
  const { fields } = await response.json();
  if (fields.issuetype?.hierarchyLevel !== 1) {
    return { error: `${epicKey} is not an epic. Forewarned runs pre-mortems on epics only.` };
  }

  // epicKey matched ISSUE_KEY_PATTERN, so it is safe inside JQL.
  const [childCount, doneCount] = await Promise.all([
    countIssues(`parent = ${epicKey}`),
    countIssues(`parent = ${epicKey} AND statusCategory = Done`),
  ]);

  return {
    epicKey,
    summary: fields.summary,
    evidence: [
      {
        id: 'E1',
        type: 'due-date',
        fact: fields.duedate ? `The epic is due on ${fields.duedate}.` : 'The epic has no due date.',
      },
      {
        id: 'E2',
        type: 'scope',
        fact: `The epic has ${childCount} child work items, and ${doneCount} of them are done.`,
      },
      { id: 'E3', type: 'status', fact: `The epic's status is ${fields.status?.name}.` },
    ],
  };
};

const errorMessage = (error) => (error instanceof Error ? error.message : 'Unknown error');

export async function getEvidence(payload) {
  const epicKey = resolveEpicKey(payload);
  if (!epicKey) {
    return { error: 'No valid epic key was given. Ask the user which epic to use, for example PLAT-1.' };
  }
  try {
    return await buildEvidence(epicKey);
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

export async function submitPremortem(payload) {
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
    const pack = await buildEvidence(epicKey);
    if (pack.error) {
      return { saved: false, error: pack.error };
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
