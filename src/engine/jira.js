// The Jira port the fetch layer reads through (story 002). `senders` holds one function per REST
// call that returns a fetch-style Response: in Forge they use `route` and `asUser()`
// (forge-jira.js); in tests and the site runner they are plain functions. This wrapper counts
// requests (AC 33), retries once when Jira is busy, parses JSON and turns failures into JiraError.

const DEFAULT_RETRY_SECONDS = 2;

// A Jira failure with its HTTP status. The message never includes the response body, so no work
// item content or internal detail can leak into logs or agent answers.
export class JiraError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'JiraError';
    this.status = status;
  }
}

const messageFor = (name, status) => {
  if (status === 429 || status >= 500) return `Jira is busy right now (status ${status}). Try again in a minute.`;
  if (status === 401 || status === 403) return `Jira refused the request (status ${status}). Check that you can browse this space.`;
  return `Jira returned status ${status} for the ${name} request.`;
};

// Wraps every sender with the same counting, retry and error handling. A 429 or 5xx is retried
// once after Retry-After seconds (default 2), but only when the retry would still finish before
// `deadline` (a Date.now() timestamp); otherwise the run fails with a clear message.
export function createJira(senders, { deadline, now = Date.now, sleep = (ms) => new Promise((done) => { setTimeout(done, ms); }) }) {
  const port = { requestCount: 0 };
  for (const [name, send] of Object.entries(senders)) {
    port[name] = async (...args) => {
      for (let attempt = 1; ; attempt += 1) {
        port.requestCount += 1;
        const response = await send(...args);
        if ((response.status === 429 || response.status >= 500) && attempt === 1) {
          const waitMs = (Number(response.headers?.get('retry-after')) || DEFAULT_RETRY_SECONDS) * 1000;
          if (now() + waitMs < deadline) {
            await sleep(waitMs);
            continue;
          }
        }
        if (!response.ok) throw new JiraError(response.status, messageFor(name, response.status));
        const text = await response.text();
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch {
          // JSON.parse quotes the start of the body in its message, so it never reaches the user.
          throw new JiraError(response.status, `Jira sent a response that isn't JSON for the ${name} request.`);
        }
      }
    };
  }
  return port;
}
