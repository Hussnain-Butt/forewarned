// The Confluence pre-mortem page (story 007): the spaces where the user can create pages, and the
// page itself, written as the user from the report they may see, then updated on the next click.
// Jira and Confluence are reached through ports (createJira over senders), so tests use fakes. Only
// the HTTP status of a failed call is read, never its body, so no page content reaches the panel or
// the logs.

import { mapLimit, readVisible } from '../engine/fetch.js';
import { dayOf, formatDay } from '../engine/format.js';
import { CONFLUENCE_UNAVAILABLE, CONFLUENCE_UPGRADE, headline, sortByLikelihood } from '../frontend/text.js';
import { EPICS_ONLY, notVisible, readEpic } from './epic.js';
import { pageDoc, pageTitle } from './page-content.js';
import { readActions, readPage, readPremortem, writePage } from './store.js';
import { browseUrl, withFingerprints } from './tasks.js';
import { hiddenEvidenceIds, packForReader, reportForReader } from './visibility.js';

// AC 2: the picker lists at most 50 spaces.
const MAX_SPACES = 50;
const TASK_FIELDS = ['summary', 'assignee', 'duedate', 'status'];

const UNAVAILABLE = { error: CONFLUENCE_UNAVAILABLE, unavailable: true };
const NEEDS_UPDATE = { error: `${CONFLUENCE_UNAVAILABLE} ${CONFLUENCE_UPGRADE}`, unavailable: true };
const BUSY = 'Confluence is busy right now. Try again in a minute.';
const noPermission = (space) => `You can't create pages in ${space}. Pick another space or ask its admin.`;
const didNotConfirm = (space) => `Confluence didn't confirm the page. Check ${space} before you try again.`;

// Whether the app is installed in Confluence on this site, from the Forge app context (no request):
// true or false, or null when the runtime doesn't say (then Confluence's own answers decide).
export function installedInConfluence(appContext) {
  const contexts = appContext?.installation?.contexts;
  if (!Array.isArray(contexts)) return null;
  return contexts.some((context) => context?.resourceOwner === 'confluence' || String(context).startsWith('ari:cloud:confluence:'));
}

// The epic, read as the user first: someone who can't see it learns nothing (story 003 AC 6).
async function epicFor(port, epicKey) {
  const epic = await readEpic(port, epicKey);
  if (!epic) return { error: notVisible(epicKey) };
  if (!epic.isEpic) return { error: EPICS_ONLY };
  return { epic };
}

// A failed Confluence call in plain words (AC 15–17). `call` is 'read', 'create' or 'update'. After a
// create or update that got a 5xx or no answer the page may exist, so the user checks first.
function failure(error, call, space) {
  const status = error?.status;
  const changes = call === 'create' || call === 'update';
  if (status === undefined) {
    if (changes) return { error: didNotConfirm(space) };
    throw error;
  }
  if (status === 401) return NEEDS_UPDATE;
  if (status === 429) return { error: BUSY };
  if (call === 'update' && status === 409) return { error: 'Someone changed the page while Forewarned was writing it. Try again.' };
  if (status === 403 || status === 404) {
    return { error: call === 'update' ? `You can't edit the existing page in ${space}. Pick another space or ask its admin.` : noPermission(space) };
  }
  if (status >= 500) return { error: changes ? didNotConfirm(space) : BUSY };
  return { error: `Confluence couldn't save the page in ${space}. Try again, or pick another space.` };
}

