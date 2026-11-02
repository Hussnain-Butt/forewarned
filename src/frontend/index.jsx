import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Heading, Inline, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { invoke, rovo } from '@forge/bridge';

const AGENT = { type: 'forge', agentName: 'Forewarned', agentKey: 'forewarned-agent' };

const Reason = ({ reason }) => (
  <Stack space="space.050">
    <Text weight="bold">{reason.title}</Text>
    {reason.explanation ? <Text>{reason.explanation}</Text> : null}
    <Text size="small" color="color.text.subtle">
      Evidence: {reason.evidenceIds.join(', ')}
    </Text>
  </Stack>
);

const App = () => {
  const [state, setState] = useState({ loading: true });
  const [rovoEnabled, setRovoEnabled] = useState(false);

  const load = () => {
    setState({ loading: true });
    invoke('getPremortem')
      .then((result) => setState({ loading: false, ...result }))
      .catch(() => setState({ loading: false, error: "The pre-mortem couldn't be loaded." }));
  };

  useEffect(() => {
    load();
    rovo
      .isEnabled()
      .then(setRovoEnabled)
      .catch(() => setRovoEnabled(false));
  }, []);

  const openAgent = () =>
    rovo.open({ ...AGENT, prompt: `Run a pre-mortem on epic ${state.issueKey}.` });

  // M3 Task 1 platform check (temporary; Task 8 replaces it with the Run controls): queue a run,
  // then poll its status every 2 s for up to 60 s.
  const [check, setCheck] = useState(null);
  const runCheck = async () => {
    setCheck('Queued…');
    const started = await invoke('startRun').catch(() => ({ error: 'The run could not be started.' }));
    if (started.error) {
      setCheck(started.error);
      return;
    }
    for (let i = 0; i < 30; i += 1) {
      await new Promise((done) => { setTimeout(done, 2000); });
      const { status } = await invoke('getRunStatus');
      if (status?.runId === started.runId && (status.status === 'done' || status.status === 'failed')) {
        setCheck(`Run check: ${status.status}, ${status.count ?? 'no'} child work items${status.error ? ` (${status.error})` : ''}`);
        return;
      }
    }
    setCheck('Run check: no result after 60 s.');
  };

  if (state.loading) {
    return <Spinner label="Loading the pre-mortem" />;
  }

  const { report } = state;
  return (
    <Stack space="space.200">
      {state.error ? <SectionMessage appearance="error">{state.error}</SectionMessage> : null}
      {report ? (
        <Stack space="space.150">
          <Heading size="small">Pre-mortem from the Forewarned agent</Heading>
          {report.reasons.map((reason) => (
            <Reason key={reason.title} reason={reason} />
          ))}
          <Text size="small" color="color.text.subtle">
            Saved {new Date(report.savedAt).toLocaleString()}. Reasons dropped for missing evidence:{' '}
            {report.droppedCount}.
          </Text>
        </Stack>
      ) : (
        !state.error && <Text>No pre-mortem yet. Ask the Forewarned agent to write one.</Text>
      )}
      {rovoEnabled ? null : (
        <SectionMessage appearance="information">
          Rovo is off on this site, so the Forewarned agent isn't available.
        </SectionMessage>
      )}
      <Inline space="space.100">
        {rovoEnabled && state.issueKey ? (
          <Button appearance="rovo" onClick={openAgent}>
            Write with Forewarned agent
          </Button>
        ) : null}
        <Button onClick={load}>Refresh</Button>
        <Button onClick={runCheck}>Check run (M3 test)</Button>
      </Inline>
      {check ? <Text size="small">{check}</Text> : null}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
