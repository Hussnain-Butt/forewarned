// Building blocks for Atlassian Document Format (ADF), the JSON both Jira descriptions (story 006)
// and Confluence pages (story 007) are written in. Jira and Confluence reject empty text nodes, so
// callers pass only non-empty text; an empty paragraph (no content) is allowed.

export const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
export const paragraph = (...content) => ({ type: 'paragraph', content });
export const linkTo = (url) => [{ type: 'link', attrs: { href: url } }];
export const heading = (level, value) => ({ type: 'heading', attrs: { level }, content: [text(value)] });

// A bulleted list of listItem nodes; `item` makes one from inline nodes.
export const item = (...content) => ({ type: 'listItem', content: [paragraph(...content)] });
export const bulletList = (items) => ({ type: 'bulletList', content: items });

// A blue information panel, which Confluence shows in both its light and dark themes.
export const infoPanel = (...paragraphs) => ({ type: 'panel', attrs: { panelType: 'info' }, content: paragraphs });

// A table with a header row. Each row is a list of cells, and each cell a list of block nodes
// (usually one paragraph); long text wraps inside its cell.
export function table(headers, rows) {
  const row = (cells) => ({ type: 'tableRow', content: cells });
  return {
    type: 'table',
    attrs: { isNumberColumnEnabled: false, layout: 'default' },
    content: [
      row(headers.map((header) => ({ type: 'tableHeader', attrs: {}, content: [paragraph(text(header))] }))),
      ...rows.map((cells) => row(cells.map((blocks) => ({ type: 'tableCell', attrs: {}, content: blocks })))),
    ],
  };
}