// AC 2: the spaces where the user can create pages, by name, at most 50, and the space this epic's
// page was last written to as the default. Personal spaces are left out.
export async function listSpacesAction({ deps: { port, confluence, kvs, installed }, epicKey }) {
  const { epic, error } = await epicFor(port, epicKey);
  if (error) return { error };
  if (installed === false) return UNAVAILABLE;
  let listed;
  try {
    listed = await confluence.spaces();
  } catch (failed) {
    if (failed?.status === undefined) throw failed;
    if (failed.status === 401) return NEEDS_UPDATE;
    if (failed.status === 404) return UNAVAILABLE;
    if (failed.status === 403) return { error: "Confluence didn't let you list its spaces. Check that you can use Confluence, then try again." };
    if (failed.status === 429 || failed.status >= 500) return { error: BUSY };
    return { error: "Confluence couldn't list its spaces. Try again in a minute." };
  }
  const candidates = (listed?.results ?? []).filter((space) => space.type !== 'personal').slice(0, MAX_SPACES);
  // Each space's operations, 5 at a time; a space whose operations can't be read is left out.
  const creatable = await mapLimit(candidates, async (space) => {
    try {
      const operations = (await confluence.spaceOperations(space.id))?.operations ?? [];
      return operations.some((op) => op.operation === 'create' && op.targetType === 'page');
    } catch {
      return false;
    }
  });
  const spaces = candidates.filter((_, i) => creatable[i]).map(({ id, key, name }) => ({ id: String(id), key, name }));
  const stored = await readPage(kvs, epic.id);
  return { spaces, defaultSpaceId: spaces.some((space) => space.id === stored?.spaceId) ? stored.spaceId : null };
}

// AC 8: one row per reason on the page, with its task when the user can still read it, then every
// other task Forewarned created for this epic (for example from the other tab) that still exists.
// Owner, due date and status are read from Jira now, as the user.
async function planFor({ port, pack, reasons, actions }) {
  const mapped = Object.entries(actions.tasks);
  const issues = new Map((await readVisible(port, mapped.map(([, task]) => task.id), TASK_FIELDS)).map((issue) => [issue.id, issue]));
  const taskOf = (issue) => ({
    key: issue.key,
    url: browseUrl(pack, issue.key),
    owner: issue.fields?.assignee?.displayName ?? null,
    due: issue.fields?.duedate ?? null,
    status: issue.fields?.status?.name ?? 'Unknown',
  });
  const onPage = new Set(reasons.map((reason) => reason.fingerprint));
  const others = mapped.filter(([fingerprint]) => !onPage.has(fingerprint)).map(([, task]) => issues.get(task.id)).filter(Boolean);
  return [
    ...reasons.map((reason) => {
      const issue = issues.get(actions.tasks[reason.fingerprint]?.id);
      return { action: reason.mitigation, task: issue ? taskOf(issue) : null };
    }),
    ...others.map((issue) => ({ action: issue.fields?.summary ?? issue.key, task: taskOf(issue) })),
  ];
}

// AC 12: updates the stored page as a new version, keeping its title. Null when the page is gone
// (deleted, trashed or archived), so a new one is created.
async function updateStored({ confluence, page, body, space }) {
  let current;
  try {
    current = await confluence.page(page.id);
  } catch (error) {
    if (error?.status === 404) return null;
    return { failed: failure(error, 'read', space) };
  }
  if (current?.status !== 'current') return null;
  try {
    const saved = await confluence.updatePage(page.id, {
      id: page.id, status: 'current', title: current.title, body, version: { number: current.version.number + 1, message: 'Updated by Forewarned' },
    });
    return { saved: saved ?? current, title: current.title, updated: true, dated: false };
  } catch (error) {
    return { failed: failure(error, 'update', space) };
  }
}

// AC 3 and 13: creates the page; a title another page already has gets the date.
async function createNew({ confluence, spaceId, summary, epicKey, writtenOn, body, space }) {
  try {
    const taken = async (title) => ((await confluence.pagesByTitle(spaceId, title))?.results ?? []).length > 0;
    let title = pageTitle(summary, epicKey);
    let dated = false;
    if (await taken(title)) {
      title = pageTitle(summary, epicKey, writtenOn);
      dated = true;
      if (await taken(title)) return { failed: { error: `${space} already has a page called "${title}". Rename that page, or pick another space.` } };
    }
    try {
      return { saved: await confluence.createPage({ spaceId, status: 'current', title, body }), title, updated: false, dated };
    } catch (error) {
      return { failed: failure(error, 'create', space) };
    }
  } catch (error) {
    return { failed: failure(error, 'read', space) };
  }
}

