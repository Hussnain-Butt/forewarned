import React from 'react';
import { Checkbox, Inline, Link, LinkButton, List, ListItem, LoadingButton, SectionMessage, SectionMessageAction, Stack, Text } from '@forge/react';
import { createLabel, creatingLine, taskResultParts } from './text.js';

// Story 006: tick the reasons to act on, create their tasks, and read what happened to each.

// AC 1, 8, 11: a reason with a task links to it; any other reason can be ticked.
export const TaskChoice = ({ reason, task, isChecked, canCreate, onToggle }) => (task ? (
  <Text>
    <Link href={task.url} openNewTab>{`Task ${task.key} created`}</Link>
  </Text>
) : (
  <Checkbox label="Create a task for this reason" isChecked={isChecked} isDisabled={!canCreate} onChange={() => onToggle(reason.fingerprint)} />
));

// AC 8, 12–13: the new keys as links (like the evidence chips, so they don't hide in the sentence),
// why a task isn't under the epic, and each failure in words (never colour alone), with Try again
// for the failed ones only.
const TaskResults = ({ results, onRetry }) => {
  const parts = taskResultParts(results);
  return (
    <SectionMessage
      appearance={parts.appearance}
      actions={parts.failures.length ? <SectionMessageAction onClick={onRetry}>Try again</SectionMessageAction> : undefined}
    >
      <Stack space="space.100">
        <Text>{parts.line}</Text>
        {parts.created.length ? (
          <Inline space="space.050" rowSpace="space.050" shouldWrap>
            {parts.created.map((task) => <LinkButton key={task.key} href={task.url} target="_blank" spacing="compact">{task.key}</LinkButton>)}
          </Inline>
        ) : null}
        {parts.notes.map((note) => <Text key={note}>{note}</Text>)}
        {parts.failures.length ? (
          <List type="unordered">
            {parts.failures.map((failure, i) => (
              <ListItem key={`${i}-${failure.title}`}>
                <Text>{failure.title ? `${failure.title}: ${failure.error}` : failure.error}</Text>
              </ListItem>
            ))}
          </List>
        ) : null}
      </Stack>
    </SectionMessage>
  );
};

// AC 2–4: the live count, the reason the button can't be used, and the outcome of the last create.
// `outcome` is { results } or { error } (nothing could be tried); `hasChoices` is false once every
// reason has its task.
export const TaskBar = ({ count, canCreate, space, creating, onCreate, notice, outcome, refreshFailed, onRetry, hasChoices }) => (
  <Stack space="space.100">
    {outcome?.results ? <TaskResults results={outcome.results} onRetry={onRetry} /> : null}
    {outcome?.error ? (
      <SectionMessage appearance="error" actions={<SectionMessageAction onClick={onRetry}>Try again</SectionMessageAction>}>
        <Text>{outcome.error}</Text>
      </SectionMessage>
    ) : null}
    {refreshFailed ? <Text color="color.text.subtle">Reload the page to see the new tasks in the child list.</Text> : null}
    {notice ? <Text color="color.text.subtle">The report was updated, so your selection was cleared.</Text> : null}
    {hasChoices ? (
      <Stack space="space.050">
        <Inline>
          <LoadingButton appearance="primary" isLoading={creating} isDisabled={creating || !count || !canCreate} onClick={onCreate}>
            {createLabel(count)}
          </LoadingButton>
        </Inline>
        {canCreate ? null : <Text color="color.text.subtle">{`You don't have permission to create work items in ${space}.`}</Text>}
        {canCreate && !count ? <Text color="color.text.subtle">Tick the reasons you want to act on.</Text> : null}
        {creating ? <Text color="color.text.subtle">{creatingLine(count)}</Text> : null}
      </Stack>
    ) : null}
  </Stack>
);
