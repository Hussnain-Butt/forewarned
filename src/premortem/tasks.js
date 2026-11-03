// Mitigation tasks (story 006): the panel sends the fingerprints of the reasons the user ticked, and
// Forewarned creates one work item per reason, as the user, under the epic. Every task's text comes
// from the stored report after the reader filter (story 002 AC 2), never from the panel, and each
// new task is saved the moment Jira returns its key, so asking again never creates it twice.

import { readVisible } from '../engine/fetch.js';
import { EPICS_ONLY, notVisible, readEpic } from './epic.js';
import { readActions, readPremortem, releaseTasksLock, takeTasksLock, writeActions } from './store.js';
import { fingerprintOf, pickTaskType, taskDescription, taskSummary } from './task-content.js';
import { hiddenEvidenceIds, reportForReader } from './visibility.js';

const MAX_CHOSEN = 10;
const MAX_FINGERPRINT_CHARS = 500;
// A create takes about a second; one that can't finish before the resolver's time runs out isn't started.
const MIN_TIME_LEFT_MS = 3000;
// The fields Forewarned sets (or Jira fills in); any other required field without a default stops the create (AC 12).
const SET_FIELDS = new Set(['summary', 'issuetype', 'project', 'parent', 'description', 'labels', 'reporter']);

const STALE = "This reason isn't in the latest report any more.";
const OUT_OF_TIME = 'Forewarned ran out of time before this one. Try again.';
const JIRA_BUSY = 'Jira is busy right now. Try again in a minute.';
const UNCONFIRMED = "Jira didn't confirm this work item. Check the epic's child work items before you try again.";
const noPermission = (space) => `You don't have permission to create work items in ${space}.`;
const noType = (space) => `${space} has no work item type that can go under an epic. Create this one in Jira instead.`;
const requiredField = (space, name) => `${space} requires the field '${name}' to create a work item. Create this one in Jira instead.`;
const couldNotCreate = (space) => `Jira couldn't create this work item in ${space}. Create this one in Jira instead.`;

// The report with each reason's fingerprint (AC 10), from the run's full evidence (the reader's
// copy has no evidence types).
export function withFingerprints(report, pack) {
  const evidenceById = new Map(pack.evidence.map((item) => [item.id, item]));
  const mark = (reasons) => reasons.map((reason) => ({ ...reason, fingerprint: fingerprintOf(reason, evidenceById) }));
  return {
    ...report,
    ruleBased: { ...report.ruleBased, reasons: mark(report.ruleBased.reasons) },
    agent: report.agent && { ...report.agent, reasons: mark(report.agent.reasons) },
  };
}

// A work item's address on the site the pack was built on.
export const browseUrl = (pack, key) => `${pack.epic.url.slice(0, pack.epic.url.indexOf('/browse/'))}/browse/${key}`;

// The reasons the user in session sees, rule-based first, each with its fingerprint. A stale agent
// write-up has no reasons for any reader (reportForReader).
export async function readerReasons({ port, pack, report }) {
  const shown = withFingerprints(reportForReader(report, await hiddenEvidenceIds(port, pack)), pack);
  return [...shown.ruleBased.reasons, ...(shown.agent?.reasons ?? [])];
}

const validFingerprints = (fingerprints) => Array.isArray(fingerprints) && fingerprints.length >= 1 && fingerprints.length <= MAX_CHOSEN
  && fingerprints.every((fp) => typeof fp === 'string' && fp.length <= MAX_FINGERPRINT_CHARS);

// A failed create in plain words (AC 12). The port has already retried a 429 once. Only a 4xx
// means Jira refused it; after a 5xx or no answer the work item may exist, so the user checks
// before trying again (AC 13: never twice).
function createError(error, space) {
  if (error.status === 401 || error.status === 403) return noPermission(space);
  if (error.status === 429) return JIRA_BUSY;
  if (error.status >= 400 && error.status < 500) return couldNotCreate(space);
  return UNCONFIRMED;
}

// Returns { results } with one TaskResult per fingerprint, in the order given (duplicates once), or
// { error } when nothing could be tried. TaskResult: { fingerprint, title, key?, url?, asChild?,
// linked?, existed?, error? }. `deps.deadline` is when the resolver's time budget ends.
export async function createTasksAction({ deps, epicKey: requestedKey, accountId, fingerprints }) {
  if (!validFingerprints(fingerprints)) return { error: 'No reasons were chosen.' };
  const epic = await readEpic(deps.port, requestedKey);
  if (!epic) return { error: notVisible(requestedKey) };
  if (!epic.isEpic) return { error: EPICS_ONLY };
  const stored = await readPremortem(deps.kvs, epic.id);
  if (!stored) return { error: 'Run the pre-mortem first.' };
  if (!(await takeTasksLock(deps.kvs, epic.id, deps.now()))) {
    return { error: 'Forewarned is already creating tasks for this epic. Wait a moment, then try again.' };
  }
  try {
    return { results: await createAll({ deps, epic, stored, accountId, fingerprints: [...new Set(fingerprints)] }) };
  } finally {
    // The lock expires on its own after 60 s, so a failed release only delays the next create.
    await releaseTasksLock(deps.kvs, epic.id).catch(() => {});
  }
}

