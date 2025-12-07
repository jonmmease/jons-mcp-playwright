/**
 * browser_get_bounds tool
 *
 * Gets element bounding box in viewport coordinates.
 */

// TODO: Implement in browser-get-bounds task
export async function getBounds(page, ref) {
  throw new Error('browser_get_bounds not yet implemented');
}

export const schema = {
  name: 'browser_get_bounds',
  description: 'Get element bounding box in viewport coordinates',
  inputSchema: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Element ref to get bounds for',
      },
    },
    required: ['ref'],
  },
};
