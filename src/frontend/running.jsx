import React from 'react';
import { Icon, Inline, Spinner, Stack, Text } from '@forge/react';
import { stepLines } from './text.js';

// Story 005 AC 5–6: the run's named steps in order, the current one marked. Each state is also
// written in the icon's label, so it is not shown by icon alone.
export const RunSteps = ({ status, slow }) => (
  <Stack space="space.075">
    {stepLines(status).map(({ step, label, state }) => (
      <Inline key={step} space="space.100" alignBlock="center">
        {state === 'done' ? <Icon glyph="check-circle" label="Done" size="small" color="color.icon.success" /> : null}
        {state === 'current' ? <Spinner size="small" label="In progress" /> : null}
        {state === 'todo' ? <Icon glyph="check-circle-unchecked" label="Not started" size="small" color="color.icon.subtlest" /> : null}
        <Text color={state === 'todo' ? 'color.text.subtlest' : 'color.text'} weight={state === 'current' ? 'medium' : 'regular'}>
          {state === 'current' ? `${label}…` : label}
        </Text>
      </Inline>
    ))}
    {slow ? <Text color="color.text.subtle">This is taking longer than usual.</Text> : null}
  </Stack>
);
