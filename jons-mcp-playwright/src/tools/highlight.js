/**
 * browser_highlight and browser_clear_highlights tools
 *
 * Tools for visually highlighting UI elements to guide users through a page.
 */

export const highlightSchema = {
  name: 'browser_highlight',
  description: 'Highlight UI elements to point them out to the user. Use this when explaining a website to help users locate specific elements. Highlights auto-clear on next browser action.',
  inputSchema: {
    type: 'object',
    properties: {
      refs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Element refs to highlight (from snapshot). Can highlight multiple elements at once.',
      },
      color: {
        type: 'string',
        description: 'Highlight color (default: "red"). Options: red, blue, green, orange, purple, or any CSS color.',
      },
      label: {
        type: 'string',
        description: 'Optional text label to display near the first highlighted element.',
      },
    },
    required: ['refs'],
  },
};

export const clearHighlightsSchema = {
  name: 'browser_clear_highlights',
  description: 'Clear all element highlights from the page. Usually not needed since highlights auto-clear on next browser action.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};
