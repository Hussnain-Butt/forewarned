// Following the Forewarned agent's write-ups from the panel (story 005 AC 19, story 008 AC 8). The
// agent fixes dropped reasons and saves a second time, so after a save with drops checking goes
// on and the fixed save is shown too. A clean save ends it: every check reads the stored
// pre-mortem from KVS, which counts against the free allowance (story 009). Kept out of the JSX
// so it is tested in Node.

const droppedSome = (agent) => Object.values(agent.droppedByRule ?? {}).some((count) => count > 0);
// The prompt allows the agent one fix after its first save (story 008 AC 2).
const MAX_SAVES = 2;

// Checks every `pollMs` until `limitMs` after `startedAt`, or after the latest save with drops
// (reading and confirming Rovo's cards takes the user time); calls `onWriteUp` with the panel data
// each time the agent's save time changes. A failed check (null) is skipped. `cancelled` ends the
// wait at once (a newer wait took over, or the panel went away). Resolves to true when at least one
// new write-up arrived.
export async function followAgentWriteUps({ check, wait, now, startedAt, savedBefore, limitMs, pollMs, onWriteUp, cancelled = () => false }) {
  let lastSeen = savedBefore;
  let saves = 0;
  let until = startedAt + limitMs;
  while (now() < until) {
    await wait(pollMs);
    if (cancelled()) break;
    const result = await check();
    if (cancelled()) break;
    const agent = result?.report?.agent;
    if (agent?.savedAt && agent.savedAt !== lastSeen) {
      lastSeen = agent.savedAt;
      saves += 1;
      onWriteUp(result);
      if (!droppedSome(agent) || saves === MAX_SAVES) return true;
      until = now() + limitMs;
    }
  }
  return saves > 0;
}
