/**
 * browser_get_image tool
 *
 * Retrieves the original source image from an <img> element.
 */

// TODO: Implement in browser-get-image task
export async function getImage(page, ref, options = {}) {
  throw new Error('browser_get_image not yet implemented');
}

export const schema = {
  name: 'browser_get_image',
  description: 'Get the original source image from an img element',
  inputSchema: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Element ref pointing to an img element',
      },
      saveToFile: {
        type: 'boolean',
        description: 'Save to temp file and return path instead of data (default: false)',
      },
    },
    required: ['ref'],
  },
};
