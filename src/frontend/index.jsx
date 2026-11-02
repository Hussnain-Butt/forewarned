import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, { Button, Inline, SectionMessage, SectionMessageAction, Spinner, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import { Report } from './report.jsx';
import { RunSteps } from './running.jsx';

// The Forewarned epic panel (story 005): run the pre-mortem, follow its steps, read the report.

const RUN_POLL_MS = 2000;
const SLOW_AFTER_MS = 60 * 1000;
const RUN_LIMIT_MS = 5 * 60 * 1000;
const LOAD_ERROR = "Forewarned couldn't load the pre-mortem. Try again in a minute.";
const START_ERROR = "Forewarned couldn't start the run. Try again in a minute.";
const NOT_AN_EPIC = 'This panel works on epics only.';
const wait = (ms) => new Promise((done) => { setTimeout(done, ms); });

const App = () => {
  const [panel, setPanel] = useState(null);
  // { status, slow } while a run goes, { failed } or { timedOut } when it ended badly, else null.
  const [run, setRun] = useState(null);
  const following = useRef(false);
  const lastCount = useRef(null);

  const load = () => invoke('getPanel')
    .then((result) => setPanel(result))
    .catch(() => setPanel({ error: LOAD_ERROR }));

  // AC 6–7: polls the epic's run status every 2 s, at most 5 minutes, and follows whichever run the
  // status shows, so a run started in another tab or by the agent is followed too.
  const follow = async (startedAt) => {
    if (following.current) return;
    following.current = true;
    try {
      while (Date.now() - startedAt < RUN_LIMIT_MS) {
        let status;
        try {
          ({ status } = await invoke('getRunStatus'));
        } catch {
          setRun({ failed: "Forewarned couldn't read the run's progress. Refresh the page to see the latest report." });
          return;
        }
        if (status?.status === 'done') {
          await load();
          setRun(null);
          return;
        }
        if (status?.status === 'failed') {
          setRun({ failed: status.error });
          return;
        }
        if (Number.isInteger(status?.count)) lastCount.current = status.count;
        setRun({ status: { ...status, count: status?.count ?? lastCount.current }, slow: Date.now() - startedAt > SLOW_AFTER_MS });
        await wait(RUN_POLL_MS);
      }
      setRun({ timedOut: true });
    } finally {
      following.current = false;
    }
  };

  // AC 5: the running state shows at once; the start function checks the epic and the permission.
  const startRun = async () => {
    const startedAt = Date.now();
    lastCount.current = null;
    setRun({ status: { status: 'queued' }, slow: false });
    const started = await invoke('startRun').catch(() => ({ error: START_ERROR }));
    if (started.error) {
      setRun({ failed: started.error });
      return;
    }
    await follow(startedAt);
  };

  useEffect(() => {
    load();
    invoke('getRunStatus').then(({ status }) => {
      if (['queued', 'running'].includes(status?.status)) {
        setRun({ status, slow: false });
        follow(Date.parse(status.startedAt) || Date.now());
      }
    }).catch(() => {});
  }, []);

  if (!panel) return <Spinner label="Loading the pre-mortem" />;
  if (panel.error) {
    return (
      <SectionMessage
        appearance={panel.error === NOT_AN_EPIC ? 'information' : 'error'}
        actions={panel.error === NOT_AN_EPIC ? undefined : <SectionMessageAction onClick={load}>Try again</SectionMessageAction>}
      >
        <Text>{panel.error}</Text>
      </SectionMessage>
    );
  }

  const running = Boolean(run?.status);
  const { report, canRun } = panel;
  return (
    <Stack space="space.200">
      {run?.failed ? (
        <SectionMessage appearance="error" actions={canRun ? <SectionMessageAction onClick={startRun}>Try again</SectionMessageAction> : undefined}>
          <Text>{run.failed}</Text>
        </SectionMessage>
      ) : null}
      {run?.timedOut ? (
        <SectionMessage appearance="warning">
          <Text>The run is taking longer than 5 minutes. Refresh later to see the result.</Text>
        </SectionMessage>
      ) : null}
      {running ? <RunSteps status={run.status} slow={run.slow} /> : null}
      {!report && !running ? (
        <Stack space="space.100">
          <Text>Imagine this epic has already failed. Forewarned finds the most likely reasons in your team&apos;s Jira history and links the proof.</Text>
          <Text color="color.text.subtle">It reads finished epics in this space and this epic&apos;s work items, links and assignees. Nothing leaves Atlassian.</Text>
        </Stack>
      ) : null}
      {report ? <Report panel={panel} now={Date.now()} /> : null}
      {canRun ? null : (
        <Text color="color.text.subtle">You need permission to edit this epic to run a pre-mortem. Ask a space admin.</Text>
      )}
      <Inline space="space.100" shouldWrap>
        <Button appearance={report ? 'default' : 'primary'} onClick={startRun} isDisabled={running || !canRun}>
          {report ? 'Re-run' : 'Run pre-mortem'}
        </Button>
      </Inline>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
