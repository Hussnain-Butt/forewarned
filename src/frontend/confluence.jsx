import React, { useRef, useState } from 'react';
import { Button, Inline, Label, Link, SectionMessage, SectionMessageAction, Select, Spinner, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import { CONFLUENCE_UNAVAILABLE, pageButtonLabel, pageConfirmLabel, pageResultParts, pageWritingLine } from './text.js';

// Story 007: write the epic's pre-mortem page in Confluence, as the user, and update it later. The
// spaces load only when the button is clicked (one request per space), so opening the panel stays
// fast. `confluence` is the panel data's { available, page }.

const CONFLUENCE_ERROR = "Forewarned couldn't reach Confluence. Try again in a minute.";
const SELECT_ID = 'forewarned-confluence-space';

export const ConfluencePage = ({ confluence }) => {
  // 'idle', 'loading' (the spaces), 'choosing' (the picker) or 'writing' (the page).
  const [mode, setMode] = useState('idle');
  const [spaces, setSpaces] = useState([]);
  const [choice, setChoice] = useState(null);
  // The page this panel just wrote, the last write's result, a failure ({ error, retry: 'spaces' or
  // 'write' }) and Confluence's own "not available" answer.
  const [written, setWritten] = useState(null);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);
  const [unavailable, setUnavailable] = useState(null);
  const writing = useRef(false);
  const page = written ?? confluence?.page ?? null;

  // AC 2: the spaces where the user can create pages, with the epic's last space chosen.
  const loadSpaces = async () => {
    setMode('loading');
    setFailure(null);
    setResult(null);
    const answer = await invoke('getConfluenceSpaces').catch(() => ({ error: CONFLUENCE_ERROR }));
    if (answer?.unavailable) {
      setUnavailable(answer.error);
    } else if (answer?.error || !answer?.spaces) {
      setFailure({ error: answer?.error ?? CONFLUENCE_ERROR, retry: 'spaces' });
      setMode('idle');
    } else {
      setSpaces(answer.spaces);
      setChoice(answer.defaultSpaceId ?? null);
      setMode('choosing');
    }
  };

  // AC 11–17: creates or updates the page; a double click sends one request. On a failure the picker
  // stays, so the user can pick another space (AC 16).
  const writePage = async () => {
    if (writing.current || !choice) return;
    writing.current = true;
    setMode('writing');
    setFailure(null);
    try {
      const answer = await invoke('writeConfluencePage', { spaceId: choice }).catch(() => ({ error: CONFLUENCE_ERROR }));
      if (answer?.unavailable) {
        setUnavailable(answer.error);
      } else if (answer?.error || !answer?.page) {
        setFailure({ error: answer?.error ?? CONFLUENCE_ERROR, retry: 'write' });
        setMode('choosing');
      } else {
        setWritten(answer.page);
        setResult(answer);
        setMode('idle');
      }
    } finally {
      writing.current = false;
    }
  };

  const cancel = () => {
    setFailure(null);
    setMode('idle');
  };

  // AC 15: without Confluence, one message takes the section's place; the rest of the panel works.
  if (confluence?.available === false || unavailable) {
    return (
      <SectionMessage appearance="information">
        <Text>{unavailable ?? CONFLUENCE_UNAVAILABLE}</Text>
      </SectionMessage>
    );
  }

  const parts = result && pageResultParts(result);
  const options = spaces.map((space) => ({ label: space.name, value: space.id }));
  const updating = Boolean(page) && choice === page.spaceId;
  const chosen = spaces.find((space) => space.id === choice);
  return (
    <Stack space="space.100">
      {parts ? (
        <SectionMessage appearance="success">
          <Stack space="space.050">
            <Text>{parts.line}</Text>
            {parts.note ? <Text>{parts.note}</Text> : null}
          </Stack>
        </SectionMessage>
      ) : null}
      {failure ? (
        <SectionMessage
          appearance="error"
          actions={<SectionMessageAction onClick={failure.retry === 'spaces' ? loadSpaces : writePage}>Try again</SectionMessageAction>}
        >
          <Text>{failure.error}</Text>
        </SectionMessage>
      ) : null}
      {mode === 'idle' ? (
        <Inline space="space.150" alignBlock="center" shouldWrap>
          <Button onClick={loadSpaces}>{pageButtonLabel(Boolean(page))}</Button>
          {page ? <Link href={page.url} openNewTab>Open the Confluence page</Link> : null}
        </Inline>
      ) : null}
      {mode === 'loading' ? (
        <Inline space="space.100" alignBlock="center">
          <Spinner size="small" label="Loading Confluence spaces" />
          <Text>Loading Confluence spaces…</Text>
        </Inline>
      ) : null}
      {mode === 'choosing' && !spaces.length ? (
        <Stack space="space.100">
          <Text>{"You can't create pages in any space. Ask a Confluence admin."}</Text>
          <Inline>
            <Button appearance="subtle" onClick={cancel}>Cancel</Button>
          </Inline>
        </Stack>
      ) : null}
      {mode === 'choosing' && spaces.length ? (
        <Stack space="space.100">
          <Stack space="space.050">
            <Label labelFor={SELECT_ID}>Confluence space</Label>
            <Select
              inputId={SELECT_ID}
              isSearchable
              options={options}
              value={options.find((option) => option.value === choice) ?? null}
              placeholder="Choose a space"
              onChange={(option) => setChoice(option?.value ?? null)}
            />
          </Stack>
          <Inline space="space.100">
            <Button appearance="primary" isDisabled={!choice} onClick={writePage}>{pageConfirmLabel(updating)}</Button>
            <Button appearance="subtle" onClick={cancel}>Cancel</Button>
          </Inline>
        </Stack>
      ) : null}
      {/* While the page is written the picker gives way to progress in words, which names the space. */}
      {mode === 'writing' ? (
        <Inline space="space.100" alignBlock="center">
          <Spinner size="small" label="Writing the Confluence page" />
          <Text>{pageWritingLine(updating, chosen?.name ?? 'Confluence')}</Text>
        </Inline>
      ) : null}
    </Stack>
  );
};
