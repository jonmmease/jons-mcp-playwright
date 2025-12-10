/**
 * EnhancedBackend - Wrapper around Playwright's BrowserServerBackend
 *
 * This class intercepts MCP tool calls to:
 * - Filter accessibility snapshots (maxDepth, listLimit)
 * - Add new tools (browser_get_image, browser_get_text, etc.)
 * - Handle saveToFile parameter
 * - Filter out developer tools by default
 */

import path from 'path';
import { schema as getImageSchema } from './tools/get-image.js';
import { schema as getTextSchema } from './tools/get-text.js';
import { schema as getTableSchema } from './tools/get-table.js';
import { schema as getBoundsSchema } from './tools/get-bounds.js';
import { highlightSchema, clearHighlightsSchema } from './tools/highlight.js';
import { schema as requestUploadSchema } from './tools/request-upload.js';
import { filterSnapshot, extractSubtree, estimateTokens, parseSnapshot, countElements } from './snapshot-filter.js';
import { SnapshotCache } from './snapshot-cache.js';
import { saveToFile } from './utils/file-output.js';
import { LocalhostServer } from './utils/localhost-server.js';

// Mouse tools that should trigger visual feedback
const MOUSE_CLICK_TOOLS = new Set([
  'browser_click',
  'browser_mouse_click_xy',
]);

const MOUSE_MOVE_TOOLS = new Set([
  'browser_hover',
  'browser_mouse_move_xy',
  'browser_mouse_drag_xy',
]);

// Keyboard tools that should trigger keystroke HUD
const KEYBOARD_TOOLS = new Set([
  'browser_type',
  'browser_press_key',
]);

// Developer tools hidden by default (see design.md)
const DEVELOPER_TOOLS = [
  'browser_install',
  'browser_generate_locator',
  'browser_start_tracing',
  'browser_stop_tracing',
  'browser_connect',
  // browser_verify_* pattern
];

// Default filtering values for snapshot-returning tools
// Adjust these to control token usage vs detail tradeoff
const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_LIST_LIMIT = 10;

// Tools that return snapshots via setIncludeSnapshot() and should have filtering params
const SNAPSHOT_TOOLS = new Set([
  'browser_navigate',
  'browser_navigate_back',
  'browser_click',
  'browser_type',
  'browser_hover',
  'browser_select_option',
  'browser_drag',
  'browser_press_key',
  'browser_mouse_click_xy',
  'browser_mouse_drag_xy',
  'browser_file_upload',
  'browser_handle_dialog',
  'browser_evaluate',
  'browser_wait_for',
  'browser_run_code',
  'browser_tabs',
]);

// Actions that should auto-clear highlights before executing
// These are user-facing actions that indicate the user is moving on
const HIGHLIGHT_CLEARING_ACTIONS = new Set([
  'browser_navigate',
  'browser_navigate_back',
  'browser_click',
  'browser_type',
  'browser_hover',
  'browser_select_option',
  'browser_drag',
  'browser_press_key',
  'browser_mouse_click_xy',
  'browser_mouse_move_xy',
  'browser_mouse_drag_xy',
  'browser_file_upload',
  'browser_handle_dialog',
  'browser_scroll',
  'browser_tab_new',
  'browser_tab_close',
  'browser_tab_select',
  'browser_close',
]);

// Our new tool schemas
const NEW_TOOLS = [
  getImageSchema,
  getTextSchema,
  getTableSchema,
  getBoundsSchema,
  highlightSchema,
  clearHighlightsSchema,
  requestUploadSchema,
];

/**
 * Check if a tool name is a developer tool
 * @param {string} name - Tool name
 * @returns {boolean}
 */
function isDeveloperTool(name) {
  if (DEVELOPER_TOOLS.includes(name)) return true;
  if (name.startsWith('browser_verify_')) return true;
  return false;
}

export class EnhancedBackend {
  /**
   * @param {import('./index.js').Config} config - Our enhanced config
   * @param {Object} innerBackend - The wrapped BrowserServerBackend instance
   */
  constructor(config, innerBackend) {
    this.config = config;
    this._inner = innerBackend;
    this._snapshotCache = new SnapshotCache(5000); // 5 second TTL
    this._activeHighlights = []; // Track highlighted elements for cleanup
    this._highlightStylesInjected = false; // Track if CSS has been injected
    this._localhostServer = null; // Lazy-initialized localhost server for serving downloads
  }

  /**
   * Initialize the backend
   * @param {Object} clientInfo - MCP client info
   */
  async initialize(clientInfo) {
    if (this._inner.initialize) {
      await this._inner.initialize(clientInfo);
    }
  }

  /**
   * List available tools
   * Filters developer tools and adds our new tools
   * @returns {Promise<Array>} Array of MCP tool definitions
   */
  async listTools() {
    // Get base tools from inner backend
    let tools = await this._inner.listTools();

    // Filter out developer tools unless explicitly included
    if (!this.config.includeDeveloperTools) {
      tools = tools.filter(tool => !isDeveloperTool(tool.name));
    }

    // Extend browser_snapshot schema with our additional parameters
    const snapshotTool = tools.find(t => t.name === 'browser_snapshot');
    if (snapshotTool && snapshotTool.inputSchema) {
      snapshotTool.inputSchema = {
        ...snapshotTool.inputSchema,
        properties: {
          ...snapshotTool.inputSchema.properties,
          ref: {
            type: 'string',
            description: 'Element ref to use as the root of the snapshot. If provided, only the subtree under this element is returned, avoiding truncation of deeply nested content.',
          },
          maxDepth: {
            type: 'number',
            description: 'Maximum tree depth to include (default: 5). Set to a higher value to see deeper content, or null for no limit.',
          },
          listLimit: {
            type: 'number',
            description: 'Maximum number of items to include per list (default: 10). Truncated lists show "N more items".',
          },
          saveToFile: {
            type: 'boolean',
            description: 'If true, save snapshot to a temp file and return the path instead of inline content. Useful for large snapshots.',
          },
        },
      };
    }

    // Extend all snapshot-returning tools with maxDepth and listLimit parameters
    for (const tool of tools) {
      if (SNAPSHOT_TOOLS.has(tool.name) && tool.inputSchema) {
        tool.inputSchema = {
          ...tool.inputSchema,
          properties: {
            ...tool.inputSchema.properties,
            maxDepth: {
              type: 'number',
              description: `Maximum tree depth in returned snapshot (default: ${DEFAULT_MAX_DEPTH}). Set higher for more detail, or null for no limit.`,
            },
            listLimit: {
              type: 'number',
              description: `Maximum items per list in returned snapshot (default: ${DEFAULT_LIST_LIMIT}). Truncated lists show "N more items".`,
            },
          },
        };
      }
    }

    // Extend browser_take_screenshot with showCursor parameter
    const screenshotTool = tools.find(t => t.name === 'browser_take_screenshot');
    if (screenshotTool && screenshotTool.inputSchema) {
      screenshotTool.inputSchema = {
        ...screenshotTool.inputSchema,
        properties: {
          ...screenshotTool.inputSchema.properties,
          showCursor: {
            type: 'boolean',
            description: 'If true, include the visual feedback cursor in the screenshot. Default: false (clean screenshots). Useful for debugging click positions.',
          },
        },
      };
    }

    // Extend browser_file_upload with fileTokens parameter
    const fileUploadTool = tools.find(t => t.name === 'browser_file_upload');
    if (fileUploadTool && fileUploadTool.inputSchema) {
      fileUploadTool.inputSchema = {
        ...fileUploadTool.inputSchema,
        properties: {
          ...fileUploadTool.inputSchema.properties,
          fileTokens: {
            type: 'array',
            items: { type: 'string' },
            description: 'File tokens from browser_request_upload. Use this when uploading files from a sandboxed environment. Get tokens by calling browser_request_upload first, POSTing your file, then using the returned fileToken here.',
          },
        },
      };
      // Update description to mention fileTokens
      fileUploadTool.description = (fileUploadTool.description || '') +
        ' For sandboxed environments, use fileTokens parameter with tokens from browser_request_upload.';
    }

    // Add our new tools
    for (const schema of NEW_TOOLS) {
      tools.push({
        name: schema.name,
        description: schema.description,
        inputSchema: schema.inputSchema,
        annotations: {
          title: schema.name.replace('browser_', '').replace(/_/g, ' '),
          readOnlyHint: true,
          openWorldHint: true,
        },
      });
    }

    return tools;
  }

