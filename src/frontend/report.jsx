import React, { useState } from 'react';
import {
  Box, Button, Heading, Inline, Link, LinkButton, List, ListItem, Lozenge, SectionMessage, Stack, Tab, TabList, TabPanel, Tabs,
  Text, Tooltip, User, xcss,
} from '@forge/react';
import { dayOf, formatDay } from '../engine/format.js';
import {
  cardParts, checkLines, comparisonParts, droppedLine, exactTime, headline, historyLine, isOld, likelihoodLozenge,
  relativeTime, sortByLikelihood,
} from './text.js';

// Story 005 AC 8–16 and 22–23, 27: the stored report as the reader may see it.

const MAX_REASONS = 5;
const CHIPS_SHOWN = 4;

const cardStyle = xcss({
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'radius.small',
  padding: 'space.200',
});

const spaceOf = (key) => key.replace(/-\d+$/, '');

// One reason (AC 9–11): number, title, likelihood in words, base rate, explanation, chips that
// open in a new tab, the cited facts on request, and the mitigation.
const ReasonCard = ({ number, reason, evidenceById, epicKey }) => {
  const [allChips, setAllChips] = useState(false);
  const [showFacts, setShowFacts] = useState(false);
  const parts = cardParts(reason, evidenceById, epicKey);
  const lozenge = likelihoodLozenge(reason.likelihood);
  const chips = allChips ? parts.chips : parts.chips.slice(0, CHIPS_SHOWN);
  const hiddenChips = parts.chips.length - chips.length;
  return (
    <Box xcss={cardStyle}>
      <Stack space="space.100">
        <Heading size="small">{`${number}. ${reason.title}`}</Heading>
        <Inline>
          <Lozenge appearance={lozenge.appearance}>{lozenge.text}</Lozenge>
        </Inline>
        <Text size="small" color="color.text.subtle">{parts.baseRateLine}</Text>
        {parts.explanation ? <Text>{parts.explanation}</Text> : null}
        {chips.length ? (
          <Inline space="space.050" rowSpace="space.050" shouldWrap alignBlock="center">
            {chips.map((chip) => (
              <Tooltip key={chip.key} content={chip.name}>
                <LinkButton href={chip.url} target="_blank" spacing="compact">{chip.label}</LinkButton>
              </Tooltip>
            ))}
            {hiddenChips ? (
              <Button appearance="subtle" spacing="compact" onClick={() => setAllChips(true)}>{`Show ${hiddenChips} more`}</Button>
            ) : null}
          </Inline>
        ) : null}
        <Inline>
          <Button appearance="subtle" spacing="compact" onClick={() => setShowFacts(!showFacts)}>
            {showFacts ? 'Hide evidence' : 'Show evidence'}
          </Button>
        </Inline>
        {showFacts ? (
          <Stack space="space.050">
            {parts.facts.map((item) => <Text key={item.id} size="small">{`${item.id}: ${item.fact}`}</Text>)}
          </Stack>
        ) : null}
        <Text>{`Suggested mitigation: ${reason.mitigation}`}</Text>
      </Stack>
    </Box>
  );
};

// A ranked list of reasons with its source label (AC 12, 15).
const ReasonList =({ label, reasons, evidenceById, epicKey }) => (
  <Stack space="space.150">
    <Text size="small" weight="medium" color="color.text.subtle">{label}</Text>
    {(reasons || []).map((reason, i) => (
      <ReasonCard key={`${i}-${reason.title}`} number={i + 1} reason={reason} evidenceById={evidenceById} epicKey={epicKey} />
    ))}
    {reasons?.length && reasons.length < MAX_REASONS ? <Text color="color.text.subtle">Not enough evidence for more reasons.</Text> : null}
  </Stack>
);

// What Forewarned checked, for the insufficient-history and no-signals states (AC 22–23).
const Checks = ({ intro, checks }) => (
  <SectionMessage appearance="information">
    <Stack space="space.100">
      <Text>{intro}</Text>
      <List type="unordered">
        {checkLines(checks).map((c) => (
          <ListItem key={c.label}>
            <Text>{c.note ? `${c.label}: ${c.status}. ${c.note}` : `${c.label}: ${c.status}.`}</Text>
          </ListItem>
        ))}
      </List>
    </Stack>
  </SectionMessage>
);