async function createAll({ deps: { port, kvs, now, deadline }, epic, stored, accountId, fingerprints }) {
  const { pack, report } = stored;
  const [reasons, actions, permissions] = await Promise.all([
    readerReasons({ port, pack, report }),
    readActions(kvs, epic.id),
    port.myPermissions(epic.key),
  ]);
  const space = epic.project.key;
  const urlOf = (key) => browseUrl(pack, key);
  const byFingerprint = new Map(reasons.map((reason) => [reason.fingerprint, reason]));

  // A task the user can no longer read was deleted (or hidden from them); its reason can be ticked
  // again (AC 11). Jira answers the same for both, like story 005's evidence.
  const mapped = fingerprints.map((fp) => actions.tasks[fp]).filter(Boolean);
  const current = new Map((await readVisible(port, mapped.map((task) => task.id), ['summary'])).map((issue) => [issue.id, issue.key]));

  const results = new Map();
  const toCreate = [];
  for (const fingerprint of fingerprints) {
    const reason = byFingerprint.get(fingerprint);
    const task = actions.tasks[fingerprint];
    if (!reason) results.set(fingerprint, { fingerprint, title: null, error: STALE });
    else if (task && current.has(task.id)) {
      const key = current.get(task.id);
      results.set(fingerprint, { fingerprint, title: reason.title, key, url: urlOf(key), asChild: task.asChild, existed: true });
    } else toCreate.push(reason);
  }
  const failAll = (error) => toCreate.forEach((reason) => results.set(reason.fingerprint, { fingerprint: reason.fingerprint, title: reason.title, error }));

  if (toCreate.length) {
    const plan = permissions.permissions?.CREATE_ISSUES?.havePermission ? await createPlan(port, space) : { error: noPermission(space) };
    if (plan.error) failAll(plan.error);
    else {
      const evidenceById = new Map(pack.evidence.map((item) => [item.id, item]));
      for (const reason of toCreate) {
        const { fingerprint, title } = reason;
        if (deadline - now() < MIN_TIME_LEFT_MS) {
          results.set(fingerprint, { fingerprint, title, error: OUT_OF_TIME });
          continue;
        }
        let created;
        try {
          created = await port.createIssue({
            project: { key: space },
            issuetype: { id: plan.type.id },
            summary: taskSummary(reason.mitigation),
            description: taskDescription({ reason, evidenceById, epicKey: pack.epic.key, runAt: report.runAt }),
            labels: ['pre-mortem'],
            ...(plan.asChild ? { parent: { key: epic.key } } : {}),
          });
        } catch (error) {
          results.set(fingerprint, { fingerprint, title, error: createError(error, space) });
          continue;
        }
        // Saved before anything else, so a later failure or timeout never leads to a second task (AC 13).
        actions.tasks[fingerprint] = { id: created.id, key: created.key, asChild: plan.asChild, createdAt: new Date(now()).toISOString(), createdBy: accountId };
        await writeActions(kvs, epic.id, actions);
        const result = { fingerprint, title, key: created.key, url: urlOf(created.key), asChild: plan.asChild };
        if (!plan.asChild) result.linked = await linkToEpic(port, plan.relates, created.key, epic.key);
        results.set(fingerprint, result);
      }
    }
  }

  const ordered = fingerprints.map((fp) => results.get(fp));
  actions.lastBatch = { by: accountId, at: new Date(now()).toISOString(), results: ordered };
  await writeActions(kvs, epic.id, actions);
  return ordered;
}

// What every task in this space is created as (AC 5): the type, whether it can be the epic's child,
// and the "relates to" link type for when it can't. { error } when no task can be created here.
async function createPlan(port, space) {
  const type = pickTaskType((await port.createMetaTypes(space))?.issueTypes);
  if (!type) return { error: noType(space) };
  const page = await port.createMetaFields(space, type.id);
  const fields = page?.fields ?? page?.results ?? [];
  const missing = fields.find((field) => field.required && !field.hasDefaultValue && !SET_FIELDS.has(field.fieldId));
  if (missing) return { error: requiredField(space, missing.name) };
  const asChild = fields.some((field) => field.fieldId === 'parent');
  const relates = asChild ? null : ((await port.linkTypes())?.issueLinkTypes ?? []).find((linkType) => linkType.outward === 'relates to') ?? null;
  return { type, asChild, relates };
}

// AC 5 fallback: links the task to the epic with "relates to"; false when that isn't possible.
async function linkToEpic(port, relates, taskKey, epicKey) {
  if (!relates) return false;
  try {
    await port.createLink({ type: { name: relates.name }, inwardIssue: { key: taskKey }, outwardIssue: { key: epicKey } });
    return true;
  } catch {
    return false;
  }
}