// Writes the epic's pre-mortem page in the chosen space, as the user (AC 1–13). Returns { page,
// updated, dated, source } or { error } ({ error, unavailable: true } without Confluence).
export async function writePageAction({ deps: { port, confluence, kvs, now, installed }, epicKey, accountId, spaceId }) {
  if (typeof spaceId !== 'string' || !/^\d{1,20}$/.test(spaceId)) return { error: 'Choose a Confluence space first.' };
  const { epic, error } = await epicFor(port, epicKey);
  if (error) return { error };
  const stored = await readPremortem(kvs, epic.id);
  if (!stored) return { error: 'Run the pre-mortem first.' };
  if (installed === false) return UNAVAILABLE;

  const { pack } = stored;
  const readSpace = confluence.space(spaceId).then((space) => ({ space }), (failed) => ({ failed: failure(failed, 'read', 'this space') }));
  const [live, hidden, seenEpics, page, actions, chosen] = await Promise.all([
    port.issue(epic.key, ['summary', 'status', 'duedate', 'assignee']),
    hiddenEvidenceIds(port, pack),
    readVisible(port, (pack.comparison?.epics ?? []).map((e) => e.key), ['summary']),
    readPage(kvs, epic.id),
    readActions(kvs, epic.id),
    readSpace,
  ]);
  if (chosen.failed) return chosen.failed;
  const spaceName = chosen.space.name ?? chosen.space.key ?? 'this space';

  // Only what this user may see goes on the page (story 002 AC 2), and the agent write-up only when
  // it was written on the current evidence and has reasons for them (AC 1).
  const report = withFingerprints(reportForReader(stored.report, hidden), pack);
  const agent = report.agent && !report.agent.stale && report.agent.reasons.length ? report.agent : null;
  const reasons = agent ? sortByLikelihood(agent.reasons) : report.ruleBased.reasons;
  const seen = new Set(seenEpics.map((issue) => issue.key));
  const comparison = pack.comparison && { ...pack.comparison, epics: pack.comparison.epics.filter((e) => seen.has(e.key)) };
  const writtenOn = formatDay(dayOf(now()));
  const summary = live?.fields?.summary ?? pack.epic.summary;
  const doc = pageDoc({
    epic: {
      key: epic.key,
      url: browseUrl(pack, epic.key),
      summary,
      status: live?.fields?.status?.name ?? 'Unknown',
      due: live?.fields?.duedate ?? null,
      assignee: live?.fields?.assignee?.displayName ?? null,
    },
    headline: headline({ summary: pack.epic.summary, due: pack.epic.due, today: new Date(now()) }).text,
    comparison,
    space: epic.project.key,
    source: agent ? 'agent' : 'rule',
    reasons,
    evidence: packForReader(pack, hidden).evidence,
    plan: await planFor({ port, pack, reasons, actions }),
    checks: pack.checks,
    writtenOn,
  });
  const body = { representation: 'atlas_doc_format', value: JSON.stringify(doc) };

  // AC 12: the stored page in the same space is updated; in another space, or gone, a new one is made.
  const sameSpace = page && page.spaceId === spaceId;
  const result = (sameSpace && await updateStored({ confluence, page, body, space: spaceName }))
    || await createNew({ confluence, spaceId, summary, epicKey: epic.key, writtenOn, body, space: spaceName });
  if (result.failed) return result.failed;

  const links = result.saved?._links;
  const site = pack.epic.url.slice(0, pack.epic.url.indexOf('/browse/'));
  const url = links?.webui ? `${links.base ?? `${site}/wiki`}${links.webui}` : page?.url;
  const record = { id: String(result.saved.id), spaceId, spaceName, title: result.title, url, by: accountId, at: new Date(now()).toISOString() };
  await writePage(kvs, epic.id, record);
  return {
    page: { id: record.id, url, title: record.title, spaceId, spaceName },
    updated: result.updated,
    dated: result.dated,
    source: agent ? 'agent' : 'rule',
  };
}
