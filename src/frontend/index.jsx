import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, { Button, Heading, Inline, Lozenge, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { invoke, rovo } from '@forge/bridge';

// Temporary panel controls for stories 003 and 004 (M3 Task 8): Run, step-by-step status and the
// version 2 report. Story 005 (M4) replaces this panel with the finished design and states.

const AGENT = { type: 'forge', agentName: 'Forewarned', agentKey: 'forewarned-agent' };
const POLL_MS = 2000;
const POLL_LIMIT_MS = 5 * 60 * 1000;
const LOZENGE = { High: 'removed', Medium: 'moved', Low: 'default' };
const SIGNALS = { slip: 'Slip history', scope: 'Scope growth', load: 'Load', dependencies: 'Dependencies' };
const wait = (ms) => new Promise((done) => { setTimeout(done, ms); });

const Reason = ({ reason }) => (
  <Stack space="space.050">
    <Inline space="space.100" alignBlock="center">
      <Lozenge appearance={LOZENGE[reason.likelihood] ?? 'default'}>{reason.likelihood}</Lozenge>
      <Text weight="bold">{reason.title}</Text>
    </Inline>
    {reason.explanation ? <Text>{reason.explanation}</Text> : null}
    <Text>What to do: {reason.mitigation}</Text>
    <Text size="small" color="color.text.subtle">Evidence: {reason.evidenceIds.join(', ')}</Text>
  </Stack>
);

const Checks = ({ checks }) => (
  <Stack space="space.050">
    {Object.entries(SIGNALS).map(([signal, label]) => (
      <Text key={signal} size="small">
        {label}: {checks[signal]?.status ?? 'not checked'}{checks[signal]?.note ? ` (${checks[signal].note})` : ''}
      </Text>
    ))}
  </Stack>
);

const Report = ({ report }) => {
  const { ruleBased, agent, status, checks } = report;
  return (
    <Stack space="space.200">
      {report.hiddenForReader ? (
        <SectionMessage appearance="information">Some reasons are hidden because they name work items you can&apos;t see.</SectionMessage>
      ) : null}
      {agent ? (
        <Stack space="space.150">
          <Heading size="small">Pre-mortem from the Forewarned agent</Heading>
          {agent.stale ? <SectionMessage appearance="warning">Based on an older evidence pack. Ask the agent to write it again.</SectionMessage> : null}
          {agent.reasons.map((reason) => <Reason key={reason.title} reason={reason} />)}
        </Stack>
      ) : null}
      <Stack space="space.150">
        <Heading size="small">From your Jira history (rule-based, no AI)</Heading>
        {status === 'insufficient-history' ? (
          <SectionMessage appearance="information">
            There is little finished history in this space, so some checks couldn&apos;t run. Here is what Forewarned checked.
          </SectionMessage>
        ) : null}
        {status === 'no-signals' ? (
          <SectionMessage appearance="information">No strong risk signals found in this history. Here is what Forewarned checked.</SectionMessage>
        ) : null}
        {ruleBased.reasons.map((reason) => <Reason key={reason.ruleId + reason.title} reason={reason} />)}
        {status !== 'ok' ? <Checks checks={checks} /> : null}
      </Stack>
    </Stack>
  );
};

const App = () => {
  const [state, setState] = useState({ loading: true });
  const [rovoEnabled, setRovoEnabled] = useState(false);
  const [run, setRun] = useState(null); // { step, error, seconds }
  const polling = useRef(false);

  const load = () => invoke('getPremortem')
    .then((result) => setState({ loading: false, ...result }))
    .catch(() => setState({ loading: false, error: "The pre-mortem couldn't be loaded." }));

  // Polls the epic's run status every 2 s (at most 5 minutes) and reloads the report when it is
  // done. It follows whichever run the status shows, so a double click can't strand it.
  const follow = async (clickedAt) => {
    if (polling.current) return;
    polling.current = true;
    try {
      while (Date.now() - clickedAt < POLL_LIMIT_MS) {
        await wait(POLL_MS);
        let status;
        try {
          ({ status } = await invoke('getRunStatus'));
        } catch {
          setRun({ error: "The run status couldn't be read. Click Refresh to see the latest report." });
          return;
        }
        if (!status) continue;
        if (status.status === 'done') {
          await load();
          setRun({ seconds: Math.round((Date.now() - clickedAt) / 1000) });
          return;
        }
        if (status.status === 'failed') {
          setRun({ error: status.error });
          return;
        }
        setRun({ step: status.step ?? 'queued' });
      }
      setRun({ error: 'The run is taking longer than 5 minutes. Refresh later to see the result.' });
    } finally {
      polling.current = false;
    }
  };

  const startRun = async () => {
    const clickedAt = Date.now();
    setRun({ step: 'queued' });
    const started = await invoke('startRun').catch(() => ({ error: "Forewarned couldn't start the run. Try again in a minute." }));
    if (started.error) {
      setRun({ error: started.error });
      return;
    }
    await follow(clickedAt);
  };

  useEffect(() => {
    load();
    rovo.isEnabled().then(setRovoEnabled).catch(() => setRovoEnabled(false));
    // Pick up a run that is already going, for example one the agent started.
    invoke('getRunStatus').then(({ status }) => {
      if (status && ['queued', 'running'].includes(status.status)) {
        setRun({ step: status.step ?? 'queued' });
        follow(Date.now());
      }
    }).catch(() => {});
  }, []);

  const openAgent = () => rovo.open({ ...AGENT, prompt: `Run a pre-mortem on epic ${state.issueKey}.` });

  if (state.loading) {
    return <Spinner label="Loading the pre-mortem" />;
  }
  const running = Boolean(run?.step);
  const report = state.report?.version === 2 ? state.report : null;
  return (
    <Stack space="space.200">
      {state.error ? <SectionMessage appearance="error">{state.error}</SectionMessage> : null}
      {run?.error ? <SectionMessage appearance="error">{run.error}</SectionMessage> : null}
      {running ? (
        <Inline space="space.100" alignBlock="center">
          <Spinner size="small" label="Running" />
          <Text>Checking {run.step}…</Text>
        </Inline>
      ) : null}
      {report ? <Report report={report} /> : !running && <Text>No pre-mortem yet. Click Run pre-mortem.</Text>}
      {run?.seconds !== undefined ? <Text size="small" color="color.text.subtle">Ready in {run.seconds} s.</Text> : null}
      {rovoEnabled ? null : (
        <SectionMessage appearance="information">Rovo is off on this site, so the Forewarned agent isn&apos;t available.</SectionMessage>
      )}
      <Inline space="space.100">
        <Button appearance="primary" onClick={startRun} isDisabled={running}>Run pre-mortem</Button>
        {rovoEnabled && state.issueKey ? <Button appearance="rovo" onClick={openAgent}>Write with Forewarned agent</Button> : null}
        <Button onClick={load}>Refresh</Button>
      </Inline>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