  /**
   * Enhance error messages for common browser errors
   * @param {Error} error - Original error
   * @returns {Object} MCP error response with helpful message
   */
  _enhanceBrowserError(error) {
    const message = error.message || String(error);

    // Check for "Browser is already in use" error
    if (message.includes('Browser is already in use') || message.includes('ProcessSingleton')) {
      const profileDir = process.platform === 'darwin'
        ? '~/Library/Caches/ms-playwright/mcp-chrome'
        : process.platform === 'win32'
          ? '%LOCALAPPDATA%/ms-playwright/mcp-chrome'
          : '~/.cache/ms-playwright/mcp-chrome';

      return {
        content: [{
          type: 'text',
          text: `Browser profile is locked. This usually happens after a crash or if another instance is running.

**To fix:**
1. Close any Chrome windows opened by Playwright MCP
2. If no windows are open, delete the stale lock files:
   \`rm -f ${profileDir}/Singleton*\`
3. Or use \`--isolated\` flag to avoid persistent profiles entirely

Original error: ${message}`,
        }],
        isError: true,
      };
    }

    // Return generic error for other cases
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }

  /**
   * Show visual feedback (cursor movement, click, keystroke)
   * @param {'moveCursor'|'showClick'|'showKey'|'showText'} type - Feedback type
   * @param {Object} params - Parameters for the feedback
   * @returns {Promise<void>}
   */
  async _showVisualFeedback(type, params) {
    // Skip if visual feedback is disabled
    if (process.env.JONS_MCP_SHOW_ACTIONS === 'off') {
      return;
    }

    try {
      let code;
      switch (type) {
        case 'moveCursor':
          code = `window.__mcpVisualFeedback?.moveCursor(${params.x}, ${params.y})`;
          break;
        case 'showClick':
          code = `window.__mcpVisualFeedback?.showClick(${params.x}, ${params.y})`;
          break;
        case 'showKey':
          // Escape the key for safe embedding in JS string
          const escapedKey = params.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          code = `window.__mcpVisualFeedback?.showKey('${escapedKey}')`;
          break;
        case 'showText':
          // Escape the text for safe embedding in JS string
          const escapedText = params.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
          code = `window.__mcpVisualFeedback?.showText('${escapedText}')`;
          break;
        default:
          return;
      }

      await this._inner.callTool('browser_evaluate', { function: `() => { ${code} }` });
    } catch (error) {
      // Silently ignore errors - visual feedback is non-critical
      // This can fail if page navigated, iframe context, etc.
    }
  }

  /**
   * Trigger visual feedback for keyboard and XY-based mouse tools
   * @param {string} toolName - Name of the tool that was called
   * @param {Object} args - Tool arguments
   * @returns {Promise<void>}
   */
  async _triggerVisualFeedback(toolName, args) {
    // Skip if visual feedback is disabled
    if (process.env.JONS_MCP_SHOW_ACTIONS === 'off') {
      return;
    }

    // Handle mouse move tools (XY-based only, ref-based hover doesn't work reliably)
    if (MOUSE_MOVE_TOOLS.has(toolName)) {
      let coords = null;

      if (toolName === 'browser_mouse_move_xy') {
        coords = { x: args.x, y: args.y };
      } else if (toolName === 'browser_mouse_drag_xy') {
        coords = { x: args.endX, y: args.endY };
      }

      if (coords) {
        await this._showVisualFeedback('moveCursor', coords);
      }
      return;
    }

    // Handle keyboard tools
    if (KEYBOARD_TOOLS.has(toolName)) {
      if (toolName === 'browser_press_key') {
        const key = args.key || '';
        await this._showVisualFeedback('showKey', { key });
      } else if (toolName === 'browser_type') {
        const text = args.text || '';
        await this._showVisualFeedback('showText', { text });
      }
      return;
    }
  }

  /**
   * Handle browser_take_screenshot with overlay hide/show
   * @param {Object} args - Tool arguments (may include showCursor)
   * @param {Function} progress - Progress callback
   * @returns {Promise<Object>} Screenshot result
   */
  async _handleScreenshot(args, progress) {
    const { showCursor = false, ...screenshotArgs } = args;

    // Only hide/show if visual feedback is enabled
    const visualFeedbackEnabled = process.env.JONS_MCP_SHOW_ACTIONS !== 'off';

    // Hide overlay before screenshot (unless showCursor is true)
    if (visualFeedbackEnabled && !showCursor) {
      try {
        await this._inner.callTool('browser_evaluate', {
          function: `() => { window.__mcpVisualFeedback?.hide() }`,
        });
      } catch {
        // Silently ignore - overlay may not exist
      }
    }

    // Take screenshot
    let result;
    try {
      result = await this._inner.callTool('browser_take_screenshot', screenshotArgs, progress);
    } finally {
      // Always restore overlay after screenshot (unless showCursor is true)
      if (visualFeedbackEnabled && !showCursor) {
        try {
          await this._inner.callTool('browser_evaluate', {
            function: `() => { window.__mcpVisualFeedback?.show() }`,
          });
        } catch {
          // Silently ignore - overlay may not exist
        }
      }
    }

    return result;
  }

