import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, { Button, Inline, SectionMessage, SectionMessageAction, Spinner, Stack, Text } from '@forge/react';
import { invoke, rovo } from '@forge/bridge';
import { Report } from './report.jsx';
import { RunSteps } from './running.jsx';
import { EPICS_ONLY } from '../premortem/epic.js';

// The Forewarned epic panel (story 005): run the pre-mortem, follow its steps, read the report, and
// ask the Forewarned agent in Rovo for its write-up.

const RUN_POLL_MS = 2000;
const SLOW_AFTER_MS = 60 * 1000;
const RUN_LIMIT_MS = 5 * 60 * 1000;
const AGENT_POLL_MS = 5000;
const AGENT_LIMIT_MS = 3 * 60 * 1000;
const MAX_MISSED_POLLS = 3;
const AGENT = { type: 'forge', agentName: 'Forewarned', agentKey: 'forewarned-agent' };
const AGENT_TAB = 0;
const RULE_TAB = 1;
const LOAD_ERROR = "Forewarned couldn't load the pre-mortem. Try again in a minute.";
const START_ERROR = "Forewarned couldn't start the run. Try again in a minute.";
const wait = (ms) => new Promise((done) => { setTimeout(done, ms); });
// An agent write-up on the current evidence run; a stale one shows only the "earlier run" message.
const hasCurrentAgent = (panel) => Boolean(panel?.report?.agent && !panel.report.agent.stale);

