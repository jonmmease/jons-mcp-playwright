/**
 * browser_get_image tool
 *
 * Downloads an image from an <img> element and serves it via localhost URL.
 */

export const schema = {
  name: 'browser_get_image',
  description: 'Download an image from an img element and get a localhost URL for it. Returns the image dimensions, alt text, and a download URL.',
  inputSchema: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Element ref pointing to an img element',
      },
    },
    required: ['ref'],
  },
};
