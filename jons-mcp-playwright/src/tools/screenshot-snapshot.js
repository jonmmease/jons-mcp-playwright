/**
 * browser_screenshot_snapshot tool
 *
 * Uses Google Gemini vision model to analyze screenshots and generate
 * an accessibility tree-like structure with bounding boxes. This enables
 * LLMs to interact with visual elements not represented in the DOM:
 * - Charts and data visualizations
 * - Canvas-rendered content
 * - Flowcharts and diagrams
 * - Complex graphics-heavy UIs
 */

export const schema = {
  name: 'browser_screenshot_snapshot',
  description: `Analyze a specific element using vision AI to generate an accessibility tree with bounding boxes.

**IMPORTANT**: This tool should only be used on:
- img elements (charts, graphs, diagrams, infographics)
- canvas elements (games, graphics apps, interactive visualizations)
- Cases where you have verified that browser_snapshot's accessibility tree is insufficient

Do NOT use this on entire pages or generic containers - use browser_snapshot instead.

Returns a hierarchical structure of visual elements with refs (v1, v2, ...) that can be used with:
- browser_click(ref="v1") - click on a vision-detected element
- browser_hover(ref="v1") - hover over an element
- browser_get_bounds(ref="v1") - get element bounds
- browser_take_screenshot(ref="v1") - crop screenshot to element
- browser_get_text(ref="v1") - get element's text content

**WARNING**: This tool sends screenshots to Google's Gemini API for analysis.
Do not use on pages containing sensitive information.

Vision refs (v1, v2, ...) are ephemeral - they expire after the configured TTL (default: 30s).
Taking a new screenshot_snapshot invalidates previous refs.

Requires:
- GEMINI_API_KEY environment variable
- uv installed (for running Python script)`,
  inputSchema: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Element ref (DOM ref like "e123" or vision ref like "v1") specifying the element to analyze. The screenshot is cropped to the element\'s bounding box before analysis. Should typically be an img or canvas element. Bounding boxes in the response are returned in absolute page coordinates.',
      },
      description: {
        type: 'string',
        description: 'Optional hint about the content (e.g., "This is a bar chart showing quarterly sales", "This is a flowchart diagram"). Helps Gemini produce more accurate results.',
      },
    },
    required: ['ref'],
  },
};