  /**
   * Call a tool
   * Intercepts browser_snapshot for filtering, handles new tools
   * @param {string} name - Tool name
   * @param {Object} args - Tool arguments
   * @param {Function} progress - Progress callback (optional)
   * @returns {Promise<Object>} Tool result
   */
  async callTool(name, args = {}, progress) {
    let result;

    // Handle our new tools
    if (name === 'browser_get_image') {
      result = await this._handleGetImage(args);
      return this._postProcessResult(result);
    }
    if (name === 'browser_get_text') {
      result = await this._handleGetText(args);
      return this._postProcessResult(result);
    }
    if (name === 'browser_get_table') {
      result = await this._handleGetTable(args);
      return this._postProcessResult(result);
    }
    if (name === 'browser_get_bounds') {
      result = await this._handleGetBounds(args);
      return this._postProcessResult(result);
    }
    if (name === 'browser_highlight') {
      result = await this._handleHighlight(args);
      return this._postProcessResult(result);
    }
    if (name === 'browser_clear_highlights') {
      result = await this._handleClearHighlights();
      return this._postProcessResult(result);
    }
    if (name === 'browser_request_upload') {
      result = await this._handleRequestUpload(args);
      return this._postProcessResult(result);
    }
    if (name === 'browser_take_screenshot') {
      result = await this._handleScreenshot(args, progress);
      return this._postProcessResult(result);
    }

    // Auto-clear highlights before browser actions that indicate user is moving on
    if (HIGHLIGHT_CLEARING_ACTIONS.has(name) && this._activeHighlights.length > 0) {
      await this._clearHighlightsInternal();
    }

    // Intercept browser_snapshot for filtering
    if (name === 'browser_snapshot') {
      result = await this._handleSnapshot(args, progress);
      return this._postProcessResult(result);
    }

    // Intercept browser_click to show visual feedback before the click
    // Must be before SNAPSHOT_TOOLS check since browser_click is in that set
    if (name === 'browser_click' && args.ref && process.env.JONS_MCP_SHOW_ACTIONS !== 'off') {
      result = await this._handleClickWithFeedback(args, progress);
      return this._postProcessResult(result);
    }

    // Intercept browser_hover to show visual feedback (scroll + cursor)
    // Must be before SNAPSHOT_TOOLS check since browser_hover is in that set
    if (name === 'browser_hover' && args.ref && process.env.JONS_MCP_SHOW_ACTIONS !== 'off') {
      result = await this._handleHoverWithFeedback(args, progress);
      return this._postProcessResult(result);
    }

    // Intercept browser_mouse_click_xy to show cursor + ripple before click
    // Must be before SNAPSHOT_TOOLS check since it's in that set
    if (name === 'browser_mouse_click_xy' && process.env.JONS_MCP_SHOW_ACTIONS !== 'off') {
      const coords = { x: args.x, y: args.y };
      // Show cursor first, pause so user sees where click will happen
      await this._showVisualFeedback('moveCursor', coords);
      await new Promise(r => setTimeout(r, 300));
      // Fire-and-forget ripple, then click
      this._showVisualFeedback('showClick', coords).catch(() => {});
      result = await this._handleSnapshotTool(name, args, progress);
      return this._postProcessResult(result);
    }

    // Intercept browser_mouse_drag_xy to show cursor animation from start to end
    // Must be before SNAPSHOT_TOOLS check since it's in that set
    if (name === 'browser_mouse_drag_xy' && process.env.JONS_MCP_SHOW_ACTIONS !== 'off') {
      // Show cursor at start position (must await so it actually appears)
      await this._showVisualFeedback('moveCursor', { x: args.startX, y: args.startY });
      // Wait so user sees the start position
      await new Promise(r => setTimeout(r, 500));
      // Fire-and-forget cursor move to end position
      this._showVisualFeedback('moveCursor', { x: args.endX, y: args.endY }).catch(() => {});
      // Small delay for animation (CSS transition is 50ms)
      await new Promise(r => setTimeout(r, 100));
      result = await this._handleSnapshotTool(name, args, progress);
      return this._postProcessResult(result);
    }

    // Intercept browser_drag to show cursor animation from source to target element
    // Must be before SNAPSHOT_TOOLS check since it's in that set
    if (name === 'browser_drag' && args.startRef && args.endRef && process.env.JONS_MCP_SHOW_ACTIONS !== 'off') {
      result = await this._handleDragWithFeedback(args, progress);
      return this._postProcessResult(result);
    }

    // Intercept all snapshot-returning tools for filtering
    if (SNAPSHOT_TOOLS.has(name)) {
      result = await this._handleSnapshotTool(name, args, progress);
      return this._postProcessResult(result);
    }

    // Pass through to inner backend with error enhancement
    try {
      // Trigger visual feedback BEFORE action for browser_mouse_move_xy
      if (name === 'browser_mouse_move_xy' && process.env.JONS_MCP_SHOW_ACTIONS !== 'off') {
        // Fire-and-forget cursor move
        this._showVisualFeedback('moveCursor', { x: args.x, y: args.y }).catch(() => {});
      }

      result = await this._inner.callTool(name, args, progress);

      // Trigger visual feedback AFTER action for keyboard tools
      if (!result.isError && KEYBOARD_TOOLS.has(name)) {
        this._triggerVisualFeedback(name, args).catch(() => {});
      }

      return this._postProcessResult(result);
    } catch (error) {
      return this._enhanceBrowserError(error);
    }
  }