const App = () => {
  const [panel, setPanel] = useState(null);
  // { status, slow } while a run goes, { failed } or { timedOut } when it ended badly, else null.
  const [run, setRun] = useState(null);
  const following = useRef(false);
  const [rovoEnabled, setRovoEnabled] = useState(null);
  // 'waiting' while the panel checks for the agent's write-up, 'expired' after 3 minutes, 'checked'
  // after a Check again that found nothing new.
  const [agentWait, setAgentWait] = useState(null);
  const [agentReady, setAgentReady] = useState(false);
  const [tab, setTab] = useState(AGENT_TAB);
  const tabRef = useRef(AGENT_TAB);
  const selectTab = (index) => {
    tabRef.current = index;
    setTab(index);
  };

  // Resolves to the panel data, or null when it couldn't be loaded. A stale agent write-up has no
  // reasons to show, so the panel opens on the rule-based ones.
  const load = () => invoke('getPanel')
    .then((result) => {
      setPanel(result);
      if (result?.report?.agent?.stale) selectTab(RULE_TAB);
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
    let misses = 0;
    try {
      while (Date.now() - startedAt < RUN_LIMIT_MS) {
        let status;
        try {
          ({ status } = await invoke('getRunStatus'));
          misses = 0;
        } catch {
          // One failed read (a cold start, a network blip) doesn't stop following the run.
          misses += 1;
          if (misses >= MAX_MISSED_POLLS) {
            setRun({ failed: "Forewarned couldn't read the run's progress. Refresh the page to see the latest report." });
            return;
          }
          await wait(RUN_POLL_MS);
          continue;
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
        setRun({ status, slow: Date.now() - startedAt > SLOW_AFTER_MS });
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
    setRun({ status: { status: 'queued' }, slow: false });
    const started = await invoke('startRun').catch(() => ({ error: START_ERROR }));
    if (started.error) {
      setRun({ failed: started.error });
      return;
    }
    await follow(startedAt);
  };

  // AC 19: a new agent write-up replaces the panel's data. A reader on the Rule-based tab next to a
  // current agent write-up gets a notice instead of being moved away from what they are reading.
  const showNewWriteUp = (result, hadCurrentAgent) => {
    setPanel(result);
    setAgentWait(null);
    if (hadCurrentAgent && tabRef.current === RULE_TAB) setAgentReady(true);
    else selectTab(AGENT_TAB);
  };

  // AC 19: checks for the agent's write-up every 5 s until 3 minutes after the request, without a
  // reload.
  const waitForAgent = async (savedBefore, hadCurrentAgent, startedAt) => {
    setAgentWait('waiting');
    while (Date.now() - startedAt < AGENT_LIMIT_MS) {
      await wait(AGENT_POLL_MS);
      const result = await invoke('getPanel').catch(() => null);
      const savedAt = result?.report?.agent?.savedAt;
      if (savedAt && savedAt !== savedBefore) {
        showNewWriteUp(result, hadCurrentAgent);
        return;
      }
    }
    setAgentWait('expired');
  };

  const checkAgainForAgent = async () => {
    const savedBefore = panel?.report?.agent?.savedAt ?? null;
    const result = await invoke('getPanel').catch(() => null);
    const savedAt = result?.report?.agent?.savedAt;
    if (savedAt && savedAt !== savedBefore) showNewWriteUp(result, hasCurrentAgent(panel));
    // Said in words, so the reader (and a screen reader) knows the check ran (AC 30).
    else if (result) setAgentWait('checked');
  };

  // AC 17: opens Rovo chat with the Forewarned agent and the epic. Opening Rovo remounts this panel,
  // so the request is stored first and the remounted panel picks the wait up (below).
  const openAgent = async () => {
    setAgentReady(false);
    await invoke('requestAgent').catch(() => null);
    rovo.open({ ...AGENT, prompt: `Write the pre-mortem for epic ${panel.issueKey}.` });
    waitForAgent(panel.report?.agent?.savedAt ?? null, hasCurrentAgent(panel), Date.now());
  };

  useEffect(() => {
    load().then((result) => {
      // The request's age comes from the server, so the reader's computer clock doesn't matter.
      const request = result?.agentRequest;
      const unchanged = (result?.report?.agent?.savedAt ?? null) === request?.savedBefore;
      if (request && unchanged && request.ageMs < AGENT_LIMIT_MS) {
        waitForAgent(request.savedBefore, hasCurrentAgent(result), Date.now() - request.ageMs);
      }
    });
    rovo.isEnabled().then(setRovoEnabled).catch(() => setRovoEnabled(false));
    invoke('getRunStatus').then(({ status }) => {
      if (['queued', 'running'].includes(status?.status)) {
        setRun({ status, slow: false });
        // Timed from now: the server's start time against this computer's clock could be off.
        follow(Date.now());
      } else if (status?.status === 'failed') {
        // The latest run failed; a report below is from an earlier run.
        setRun({ failed: status.error });
      }
    }).catch(() => {});
  }, []);

  if (!panel) return <Spinner label="Loading the pre-mortem" />;
  if (panel.error) {
    return (
      <SectionMessage
        appearance={panel.error === EPICS_ONLY ? 'information' : 'error'}
        actions={panel.error === EPICS_ONLY ? undefined : <SectionMessageAction onClick={load}>Try again</SectionMessageAction>}
      >
        <Text>{panel.error}</Text>
      </SectionMessage>
    );
  }

  const running = Boolean(run?.status);
  const { report, canRun } = panel;
  // AC 6 and 28: a failed run, or one still going after 5 minutes, is an error with Try again.
  const timedOut = `The run is taking longer than 5 minutes. ${canRun ? 'Try again, or refresh' : 'Refresh'} later to see the result.`;
  const runError = run?.failed ?? (run?.timedOut ? timedOut : null);
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
      {agentWait === 'checked' ? (
        <Text color="color.text.subtle">Still no write-up from the Forewarned agent. Check again in a minute.</Text>
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
      {runError ? (
        <SectionMessage appearance="error" actions={canRun ? <SectionMessageAction onClick={startRun}>Try again</SectionMessageAction> : undefined}>
          <Text>{runError}</Text>
        </SectionMessage>
      ) : null}
      {running ? <RunSteps status={run.status} slow={run.slow} /> : null}
      <Inline space="space.100" shouldWrap>
        <Button appearance={report ? 'default' : 'primary'} onClick={startRun} isDisabled={running || !canRun}>
          {report ? 'Re-run' : 'Run pre-mortem'}
        </Button>
        {/* The agent's save needs edit permission too, so a viewer isn't left waiting for nothing. */}
        {rovoEnabled && report && canRun ? (
          <Button appearance="rovo" onClick={openAgent} isDisabled={running || agentWait === 'waiting'}>Write with Forewarned agent</Button>
        ) : null}
        {['expired', 'checked'].includes(agentWait) ? <Button onClick={checkAgainForAgent}>Check again</Button> : null}
      </Inline>
    </Stack>
  );
};

// A render error shows a message with Try again instead of Jira's endless loading bars (story 005
// AC 28). The error itself goes to the browser console, not to the reader.
class PanelErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('Forewarned panel error:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <SectionMessage
        appearance="error"
        actions={<SectionMessageAction onClick={() => this.setState({ failed: false })}>Try again</SectionMessageAction>}
      >
        <Text>Forewarned couldn&apos;t show this panel. Try again, or reload the page if it happens again.</Text>
      </SectionMessage>
    );
  }
}

ForgeReconciler.render(
  <React.StrictMode>
    <PanelErrorBoundary>
      <App />
    </PanelErrorBoundary>
  </React.StrictMode>
);
