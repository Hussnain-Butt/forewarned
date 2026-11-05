// Forge senders for the Confluence port (story 007), the Confluence twin of forge-jira.js. The panel
// lives in Jira; `requestConfluence` reaches the Confluence of the same site, where the app has to be
// installed too (spike M0d). Every path is built with `route`, which encodes interpolated values, and
// every call runs as the user in session, so Confluence applies their space and page permissions.

import api, { route } from '@forge/api';

const GET = { headers: { Accept: 'application/json' } };
const withBody = (method, body) => ({
  method,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function confluenceSenders(confluence = api.asUser()) {
  return {
    // The spaces the user can see, by name. Confluence can't filter by permission, so the create
    // permission comes from each space's operations.
    spaces: () => confluence.requestConfluence(route`/wiki/api/v2/spaces?status=current&sort=name&limit=250`, GET),
    space: (spaceId) => confluence.requestConfluence(route`/wiki/api/v2/spaces/${spaceId}`, GET),
    spaceOperations: (spaceId) => confluence.requestConfluence(route`/wiki/api/v2/spaces/${spaceId}/operations`, GET),
    // The stored page (its version and status), and the pages that already hold a title: published and
    // archived ones, since an archived page keeps its title in the space (checked on the site).
    page: (pageId) => confluence.requestConfluence(route`/wiki/api/v2/pages/${pageId}`, GET),
    pagesByTitle: (spaceId, title) => confluence.requestConfluence(route`/wiki/api/v2/pages?space-id=${spaceId}&title=${title}&status=current&status=archived&limit=5`, GET),
    createPage: (body) => confluence.requestConfluence(route`/wiki/api/v2/pages`, withBody('POST', body)),
    updatePage: (pageId, body) => confluence.requestConfluence(route`/wiki/api/v2/pages/${pageId}`, withBody('PUT', body)),
  };
}
