import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, { Button, Inline, SectionMessage, SectionMessageAction, Spinner, Stack, Text } from '@forge/react';
import { invoke, rovo } from '@forge/bridge';
import { Report } from './report.jsx';
import { RunSteps } from './running.jsx';

// The Forewarned epic panel (story 005): run the pre-mortem, follow its steps, read the report, and
// ask the Forewarned agent in Rovo for its write-up.

const RUN_POLL_MS = 2000;
const SLOW_AFTER_MS = 60 * 1000;
const RUN_LIMIT_MS = 5 * 60 * 1000;
const AGENT_POLL_MS = 5000;
const AGENT_LIMIT_MS = 3 * 60 * 1000;
const AGENT = { type: 'forge', agentName: 'Forewarned', agentKey: 'forewarned-agent' };
const AGENT_TAB = 0;
const RULE_TAB = 1;
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
  const [rovoEnabled, setRovoEnabled] = useState(null);
  // 'waiting' while the panel checks for the agent's write-up, 'expired' after 3 minutes.
  const [agentWait, setAgentWait] = useState(null);
  const [agentReady, setAgentReady] = useState(false);
  const [tab, setTab] = useState(AGENT_TAB);
  const tabRef = useRef(AGENT_TAB);
  const selectTab = (index) => {
    tabRef.current = index;
    setTab(index);
  };

  // Resolves to the panel data, or null when it couldn't be loaded.
  const load = () => invoke('getPanel')
    .then((result) => {
      setPanel(result);
      return result;
    })
    .catch(() => {
      setPanel({ error: LOAD_ERROR });
      return null;
    });

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

  // AC 19: a new agent write-up replaces the panel's data. A reader on the Rule-based tab gets a
  // notice instead of being moved away from what they are reading.
  const showNewWriteUp = (result, hadTabs) => {
    setPanel(result);
    setAgentWait(null);
    if (hadTabs && tabRef.current === RULE_TAB) setAgentReady(true);
    else selectTab(AGENT_TAB);
  };

  // AC 19: checks for the agent's write-up every 5 s until 3 minutes after the request, without a
  // reload.
  const waitForAgent = async (savedBefore, hadTabs, startedAt) => {
    setAgentWait('waiting');
    while (Date.now() - startedAt < AGENT_LIMIT_MS) {
      await wait(AGENT_POLL_MS);
      const result = await invoke('getPanel').catch(() => null);
      const savedAt = result?.report?.agent?.savedAt;
      if (savedAt && savedAt !== savedBefore) {
        showNewWriteUp(result, hadTabs);
        return;
      }
    }
    setAgentWait('expired');
  };

  const checkAgainForAgent = async () => {
    const savedBefore = panel?.report?.agent?.savedAt ?? null;
    const result = await invoke('getPanel').catch(() => null);
    const savedAt = result?.report?.agent?.savedAt;
    if (savedAt && savedAt !== savedBefore) showNewWriteUp(result, Boolean(panel?.report?.agent));
  };

  // AC 17: opens Rovo chat with the Forewarned agent and the epic. Opening Rovo remounts this panel,
  // so the request is stored first and the remounted panel picks the wait up (below).
  const openAgent = async () => {
    setAgentReady(false);
    await invoke('requestAgent').catch(() => null);
    rovo.open({ ...AGENT, prompt: `Write the pre-mortem for epic ${panel.issueKey}.` });
    waitForAgent(panel.report?.agent?.savedAt ?? null, Boolean(panel.report?.agent), Date.now());
  };

  useEffect(() => {
    load().then((result) => {
      const request = result?.agentRequest;
      const unchanged = (result?.report?.agent?.savedAt ?? null) === request?.savedBefore;
      if (request && unchanged && Date.now() - Date.parse(request.requestedAt) < AGENT_LIMIT_MS) {
        waitForAgent(request.savedBefore, Boolean(result.report?.agent), Date.parse(request.requestedAt));
      }
    });
    rovo.isEnabled().then(setRovoEnabled).catch(() => setRovoEnabled(false));
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
      {!report && !running ? (
        <Stack space="space.100">
          <Text>Imagine this epic has already failed. Forewarned finds the most likely reasons in your team&apos;s Jira history and links the proof.</Text>
          <Text color="color.text.subtle">It reads finished epics in this space and this epic&apos;s work items, links and assignees. Nothing leaves Atlassian.</Text>
        </Stack>
      ) : null}
      {agentReady ? (
        <SectionMessage appearance="information" actions={<SectionMessageAction onClick={() => { selectTab(AGENT_TAB); setAgentReady(false); }}>Show it</SectionMessageAction>}>
          <Text>The agent&apos;s write-up is ready.</Text>
        </SectionMessage>
      ) : null}
      {report ? <Report panel={panel} now={Date.now()} tab={tab} onTabChange={selectTab} /> : null}
      {agentWait === 'waiting' ? (
        <Inline space="space.100" alignBlock="center">
          <Spinner size="small" label="Waiting" />
          <Text>Waiting for the Forewarned agent to save its write-up…</Text>
        </Inline>
      ) : null}
      {agentWait === 'expired' ? (
        <Text color="color.text.subtle">The Forewarned agent hasn&apos;t saved a write-up yet.</Text>
      ) : null}
      {rovoEnabled === false ? (
        <SectionMessage appearance="information">
          <Text>Rovo isn&apos;t turned on for this site, so the agent write-up isn&apos;t available. The rule-based pre-mortem works without it.</Text>
        </SectionMessage>
      ) : null}
      {canRun ? null : (
        <Text color="color.text.subtle">You need permission to edit this epic to run a pre-mortem. Ask a space admin.</Text>
      )}
      {/* The run's progress and outcome sit next to the button that started it. */}
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
      <Inline space="space.100" shouldWrap>
        <Button appearance={report ? 'default' : 'primary'} onClick={startRun} isDisabled={running || !canRun}>
          {report ? 'Re-run' : 'Run pre-mortem'}
        </Button>
        {rovoEnabled && report ? (
          <Button appearance="rovo" onClick={openAgent} isDisabled={running || agentWait === 'waiting'}>Write with Forewarned agent</Button>
        ) : null}
        {agentWait === 'expired' ? <Button onClick={checkAgainForAgent}>Check again</Button> : null}
      </Inline>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
