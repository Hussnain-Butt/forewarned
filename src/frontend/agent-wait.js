// Following the Forewarned agent's write-ups from the panel (story 005 AC 19, story 008 AC 8). The
// agent may fix dropped reasons and save a second time, so checking goes on until the wait ends,
// and every new save is shown, not only the first. Kept out of the JSX so it is tested in Node.

// Checks every `pollMs` until `limitMs` after `startedAt`; calls `onWriteUp` with the panel data
// each time the agent's save time changes. A failed check (null) is skipped. Resolves to true when
// at least one new write-up arrived.
export async function followAgentWriteUps({ check, wait, now, startedAt, savedBefore, limitMs, pollMs, onWriteUp }) {
  let lastSeen = savedBefore;
  let arrived = false;
  while (now() - startedAt < limitMs) {
    await wait(pollMs);
    const result = await check();
    const savedAt = result?.report?.agent?.savedAt;
    if (savedAt && savedAt !== lastSeen) {
      lastSeen = savedAt;
      arrived = true;
      onWriteUp(result);
    }
  }
  return arrived;
}
