// Forge senders for the evidence engine's Jira port (jira.js). This is the only engine file that
// imports @forge/api. Every path is built with `route`, which rejects path tricks in interpolated
// path segments and encodes interpolated query values, and every call runs as the requesting user
// (`asUser()`), so Jira applies that user's permissions and returns only work items from spaces
// they can browse (story 002 AC 2).

import api, { route } from '@forge/api';

const GET = { headers: { Accept: 'application/json' } };
const post = (body) => ({
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// `jira` is the requester: `api.asUser()` for the user in session (resolvers, actions), or
// `api.asUser(accountId)` in the queue consumer, which impersonates the user who started the run.
export function forgeSenders(jira = api.asUser()) {
  return {
    serverInfo: () => jira.requestJira(route`/rest/api/3/serverInfo`, GET),
    statuses: () => jira.requestJira(route`/rest/api/3/status`, GET),
    linkTypes: () => jira.requestJira(route`/rest/api/3/issueLinkType`, GET),
    issue: (key, fields) => jira.requestJira(route`/rest/api/3/issue/${key}?fields=${fields.join(',')}`, GET),
    projectIssueTypes: (projectId) => jira.requestJira(route`/rest/api/3/issuetype/project?projectId=${projectId}`, GET),
    search: (body) => jira.requestJira(route`/rest/api/3/search/jql`, post(body)),
    count: (jql) => jira.requestJira(route`/rest/api/3/search/approximate-count`, post({ jql })),
    changelogs: (body) => jira.requestJira(route`/rest/api/3/changelog/bulkfetch`, post(body)),
    bulkIssues: (body) => jira.requestJira(route`/rest/api/3/issue/bulkfetch`, post(body)),
    // Story 003: the pack and the report are entity properties on the epic.
    issueProperty: (key, name) => jira.requestJira(route`/rest/api/3/issue/${key}/properties/${name}`, GET),
    setIssueProperty: (key, name, value) => jira.requestJira(route`/rest/api/3/issue/${key}/properties/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    }),
    myPermissions: (key) => jira.requestJira(route`/rest/api/3/mypermissions?issueKey=${key}&permissions=EDIT_ISSUES`, GET),
  };
}
