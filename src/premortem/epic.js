// Reading the epic as the user, before anything stored about it is returned (story 003 AC 6): the
// stored pre-mortem is in Forge KVS, which Jira's permissions don't cover, so someone who can't see
// the epic learns nothing, not even whether a run is in progress.

// The work item's key and ID as Jira gives them, and whether it is an epic (hierarchy level 1), or
// null when it doesn't exist or the user can't see it.
export async function readEpic(port, epicKey) {
  try {
    const { key, id, fields } = await port.issue(epicKey, ['issuetype']);
    return { key, id, isEpic: fields?.issuetype?.hierarchyLevel === 1 };
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export const notVisible = (epicKey) => `${epicKey} doesn't exist, or you don't have permission to see it.`;
export const notAnEpic = (epicKey) => `${epicKey} is not an epic. Forewarned runs pre-mortems on epics only.`;