// The comparison set, expandable (AC 13). Not shown without epics: the history line says so.
const ComparisonSet = ({ comparison, space }) => {
  const [open, setOpen] = useState(false);
  const parts = comparisonParts(comparison, space);
  const one = parts.rows.length === 1;
  return (
    <Stack space="space.050">
      <Text size="small" color="color.text.subtle">{parts.line}</Text>
      <Inline>
        <Button appearance="subtle" spacing="compact" onClick={() => setOpen(!open)}>
          {open ? `Hide the ${one ? 'epic' : 'epics'}` : `Show the ${one ? 'epic' : `${parts.rows.length} epics`}`}
        </Button>
      </Inline>
      {open ? (
        <List type="unordered">
          {parts.rows.map((row) => (
            <ListItem key={row.key}>
              <Text>
                <Link href={row.url} openNewTab>{row.label}</Link>
                {`: ${row.detail}`}
              </Text>
            </ListItem>
          ))}
        </List>
      ) : null}
    </Stack>
  );
};

// Who ran it and when (AC 14); the exact time is in the text, so screen readers get it too. The
// user sits inside the text, so the name wraps with it instead of dropping to its own line.
const RunInfo = ({ report, now }) => (
  <Text size="small" color="color.text.subtle">
    {`Last run ${relativeTime(report.runAt, now)} (${exactTime(report.runAt)}) by `}
    <User accountId={report.runBy} />
  </Text>
);

// The agent's write-up (AC 20–21): only when it was written on this evidence run, in likelihood
// order, with the drop count.
const AgentWriteUp = ({ agent, evidenceById, epicKey }) => {
  if (agent.stale) {
    return (
      <SectionMessage appearance="information">
        <Text>The agent&apos;s write-up is based on an earlier run. Ask the agent again to update it.</Text>
      </SectionMessage>
    );
  }
  const dropped = droppedLine(agent);
  return (
    <Stack space="space.100">
      <ReasonList label="Written by the Forewarned agent in Rovo and checked against the evidence" reasons={sortByLikelihood(agent.reasons)} evidenceById={evidenceById} epicKey={epicKey} />
      {dropped ? <Text size="small" color="color.text.subtle">{dropped}</Text> : null}
    </Stack>
  );
};

// The headline, the notes, the reasons (in two tabs once the agent has written), the comparison
// set and who ran it. `tab` is 0 for the agent's write-up and 1 for the rule-based list.
export const Report = ({ panel, now, tab, onTabChange }) => {
  const { report, epic, comparison, issueKey } = panel;
  const space = spaceOf(issueKey);
  const evidenceById = new Map((panel.evidence || []).map((item) => [item.id, item]));
  const head = headline({ summary: epic.summary, due: epic.due, today: new Date(now) });
  return (
    <Stack space="space.200">
      <Stack space="space.050">
        <Heading size="medium">{head.text}</Heading>
        {head.note ? <Text size="small" color="color.text.subtle">{head.note}</Text> : null}
      </Stack>
      {isOld(report.runAt, now) ? (
        <SectionMessage appearance="information">{`This report is from ${formatDay(dayOf(report.runAt))}. Re-run to include changes since then.`}</SectionMessage>
      ) : null}
      {report.hiddenForReader ? (
        <SectionMessage appearance="information">Some reasons are hidden because they name work items you can&apos;t see.</SectionMessage>
      ) : null}
      {report.status === 'insufficient-history' ? <Checks intro={historyLine((comparison?.epics || []).length, space)} checks={report.checks} /> : null}
      {report.status === 'no-signals' ? (
        <Checks intro="No strong risk signals found in this history. Here is what Forewarned checked." checks={report.checks} />
      ) : null}
      {report.agent ? (
        <Tabs id="forewarned-tabs" selected={tab} onChange={onTabChange}>
          <TabList>
            <Tab>Agent write-up</Tab>
            <Tab>Rule-based</Tab>
          </TabList>
          <TabPanel>
            <AgentWriteUp agent={report.agent} evidenceById={evidenceById} epicKey={issueKey} />
          </TabPanel>
          <TabPanel>
            <ReasonList label="From your Jira history (rule-based, no AI)" reasons={report.ruleBased?.reasons} evidenceById={evidenceById} epicKey={issueKey} />
          </TabPanel>
        </Tabs>
      ) : (
        <ReasonList label="From your Jira history (rule-based, no AI)" reasons={report.ruleBased?.reasons} evidenceById={evidenceById} epicKey={issueKey} />
      )}
      {comparison?.epics?.length ? <ComparisonSet comparison={comparison} space={space} /> : null}
      <RunInfo report={report} now={now} />
    </Stack>
  );
};
