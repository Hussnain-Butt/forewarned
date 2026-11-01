// Loaded with `node --import`, this replaces globalThis.fetch with a Jira site answered by the
// seed port, so the site runner (scripts/engine/run-on-site.mjs) can be tested without a site.

import { seedPort } from './seed-port.mjs';

const { senders } = seedPort();
const notFaked = (path) => new Response(JSON.stringify({ errorMessages: [`Not faked: ${path}`] }), { status: 404 });

globalThis.fetch = async (url, init = {}) => {
  const { pathname, searchParams } = new URL(url);
  const body = init.body ? JSON.parse(init.body) : undefined;
  if (!/^Basic /.test(init.headers?.Authorization ?? '')) return new Response('{}', { status: 401 });
  switch (pathname) {
    case '/rest/api/3/myself': return Response.json({ accountId: 'acc-requester' });
    case '/rest/api/3/serverInfo': return senders.serverInfo();
    case '/rest/api/3/status': return senders.statuses();
    case '/rest/api/3/issueLinkType': return senders.linkTypes();
    case '/rest/api/3/issuetype/project': return senders.projectIssueTypes(searchParams.get('projectId'));
    case '/rest/api/3/search/jql': return senders.search(body);
    case '/rest/api/3/search/approximate-count': return senders.count(body.jql);
    case '/rest/api/3/changelog/bulkfetch': return senders.changelogs(body);
    default: {
      const issue = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(pathname);
      return issue ? senders.issue(decodeURIComponent(issue[1]), searchParams.get('fields').split(',')) : notFaked(pathname);
    }
  }
};
