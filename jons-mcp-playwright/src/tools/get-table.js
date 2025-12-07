/**
 * browser_get_table tool
 *
 * Extracts table data as markdown.
 */

// TODO: Implement in browser-get-table task
export async function getTable(page, ref, options = {}) {
  throw new Error('browser_get_table not yet implemented');
}

export const schema = {
  name: 'browser_get_table',
  description: 'Extract table data as markdown',
  inputSchema: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Element ref pointing to a table element',
      },
      saveToFile: {
        type: 'boolean',
        description: 'Save to temp file and return path (default: false)',
      },
    },
    required: ['ref'],
  },
};
