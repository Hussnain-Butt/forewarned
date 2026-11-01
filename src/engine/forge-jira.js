// Forge senders for the evidence engine's Jira port (jira.js). This is the only engine file that
// imports @forge/api. Every path is built with `route`, which encodes interpolated values, and
// every call runs as the requesting user (`asUser()`), so Jira applies that user's permissions and
// returns only work items from spaces they can browse (story 002 AC 2).

import api, { route } from '@forge/api';

const GET = { headers: { Accept: 'application/json' } };
const post = (body) => ({
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function forgeSenders() {
  const jira = api.asUser();
  return {
    serverInfo: () => jira.requestJira(route`/rest/api/3/serverInfo`, GET),
    statuses: () => jira.requestJira(route`/rest/api/3/status`, GET),
    linkTypes: () => jira.requestJira(route`/rest/api/3/issueLinkType`, GET),
    issue: (key, fields) => jira.requestJira(route`/rest/api/3/issue/${key}?fields=${fields.join(',')}`, GET),
    projectIssueTypes: (projectId) => jira.requestJira(route`/rest/api/3/issuetype/project?projectId=${projectId}`, GET),
    search: (body) => jira.requestJira(route`/rest/api/3/search/jql`, post(body)),
    count: (jql) => jira.requestJira(route`/rest/api/3/search/approximate-count`, post({ jql })),
    changelogs: (body) => jira.requestJira(route`/rest/api/3/changelog/bulkfetch`, post(body)),
  };
}
