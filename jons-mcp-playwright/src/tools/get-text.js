/**
 * browser_get_text tool
 *
 * Extracts clean text content from an element.
 * For form fields (input, textarea), returns .value
 * For other elements, returns .innerText
 */

// TODO: Implement in browser-get-text task
export async function getText(page, ref, options = {}) {
  throw new Error('browser_get_text not yet implemented');
}

export const schema = {
  name: 'browser_get_text',
  description: 'Get all text content from an element without length limits',
  inputSchema: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Element ref to extract text from',
      },
      saveToFile: {
        type: 'boolean',
        description: 'Save to temp file and return path (default: false)',
      },
    },
    required: ['ref'],
  },
};
