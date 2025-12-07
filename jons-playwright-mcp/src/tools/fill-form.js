/**
 * browser_fill_form tool
 *
 * Fills multiple form fields in a single call.
 */

// TODO: Implement in browser-fill-form task
export async function fillForm(page, fields) {
  throw new Error('browser_fill_form not yet implemented');
}

export const schema = {
  name: 'browser_fill_form',
  description: 'Fill multiple form fields at once',
  inputSchema: {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        description: 'Array of field refs and values to fill',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'Element ref' },
            value: {
              oneOf: [{ type: 'string' }, { type: 'boolean' }],
              description: 'Value to set',
            },
          },
          required: ['ref', 'value'],
        },
      },
    },
    required: ['fields'],
  },
};
