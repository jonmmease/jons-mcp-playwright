/**
 * browser_locate_in_screenshot tool
 *
 * Uses Google Gemini vision model to find UI elements in screenshots
 * by natural language description and return their pixel coordinates.
 */

export const schema = {
  name: 'browser_locate_in_screenshot',
  description: `Locate a UI element in a screenshot by natural language description using vision AI.

Returns pixel coordinates (x, y) that can be used with browser_mouse_click_xy or browser_mouse_move_xy.

Requires:
- GEMINI_API_KEY environment variable
- uv installed (for running Python script)

Usage:
1. Take a screenshot with browser_take_screenshot
2. Call this tool with the screenshot URL and element description
3. Use returned coordinates with browser_mouse_click_xy to click the element`,
  inputSchema: {
    type: 'object',
    properties: {
      screenshotUrl: {
        type: 'string',
        description: 'The download URL from browser_take_screenshot (e.g., http://localhost:PORT/downloads/TOKEN/filename.png)',
      },
      description: {
        type: 'string',
        description: 'Natural language description of the element to locate (e.g., "the blue Submit button", "the search icon in the top right", "the login link")',
      },
      debug: {
        type: 'boolean',
        description: 'If true, preserve the annotated image and return its path for debugging (default: false)',
      },
    },
    required: ['screenshotUrl', 'description'],
  },
};