  /**
   * Handle browser_click with visual feedback
   * Takes a snapshot first to establish ref context, gets element bounds, shows animation, then clicks
   * @param {Object} args - Tool arguments
   * @param {Function} progress - Progress callback
   * @returns {Promise<Object>} Click result
   */
  async _handleClickWithFeedback(args, progress) {
    try {
      // Step 1: Take a snapshot to establish ref context (using inner to avoid filtering overhead)
      await this._inner.callTool('browser_snapshot', {});

      // Step 2: Get element center coordinates
      const boundsResult = await this._inner.callTool('browser_evaluate', {
        ref: args.ref,
        element: args.element || 'target element',
        function: `(element) => {
          const rect = element.getBoundingClientRect();
          return JSON.stringify({
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2)
          });
        }`,
      });

      // Extract coordinates from result - the result is in markdown format like:
      // ### Result\n"{\"x\":508,\"y\":33}"\n\n### Ran Playwright code...
      const resultText = boundsResult?.content?.[0]?.text || '';

      // Step 3: Scroll element into view so user can see the click
      await this._inner.callTool('browser_evaluate', {
        ref: args.ref,
        element: args.element || 'target element',
        function: `(element) => {
          element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        }`,
      });

      // Step 4: Get coordinates AFTER scrolling (they may have changed)
      const boundsAfterScroll = await this._inner.callTool('browser_evaluate', {
        ref: args.ref,
        element: args.element || 'target element',
        function: `(element) => {
          const rect = element.getBoundingClientRect();
          return JSON.stringify({
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2)
          });
        }`,
      });

      const scrolledResultText = boundsAfterScroll?.content?.[0]?.text || '';
      const resultMatch = scrolledResultText.match(/### Result\n"(.+?)"\n/s);
      if (resultMatch && !boundsAfterScroll.isError) {
        try {
          const jsonStr = resultMatch[1].replace(/\\"/g, '"');
          const clickCoords = JSON.parse(jsonStr);

          // Step 5: Show cursor at click location
          await this._showVisualFeedback('moveCursor', clickCoords);

          // Step 6: Wait so user can see where the click will happen
          await new Promise(r => setTimeout(r, 300));

          // Step 7: Show click ripple (fire and forget - don't wait for browser_evaluate round trip)
          this._showVisualFeedback('showClick', clickCoords).catch(() => {});
        } catch (e) {
          // Failed to parse bounds, continue without animation
        }
      }

      // Step 8: Perform the actual click
      return await this._inner.callTool('browser_click', args, progress);
    } catch (error) {
      return this._enhanceBrowserError(error);
    }
  }

  /**
   * Handle browser_hover with visual feedback
   * Takes a snapshot first to establish ref context, scrolls element into view, shows cursor, then hovers
   * @param {Object} args - Tool arguments
   * @param {Function} progress - Progress callback
   * @returns {Promise<Object>} Hover result
   */
  async _handleHoverWithFeedback(args, progress) {
    try {
      // Step 1: Take a snapshot to establish ref context
      await this._inner.callTool('browser_snapshot', {});

      // Step 2: Scroll element into view and get its coordinates
      const scrollAndBoundsResult = await this._inner.callTool('browser_evaluate', {
        ref: args.ref,
        element: args.element || 'target element',
        function: `(element) => {
          element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
          const rect = element.getBoundingClientRect();
          return JSON.stringify({
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2)
          });
        }`,
      });

      // Step 3: Parse coordinates and show cursor
      const resultText = scrollAndBoundsResult?.content?.[0]?.text || '';
      const resultMatch = resultText.match(/### Result\n"(.+?)"\n/s);

      if (resultMatch && !scrollAndBoundsResult.isError) {
        try {
          const jsonStr = resultMatch[1].replace(/\\"/g, '"');
          const coords = JSON.parse(jsonStr);

          // Show cursor at hover location (fire and forget - don't wait for browser_evaluate round trip)
          this._showVisualFeedback('moveCursor', coords).catch(() => {});
        } catch (e) {
          // Failed to parse bounds, continue without animation
        }
      }

      // Step 4: Perform the actual hover
      return await this._inner.callTool('browser_hover', args, progress);
    } catch (error) {
      return this._enhanceBrowserError(error);
    }
  }

  /**
   * Handle browser_drag with visual feedback
   * Takes a snapshot first, scrolls source into view, shows cursor at source,
   * animates to target, then performs the drag
   * @param {Object} args - Tool arguments (startRef, endRef, startElement, endElement)
   * @param {Function} progress - Progress callback
   * @returns {Promise<Object>} Drag result
   */
  async _handleDragWithFeedback(args, progress) {
    try {
      // Step 1: Take a snapshot to establish ref context
      await this._inner.callTool('browser_snapshot', {});

      // Step 2: Scroll source element into view and get its center coordinates
      const startBoundsResult = await this._inner.callTool('browser_evaluate', {
        ref: args.startRef,
        element: args.startElement || 'source element',
        function: `(element) => {
          element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
          const rect = element.getBoundingClientRect();
          return JSON.stringify({
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2)
          });
        }`,
      });

      // Step 3: Parse start coordinates and show cursor
      const startResultText = startBoundsResult?.content?.[0]?.text || '';
      const startResultMatch = startResultText.match(/### Result\n"(.+?)"\n/s);
      let startCoords = null;

      if (startResultMatch && !startBoundsResult.isError) {
        try {
          const jsonStr = startResultMatch[1].replace(/\\"/g, '"');
          startCoords = JSON.parse(jsonStr);
          // Show cursor at source location
          await this._showVisualFeedback('moveCursor', startCoords);
          // Wait so user sees where drag starts
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          // Failed to parse bounds, continue without animation
        }
      }

      // Step 4: Get target element coordinates (may need to scroll)
      const endBoundsResult = await this._inner.callTool('browser_evaluate', {
        ref: args.endRef,
        element: args.endElement || 'target element',
        function: `(element) => {
          element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
          const rect = element.getBoundingClientRect();
          return JSON.stringify({
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2)
          });
        }`,
      });

      // Step 5: Parse end coordinates and animate cursor
      const endResultText = endBoundsResult?.content?.[0]?.text || '';
      const endResultMatch = endResultText.match(/### Result\n"(.+?)"\n/s);

      if (endResultMatch && !endBoundsResult.isError) {
        try {
          const jsonStr = endResultMatch[1].replace(/\\"/g, '"');
          const endCoords = JSON.parse(jsonStr);
          // Animate cursor to target (fire-and-forget)
          this._showVisualFeedback('moveCursor', endCoords).catch(() => {});
          // Small delay for animation
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          // Failed to parse bounds, continue without animation
        }
      }

      // Step 6: Perform the actual drag
      return await this._inner.callTool('browser_drag', args, progress);
    } catch (error) {
      return this._enhanceBrowserError(error);
    }
  }

  /**
   * Handle browser_snapshot with filtering
   * @param {Object} args - Tool arguments
   * @param {Function} progress - Progress callback
   * @returns {Promise<Object>} Filtered snapshot result
   */
  async _handleSnapshot(args, progress) {
    const { ref, maxDepth, listLimit, saveToFile: shouldSaveToFile } = args;

    // Determine effective filtering options
    const effectiveMaxDepth = maxDepth !== undefined ? maxDepth : this.config.maxDepth;
    const effectiveListLimit = listLimit !== undefined ? listLimit : this.config.listLimit;

    let yamlSnapshot;

    // If ref is provided, try to use cached snapshot
    if (ref) {
      const cached = this._snapshotCache.get();
      if (cached) {
        // Extract subtree from cache
        const subtree = extractSubtree(cached, ref);
        if (subtree) {
          yamlSnapshot = subtree;
        } else {
          return {
            content: [{ type: 'text', text: `Element with ref="${ref}" not found in cached snapshot. The page may have changed. Try calling browser_snapshot() without ref to refresh.` }],
            isError: true,
          };
        }
      } else {
        // Cache expired or empty - fetch fresh snapshot first
        const freshResult = await this._inner.callTool('browser_snapshot', {}, progress);
        const freshYaml = this._extractYamlFromResult(freshResult);
        if (freshYaml) {
          this._snapshotCache.set(freshYaml);
          const subtree = extractSubtree(freshYaml, ref);
          if (subtree) {
            yamlSnapshot = subtree;
          } else {
            return {
              content: [{ type: 'text', text: `Element with ref="${ref}" not found in snapshot.` }],
              isError: true,
            };
          }
        } else {
          // Failed to get snapshot, return original result
          return freshResult;
        }
      }
    } else {
      // No ref - fetch fresh snapshot
      const result = await this._inner.callTool('browser_snapshot', {}, progress);
      const extractedYaml = this._extractYamlFromResult(result);
      if (extractedYaml) {
        yamlSnapshot = extractedYaml;
        // Cache the full snapshot
        this._snapshotCache.set(yamlSnapshot);
      } else {
        // Failed to extract YAML, return original result
        return result;
      }
    }

    // Apply filtering
    const filteredYaml = filterSnapshot(yamlSnapshot, {
      maxDepth: effectiveMaxDepth,
      listLimit: effectiveListLimit,
    });

    // Calculate stats
    const tree = parseSnapshot(filteredYaml);
    const elementCount = countElements(tree);
    const tokenEstimate = estimateTokens(filteredYaml);

    // Handle saveToFile
    if (shouldSaveToFile) {
      try {
        const { path, bytes } = await saveToFile(filteredYaml, {
          type: 'snapshot',
          ref: ref || null,
          extension: 'yaml',
          tempDir: this.config.tempDir,
        });
        return {
          content: [{
            type: 'text',
            text: `Snapshot saved to file.\n\nPath: ${path}\nBytes: ${bytes}\nTokens (est): ${tokenEstimate}\nElements: ${elementCount}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to save snapshot to file: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Check for truncation and build response
    const hasDepthTruncation = filteredYaml.includes('▶ deeper content');
    const hasListTruncation = /▶ \d+ more items/.test(filteredYaml);

    let response = `\`\`\`yaml\n${filteredYaml}\n\`\`\``;

    // Add guidance if truncation occurred
    if (hasDepthTruncation || hasListTruncation) {
      const hints = [];

      // Recommend ref parameter first (doesn't increase result size)
      if (hasDepthTruncation) {
        hints.push(`- **Recommended:** Use \`ref\` parameter to focus on a specific element's subtree`);
      }

      // Other options with warnings about increased size
      if (hasDepthTruncation) {
        hints.push(`- Increase \`maxDepth\` (current: ${effectiveMaxDepth}) — warning: increases result size`);
      }

      if (hasListTruncation) {
        hints.push(`- Increase \`listLimit\` (current: ${effectiveListLimit}) — warning: increases result size`);
      }

      response += `\n\n**Note:** Some content was truncated (indicated by ▶). To see more:\n${hints.join('\n')}`;
    }

    return {
      content: [{
        type: 'text',
        text: response,
      }],
    };
  }

  /**
   * Handle snapshot-returning tools (navigate, click, type, etc.) with filtering
   * @param {string} name - Tool name
   * @param {Object} args - Tool arguments (may include maxDepth, listLimit)
   * @param {Function} progress - Progress callback
   * @returns {Promise<Object>} Filtered result
   */
  async _handleSnapshotTool(name, args, progress) {
    const { maxDepth, listLimit, fileTokens, ...toolArgs } = args;

    // For browser_file_upload, resolve fileTokens to local paths
    if (name === 'browser_file_upload' && fileTokens && fileTokens.length > 0) {
      const resolveResult = await this._resolveFileTokens(fileTokens);
      if (resolveResult.error) {
        return {
          content: [{ type: 'text', text: resolveResult.error }],
          isError: true,
        };
      }
      // Merge resolved paths with any existing paths
      toolArgs.paths = [...(toolArgs.paths || []), ...resolveResult.paths];
    }

    // Call inner backend with original args (minus our filter params)
    const result = await this._inner.callTool(name, toolArgs, progress);

    // If error or no content, return as-is
    if (result.isError || !result.content) {
      return result;
    }

    // Trigger visual feedback for mouse and keyboard tools (non-blocking)
    this._triggerVisualFeedback(name, toolArgs).catch(() => {});

    // Extract YAML snapshot from result
    const yamlSnapshot = this._extractYamlFromResult(result);
    if (!yamlSnapshot) {
      // No snapshot in result, return original
      return result;
    }

    // Determine effective filtering options
    const effectiveMaxDepth = maxDepth !== undefined ? maxDepth : DEFAULT_MAX_DEPTH;
    const effectiveListLimit = listLimit !== undefined ? listLimit : DEFAULT_LIST_LIMIT;

    // Apply filtering
    const filteredYaml = filterSnapshot(yamlSnapshot, {
      maxDepth: effectiveMaxDepth,
      listLimit: effectiveListLimit,
    });

    // Check for truncation
    const hasDepthTruncation = filteredYaml.includes('▶ deeper content');
    const hasListTruncation = /▶ \d+ more items/.test(filteredYaml);

    // Build the filtered response
    let responseText = `\`\`\`yaml\n${filteredYaml}\n\`\`\``;

    // Add guidance if truncation occurred
    if (hasDepthTruncation || hasListTruncation) {
      const hints = [];

      if (hasDepthTruncation) {
        hints.push(`- Use \`browser_snapshot(ref=...)\` to focus on a specific element's subtree`);
        hints.push(`- Or increase \`maxDepth\` parameter (current: ${effectiveMaxDepth})`);
      }

      if (hasListTruncation) {
        hints.push(`- Increase \`listLimit\` parameter (current: ${effectiveListLimit})`);
      }

      responseText += `\n\n**Note:** Some content was truncated. To see more:\n${hints.join('\n')}`;
    }

    // Replace the YAML in the original response with filtered version
    // Preserve any non-YAML content (like code generation hints)
    const newContent = result.content.map(part => {
      if (part.type === 'text' && part.text) {
        // Replace the YAML code block
        const replaced = part.text.replace(
          /```yaml\s*\n[\s\S]*?\n?```/,
          responseText
        );
        // If replacement happened, return it
        if (replaced !== part.text) {
          return { type: 'text', text: replaced };
        }
        // If no code block found but starts with dash (raw YAML), replace entirely
        if (part.text.trim().startsWith('-')) {
          return { type: 'text', text: responseText };
        }
      }
      return part;
    });

    return {
      content: newContent,
      isError: result.isError,
    };
  }

  /**
   * Extract YAML content from a tool result
   * @param {Object} result - Tool result from inner backend
   * @returns {string|null} - Extracted YAML or null
   */
  _extractYamlFromResult(result) {
    if (!result || !result.content) {
      return null;
    }

    for (const part of result.content) {
      if (part.type === 'text' && part.text) {
        // Look for YAML in code blocks
        const match = part.text.match(/```yaml\s*\n([\s\S]*?)\n?```/);
        if (match) {
          return match[1].trimEnd();
        }
        // If no code block, treat the whole text as YAML (if it looks like YAML)
        if (part.text.trim().startsWith('-')) {
          return part.text.trim();
        }
      }
    }

    return null;
  }

  /**
   * Handle browser_get_image tool
   * @param {Object} args - { ref, saveToFile? }
   * @returns {Promise<Object>} Image data or file path
   */
  async _handleGetImage(args) {
    const { ref, saveToFile: shouldSaveToFile } = args;

    if (!ref) {
      return {
        content: [{ type: 'text', text: 'browser_get_image requires a ref parameter' }],
        isError: true,
      };
    }

    // Use browser_evaluate to get image info
    const evalResult = await this._inner.callTool('browser_evaluate', {
      ref,
      element: 'image element',
      function: `(element) => {
        if (element.tagName !== 'IMG') {
          return { error: 'Element is not an <img> tag, it is: ' + element.tagName };
        }
        // Get best source URL (prefer srcset if available)
        let url = element.src;
        if (element.srcset) {
          const sources = element.srcset.split(',').map(s => s.trim().split(' '));
          // Find highest resolution
          let bestSource = sources[0];
          for (const source of sources) {
            const w1 = parseInt(bestSource[1] || '0');
            const w2 = parseInt(source[1] || '0');
            if (w2 > w1) bestSource = source;
          }
          if (bestSource[0]) url = bestSource[0];
        }
        return {
          url,
          naturalWidth: element.naturalWidth,
          naturalHeight: element.naturalHeight,
          alt: element.alt || ''
        };
      }`,
    });

    // Parse the result
    const resultText = this._extractTextFromResult(evalResult);
    if (!resultText) {
      return {
        content: [{ type: 'text', text: 'Failed to evaluate image element' }],
        isError: true,
      };
    }

    let imgInfo;
    try {
      imgInfo = JSON.parse(resultText);
    } catch {
      return {
        content: [{ type: 'text', text: `Invalid response from browser: ${resultText}` }],
        isError: true,
      };
    }

    if (imgInfo.error) {
      return {
        content: [{ type: 'text', text: imgInfo.error }],
        isError: true,
      };
    }

    // For now, return image URL and metadata without fetching the actual image data
    // (fetching binary data through MCP is complex and would require additional handling)
    const response = `Image found:
- URL: ${imgInfo.url}
- Dimensions: ${imgInfo.naturalWidth}x${imgInfo.naturalHeight}
- Alt text: ${imgInfo.alt || '(none)'}

To download this image, use browser_navigate to go to the URL or use the URL in your response.`;

    if (shouldSaveToFile) {
      try {
        const { path, bytes } = await saveToFile(response, {
          type: 'image',
          ref,
          extension: 'txt',
          tempDir: this.config.tempDir,
        });
        return {
          content: [{ type: 'text', text: `Image info saved to: ${path} (${bytes} bytes)` }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to save: ${error.message}` }],
          isError: true,
        };
      }
    }

    return {
      content: [{ type: 'text', text: response }],
    };
  }

  /**
   * Handle browser_get_text tool
   * @param {Object} args - { ref, saveToFile? }
   * @returns {Promise<Object>} Text content or file path
   */
  async _handleGetText(args) {
    const { ref, saveToFile: shouldSaveToFile } = args;

    if (!ref) {
      return {
        content: [{ type: 'text', text: 'browser_get_text requires a ref parameter' }],
        isError: true,
      };
    }

    // Use browser_evaluate to get text content
    const evalResult = await this._inner.callTool('browser_evaluate', {
      ref,
      element: 'text element',
      function: `(element) => {
        // For form fields, use value; for others, use innerText
        const tagName = element.tagName.toLowerCase();
        let text;
        if (tagName === 'input' || tagName === 'textarea') {
          text = element.value || '';
        } else {
          text = element.innerText || element.textContent || '';
        }
        return {
          text: text,
          wordCount: text.split(/\\s+/).filter(w => w.length > 0).length,
          charCount: text.length
        };
      }`,
    });

    // Parse the result
    const resultText = this._extractTextFromResult(evalResult);
    if (!resultText) {
      return {
        content: [{ type: 'text', text: 'Failed to evaluate text element' }],
        isError: true,
      };
    }

    let textInfo;
    try {
      textInfo = JSON.parse(resultText);
    } catch {
      return {
        content: [{ type: 'text', text: `Invalid response from browser: ${resultText}` }],
        isError: true,
      };
    }

    if (shouldSaveToFile) {
      try {
        const { path, bytes } = await saveToFile(textInfo.text, {
          type: 'text',
          ref,
          extension: 'txt',
          tempDir: this.config.tempDir,
        });
        return {
          content: [{
            type: 'text',
            text: `Text saved to: ${path}\nBytes: ${bytes}\nWords: ${textInfo.wordCount}\nCharacters: ${textInfo.charCount}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to save: ${error.message}` }],
          isError: true,
        };
      }
    }

    return {
      content: [{
        type: 'text',
        text: `Text content (${textInfo.wordCount} words, ${textInfo.charCount} chars):\n\n${textInfo.text}`,
      }],
    };
  }

  /**
   * Handle browser_get_table tool
   * @param {Object} args - { ref, saveToFile? }
   * @returns {Promise<Object>} Table markdown or file path
   */
  async _handleGetTable(args) {
    const { ref, saveToFile: shouldSaveToFile } = args;

    if (!ref) {
      return {
        content: [{ type: 'text', text: 'browser_get_table requires a ref parameter' }],
        isError: true,
      };
    }

    // Use browser_evaluate to extract table data
    const evalResult = await this._inner.callTool('browser_evaluate', {
      ref,
      element: 'table element',
      function: `(element) => {
        if (element.tagName !== 'TABLE') {
          return { error: 'Element is not a <table>, it is: ' + element.tagName };
        }

        const headers = [];
        const rows = [];

        // Get headers from thead or first row
        const thead = element.querySelector('thead');
        if (thead) {
          const ths = thead.querySelectorAll('th');
          ths.forEach(th => headers.push(th.innerText.trim()));
        }

        // Get rows from tbody
        const tbody = element.querySelector('tbody') || element;
        const trs = tbody.querySelectorAll('tr');
        trs.forEach((tr, i) => {
          // Skip first row if it's in thead
          if (thead && tr.closest('thead')) return;

          // If no headers yet and first row has th cells, use as headers
          if (headers.length === 0 && i === 0) {
            const ths = tr.querySelectorAll('th');
            if (ths.length > 0) {
              ths.forEach(th => headers.push(th.innerText.trim()));
              return;
            }
          }

          const cells = [];
          tr.querySelectorAll('td, th').forEach(cell => {
            cells.push(cell.innerText.trim().replace(/\\n/g, ' '));
          });
          if (cells.length > 0) rows.push(cells);
        });

        return { headers, rows };
      }`,
    });

    // Parse the result
    const resultText = this._extractTextFromResult(evalResult);
    if (!resultText) {
      return {
        content: [{ type: 'text', text: 'Failed to evaluate table element' }],
        isError: true,
      };
    }

    let tableData;
    try {
      tableData = JSON.parse(resultText);
    } catch {
      return {
        content: [{ type: 'text', text: `Invalid response from browser: ${resultText}` }],
        isError: true,
      };
    }

    if (tableData.error) {
      return {
        content: [{ type: 'text', text: tableData.error }],
        isError: true,
      };
    }

    // Convert to markdown
    let markdown = '';
    const { headers, rows } = tableData;

    if (headers.length > 0) {
      markdown += '| ' + headers.join(' | ') + ' |\n';
      markdown += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
    }

    for (const row of rows) {
      markdown += '| ' + row.join(' | ') + ' |\n';
    }

    if (shouldSaveToFile) {
      try {
        const { path, bytes } = await saveToFile(markdown, {
          type: 'table',
          ref,
          extension: 'md',
          tempDir: this.config.tempDir,
        });
        return {
          content: [{
            type: 'text',
            text: `Table saved to: ${path}\nRows: ${rows.length}\nColumns: ${headers.length || (rows[0]?.length || 0)}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to save: ${error.message}` }],
          isError: true,
        };
      }
    }

    return {
      content: [{
        type: 'text',
        text: `Table (${rows.length} rows):\n\n${markdown}`,
      }],
    };
  }

  /**
   * Handle browser_get_bounds tool
   * @param {Object} args - { ref }
   * @returns {Promise<Object>} Element bounds
   */
  async _handleGetBounds(args) {
    const { ref } = args;

    if (!ref) {
      return {
        content: [{ type: 'text', text: 'browser_get_bounds requires a ref parameter' }],
        isError: true,
      };
    }

    // Use browser_evaluate to get bounding rect
    const evalResult = await this._inner.callTool('browser_evaluate', {
      ref,
      element: 'target element',
      function: `(element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          centerX: rect.x + rect.width / 2,
          centerY: rect.y + rect.height / 2
        };
      }`,
    });

    // Parse the result
    const resultText = this._extractTextFromResult(evalResult);
    if (!resultText) {
      return {
        content: [{ type: 'text', text: 'Failed to evaluate element bounds' }],
        isError: true,
      };
    }

    let bounds;
    try {
      bounds = JSON.parse(resultText);
    } catch {
      return {
        content: [{ type: 'text', text: `Invalid response from browser: ${resultText}` }],
        isError: true,
      };
    }

    return {
      content: [{
        type: 'text',
        text: `Element bounds (viewport coordinates):
- Position: (${bounds.x}, ${bounds.y})
- Size: ${bounds.width} x ${bounds.height}
- Center: (${bounds.centerX}, ${bounds.centerY})`,
      }],
    };
  }

  /**
   * Extract text content from a tool result
   * @param {Object} result - Tool result
   * @returns {string|null}
   */
  _extractTextFromResult(result) {
    if (!result || !result.content) {
      return null;
    }

    for (const part of result.content) {
      if (part.type === 'text' && part.text) {
        // Look for JSON in the response
        // The result might include other text, so try to find JSON
        const text = part.text.trim();
        // Check if it starts with { or [
        if (text.startsWith('{') || text.startsWith('[')) {
          // Try to extract just the JSON portion by finding balanced braces
          const startChar = text[0];
          const endChar = startChar === '{' ? '}' : ']';
          let depth = 0;
          let inString = false;
          let escape = false;

          for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (escape) {
              escape = false;
              continue;
            }

            if (char === '\\' && inString) {
              escape = true;
              continue;
            }

            if (char === '"' && !escape) {
              inString = !inString;
              continue;
            }

            if (inString) continue;

            if (char === startChar) depth++;
            if (char === endChar) {
              depth--;
              if (depth === 0) {
                return text.slice(0, i + 1);
              }
            }
          }
          // If we couldn't find balanced braces, return as-is
          return text;
        }
        // Look for JSON anywhere in the text
        const jsonMatch = text.match(/(\{[\s\S]*?\}|\[[\s\S]*?\])/);
        if (jsonMatch) {
          return jsonMatch[1];
        }
        return text;
      }
    }

    return null;
  }

  /**
   * Inject highlight CSS styles into the page (once per page)
   * @returns {Promise<void>}
   */
  async _injectHighlightStyles() {
    if (this._highlightStylesInjected) {
      return;
    }

    const css = `
      .__mcp-highlight {
        box-shadow: 0 0 0 4px var(--mcp-highlight-color, #ff0000) !important;
        position: relative;
      }

      @keyframes __mcp-pulse {
        0%, 100% { box-shadow: 0 0 0 4px var(--mcp-highlight-color, #ff0000); }
        50% { box-shadow: 0 0 0 8px var(--mcp-highlight-color, #ff0000), 0 0 20px var(--mcp-highlight-color, #ff0000); }
      }

      .__mcp-highlight-pulse {
        animation: __mcp-pulse 1.5s ease-in-out infinite;
      }

      .__mcp-highlight-label {
        position: fixed;
        background: var(--mcp-label-color, #ff0000);
        color: white;
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 500;
        font-family: system-ui, -apple-system, sans-serif;
        z-index: 10001;
        pointer-events: none;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        white-space: nowrap;
      }

      .__mcp-highlight-label::before {
        content: '';
        position: absolute;
        left: 50%;
        bottom: -6px;
        transform: translateX(-50%);
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: 6px solid var(--mcp-label-color, #ff0000);
      }
    `;

    await this._inner.callTool('browser_evaluate', {
      function: `() => {
        if (!document.getElementById('__mcp-highlight-styles')) {
          const style = document.createElement('style');
          style.id = '__mcp-highlight-styles';
          style.textContent = ${JSON.stringify(css)};
          document.head.appendChild(style);
        }
      }`,
    });

    this._highlightStylesInjected = true;
  }

  /**
   * Handle browser_highlight tool
   * @param {Object} args - { refs: string[], color?: string, label?: string }
   * @returns {Promise<Object>} Highlight result
   */
  async _handleHighlight(args) {
    const { refs, color = 'red', label } = args;

    if (!refs || !Array.isArray(refs) || refs.length === 0) {
      return {
        content: [{ type: 'text', text: 'browser_highlight requires a non-empty refs array' }],
        isError: true,
      };
    }

    // Inject styles if needed
    await this._injectHighlightStyles();

    // Clear any existing highlights first
    await this._clearHighlightsInternal();

    // Color mapping for convenience
    const colorMap = {
      red: '#ff0000',
      blue: '#0066ff',
      green: '#00aa00',
      orange: '#ff8800',
      purple: '#8800ff',
    };

    const cssColor = colorMap[color] || color;
    const highlighted = [];
    const failed = [];

    // Highlight each element
    for (const ref of refs) {
      try {
        await this._inner.callTool('browser_evaluate', {
          ref,
          element: 'element to highlight',
          function: `(element) => {
            element.classList.add('__mcp-highlight', '__mcp-highlight-pulse');
            element.style.setProperty('--mcp-highlight-color', '${cssColor}');
          }`,
        });
        highlighted.push(ref);
        this._activeHighlights.push({ ref, type: 'element' });
      } catch (error) {
        failed.push({ ref, error: error.message || 'Unknown error' });
      }
    }

    // Add label if specified (positioned near the first highlighted element)
    if (label && highlighted.length > 0) {
      try {
        const firstRef = highlighted[0];
        // Get bounding box of first element
        const boundsResult = await this._inner.callTool('browser_evaluate', {
          ref: firstRef,
          element: 'element for label positioning',
          function: `(element) => {
            const rect = element.getBoundingClientRect();
            return JSON.stringify({
              x: rect.left + rect.width / 2,
              y: rect.top,
              width: rect.width,
              height: rect.height
            });
          }`,
        });

        const boundsText = this._extractTextFromResult(boundsResult);
        if (boundsText) {
          // The result may have escaped quotes or be double-stringified
          let bounds;
          try {
            // First try direct parse
            bounds = JSON.parse(boundsText);
            // If the result is still a string, parse again
            if (typeof bounds === 'string') {
              bounds = JSON.parse(bounds);
            }
          } catch (parseError) {
            // Try unescaping backslash-escaped quotes first
            try {
              const unescaped = boundsText.replace(/\\"/g, '"');
              bounds = JSON.parse(unescaped);
            } catch (parseError2) {
              throw new Error(`Failed to parse bounds: ${boundsText}`);
            }
          }
          // Escape label text for embedding in JS string
          const escapedLabel = label.replace(/'/g, "\\'").replace(/\n/g, '\\n');

          // Create label element positioned above the element
          const createLabelResult = await this._inner.callTool('browser_evaluate', {
            function: `() => {
              try {
                const labelEl = document.createElement('div');
                labelEl.className = '__mcp-highlight-label';
                labelEl.id = '__mcp-highlight-label-' + Date.now();
                labelEl.textContent = '${escapedLabel}';
                labelEl.style.setProperty('--mcp-label-color', '${cssColor}');
                labelEl.style.left = '${bounds.x}px';
                labelEl.style.top = '${bounds.y - 40}px';
                labelEl.style.transform = 'translateX(-50%)';
                document.body.appendChild(labelEl);
                return JSON.stringify({ success: true, id: labelEl.id });
              } catch (e) {
                return JSON.stringify({ success: false, error: e.message });
              }
            }`,
          });
          const labelResultText = this._extractTextFromResult(createLabelResult);
          if (labelResultText) {
            let labelResult;
            try {
              labelResult = JSON.parse(labelResultText);
              if (typeof labelResult === 'string') {
                labelResult = JSON.parse(labelResult);
              }
            } catch {
              // Try unescaping backslash-escaped quotes
              try {
                const unescaped = labelResultText.replace(/\\"/g, '"');
                labelResult = JSON.parse(unescaped);
              } catch {
                // Label was likely created, just can't parse the result
                labelResult = { success: true };
              }
            }
            if (!labelResult.success) {
              throw new Error(`Label creation failed: ${labelResult.error}`);
            }
          }
          this._activeHighlights.push({ type: 'label' });
        }
      } catch (error) {
        // Label positioning failed, but highlights still worked
        console.error('Failed to position label:', error.message);
      }
    }

    // Build response
    let resultText = `Highlighted ${highlighted.length}/${refs.length} element(s)`;
    if (label) {
      resultText += ` with label "${label}"`;
    }
    resultText += '.';

    if (failed.length > 0) {
      resultText += `\n\nFailed to highlight:\n${failed.map(f => `- ${f.ref}: ${f.error}`).join('\n')}`;
    }

    resultText += '\n\nHighlights will auto-clear on your next browser action.';

    return {
      content: [{ type: 'text', text: resultText }],
      isError: failed.length > 0 && highlighted.length === 0,
    };
  }

  /**
   * Internal method to clear highlights (doesn't return MCP response)
   * @returns {Promise<void>}
   */
  async _clearHighlightsInternal() {
    if (this._activeHighlights.length === 0) {
      return;
    }

    try {
      await this._inner.callTool('browser_evaluate', {
        function: `() => {
          // Remove highlight classes from all elements
          document.querySelectorAll('.__mcp-highlight').forEach(el => {
            el.classList.remove('__mcp-highlight', '__mcp-highlight-pulse');
            el.style.removeProperty('--mcp-highlight-color');
          });
          // Remove all label elements
          document.querySelectorAll('.__mcp-highlight-label').forEach(el => {
            el.remove();
          });
        }`,
      });
    } catch (error) {
      // Silently ignore errors during cleanup (page may have navigated)
    }

    this._activeHighlights = [];
  }

  /**
   * Handle browser_clear_highlights tool
   * @returns {Promise<Object>} Clear result
   */
  async _handleClearHighlights() {
    const hadHighlights = this._activeHighlights.length > 0;
    await this._clearHighlightsInternal();

    return {
      content: [{
        type: 'text',
        text: hadHighlights
          ? 'Cleared all highlights.'
          : 'No highlights to clear.',
      }],
    };
  }

  /**
   * Handle browser_request_upload tool
   * @param {Object} args - { filename?: string, maxBytes?: number }
   * @returns {Promise<Object>} Upload URL and token
   */
  async _handleRequestUpload(args) {
    try {
      // Ensure localhost server is running
      const server = await this._ensureLocalhostServer();

      // Register upload token
      const { uploadToken, uploadUrl, expiresIn } = server.registerUploadToken({
        filename: args.filename,
        maxBytes: args.maxBytes,
      });

      return {
        content: [{
          type: 'text',
          text: `Upload URL ready.

**Upload URL:** ${uploadUrl}
**Upload Token:** ${uploadToken}
**Expires in:** ${expiresIn} seconds

**Instructions:**
1. POST your file to the upload URL as multipart/form-data
2. Include header: \`X-Upload-Token: ${uploadToken}\`
3. The response will contain a \`fileToken\`
4. Use that fileToken with browser_file_upload(fileTokens: [<fileToken>])

**Example curl command:**
\`\`\`bash
curl -X POST "${uploadUrl}" \\
  -H "X-Upload-Token: ${uploadToken}" \\
  -F "file=@/path/to/your/file.pdf"
\`\`\`

The response will be JSON: \`{"success": true, "fileToken": "...", "filename": "...", "bytes": ...}\``,
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed to create upload URL: ${error.message}` }],
        isError: true,
      };
    }
  }

  /**
   * Resolve file tokens to local file paths
   * @param {string[]} fileTokens - Array of file tokens from uploads
   * @returns {Promise<{ paths?: string[], error?: string }>}
   */
  async _resolveFileTokens(fileTokens) {
    // Ensure localhost server is running to resolve tokens
    if (!this._localhostServer) {
      await this._ensureLocalhostServer();
    }

    const resolvedPaths = [];
    const errors = [];

    for (const token of fileTokens) {
      const localPath = this._localhostServer.getUploadedFilePath(token);
      if (localPath) {
        resolvedPaths.push(localPath);
      } else {
        const filename = this._localhostServer.getUploadedFilename(token);
        if (filename) {
          errors.push(`File token "${token}" (${filename}) - file no longer exists`);
        } else {
          errors.push(`Invalid or expired file token: "${token}"`);
        }
      }
    }

    if (errors.length > 0) {
      return {
        error: `Failed to resolve file tokens:\n${errors.join('\n')}\n\nTo upload files:\n1. Call browser_request_upload to get an upload URL\n2. POST your file to that URL\n3. Use the returned fileToken with browser_file_upload`,
      };
    }

    return { paths: resolvedPaths };
  }

  /**
   * Ensure LocalhostServer is initialized (lazy)
   * @returns {Promise<LocalhostServer>}
   */
  async _ensureLocalhostServer() {
    if (!this._localhostServer) {
      this._localhostServer = new LocalhostServer({
        tempDir: this.config.tempDir,
      });
    }
    if (!this._localhostServer.isRunning) {
      await this._localhostServer.ensureRunning();
    }
    return this._localhostServer;
  }

  /**
   * Post-process tool results to replace local file paths with localhost URLs
   * @param {Object} result - Tool result from callTool
   * @returns {Promise<Object>} Modified result with localhost URLs
   */
  async _postProcessResult(result) {
    // Skip if result is empty or an error
    if (!result || !result.content || result.isError) {
      return result;
    }

    // Find text content to process
    const textPart = result.content.find(part => part.type === 'text' && part.text);
    if (!textPart) {
      return result;
    }

    let text = textPart.text;
    let modified = false;

    // Regex patterns for detecting download paths:
    // 1. Browser download format: "- Downloaded file X to /path/to/file"
    const browserDownloadRegex = /^- Downloaded file (.+) to (.+)$/gm;
    // 2. SaveToFile format: "Path: /path/to/file" or "saved to: /path/to/file"
    const saveToFileRegex = /(?:Path:|saved to:|Saved to:|Snapshot saved to file\.\s*\n\s*Path:)\s*(.+)$/gm;

    // Collect all paths to process
    const pathsToProcess = [];

    // Find browser download paths
    let match;
    while ((match = browserDownloadRegex.exec(text)) !== null) {
      const filename = match[1];
      const localPath = match[2];
      pathsToProcess.push({ localPath, filename, fullMatch: match[0], type: 'download' });
    }

    // Find saveToFile paths
    browserDownloadRegex.lastIndex = 0; // Reset regex
    while ((match = saveToFileRegex.exec(text)) !== null) {
      const localPath = match[1].trim();
      const filename = path.basename(localPath);
      pathsToProcess.push({ localPath, filename, fullMatch: match[0], type: 'savefile' });
    }

    // If no paths found, return original result
    if (pathsToProcess.length === 0) {
      return result;
    }

    // Initialize localhost server (lazy)
    const server = await this._ensureLocalhostServer();

    // Process each path and replace in text
    for (const { localPath, filename, fullMatch, type } of pathsToProcess) {
      const { publicUrl } = server.registerDownload(localPath, filename);

      if (type === 'download') {
        // Replace "- Downloaded file X to /local/path" with localhost URL and download instructions
        const newText = `- Downloaded file ${filename}
  Download URL: ${publicUrl}

  To download with curl or wget:
  \`\`\`bash
  curl -L -o "${filename}" "${publicUrl}"
  \`\`\``;
        text = text.replace(fullMatch, newText);
        modified = true;
      } else if (type === 'savefile') {
        // Replace local path with localhost URL and add download instructions
        const newText = `${fullMatch.replace(localPath, publicUrl)}

  To download with curl or wget:
  \`\`\`bash
  curl -L -o "${filename}" "${publicUrl}"
  \`\`\``;
        text = text.replace(fullMatch, newText);
        modified = true;
      }
    }

    if (!modified) {
      return result;
    }

    // Return modified result
    return {
      ...result,
      content: result.content.map(part => {
        if (part === textPart) {
          return { ...part, text };
        }
        return part;
      }),
    };
  }

  /**
   * Called when the server is closed
   */
  async serverClosed() {
    // Clean up localhost server
    if (this._localhostServer) {
      await this._localhostServer.stop();
      this._localhostServer = null;
    }

    if (this._inner.serverClosed) {
      this._inner.serverClosed();
    }
  }
}
