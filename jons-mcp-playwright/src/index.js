/**
 * jons-mcp-playwright
 *
 * Enhanced Playwright MCP with snapshot filtering and additional tools.
 *
 * @module jons-mcp-playwright
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { EnhancedBackend } from './enhanced-backend.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);

// Import from allowed Playwright exports
const { createConnection: createPlaywrightConnection } = require('@playwright/mcp');
const mcpSdk = require('playwright/lib/mcp/sdk/exports');
const mcpBundle = require('playwright/lib/mcp/sdk/bundle');

/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
  maxDepth: 5,
  listLimit: 10,
  maxTextLength: 100,
  includeDeveloperTools: false,
  tempDir: null, // Will use OS temp dir
  ngrok: false, // Serve downloads via ngrok tunnel (requires NGROK_AUTHTOKEN)
};

/**
 * Creates an MCP connection with enhanced snapshot filtering.
 *
 * This works by:
 * 1. Creating a Playwright MCP server internally
 * 2. Wrapping it in an MCP client (in-process transport)
 * 3. Creating our EnhancedBackend that proxies to the client
 * 4. Returning our own server with the enhanced backend
 *
 * @param {Object} config - Configuration options
 * @param {number|null} config.maxDepth - Max tree depth (default: 5, null for no limit)
 * @param {number|null} config.listLimit - Max items per list (default: 10, null for no limit)
 * @param {number} config.maxTextLength - Truncate text longer than N chars (default: 100)
 * @param {boolean} config.includeDeveloperTools - Include hidden dev tools (default: false)
 * @param {string} config.tempDir - Directory for saveToFile output
 * @param {Object} config.playwright - Playwright MCP options (passed through)
 * @param {Function} contextGetter - Optional custom context getter
 * @returns {Promise<Object>} MCP server
 */
export async function createConnection(config = {}, contextGetter) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // Build Playwright config with optional adblock init-page
  const playwrightConfig = { ...config.playwright };

  // If adblock is enabled, add init-page
  if (process.env.JONS_MCP_ADBLOCK_MODE && process.env.JONS_MCP_ADBLOCK !== 'off') {
    const initPagePath = path.join(__dirname, 'adblocker', 'init-page.js');

    // Ensure browser config exists
    playwrightConfig.browser = playwrightConfig.browser || {};

    // Merge with existing initPage entries
    const existingInitPages = playwrightConfig.browser.initPage || [];
    playwrightConfig.browser.initPage = Array.isArray(existingInitPages)
      ? [initPagePath, ...existingInitPages]
      : [initPagePath, existingInitPages];
  }

  // If visual feedback is enabled (default: on), add init-page
  if (process.env.JONS_MCP_SHOW_ACTIONS !== 'off') {
    const visualFeedbackPath = path.join(__dirname, 'visual-feedback', 'init-page.js');

    // Ensure browser config exists
    playwrightConfig.browser = playwrightConfig.browser || {};

    // Merge with existing initPage entries
    const existingInitPages = playwrightConfig.browser.initPage || [];
    playwrightConfig.browser.initPage = Array.isArray(existingInitPages)
      ? [visualFeedbackPath, ...existingInitPages]
      : [visualFeedbackPath, existingInitPages];
  }

  // Add Chrome flags to suppress "Restore pages?" dialog after crash/unclean shutdown
  // This prevents the crash recovery bubble from appearing when the browser process
  // was killed without graceful shutdown (e.g., from lock clearing or Ctrl+C)
  playwrightConfig.browser = playwrightConfig.browser || {};
  playwrightConfig.browser.launchOptions = playwrightConfig.browser.launchOptions || {};
  playwrightConfig.browser.launchOptions.args = [
    ...(playwrightConfig.browser.launchOptions.args || []),
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
  ];

  // Handle capabilities from CLI (--playwright-caps=vision or --playwright-caps=vision,pdf)
  // CLI passes 'caps' as a comma-separated string, convert to 'capabilities' array
  if (playwrightConfig.caps) {
    playwrightConfig.capabilities = playwrightConfig.caps.split(',').map(c => c.trim());
    delete playwrightConfig.caps;
  }

  // Enable pdf capability by default for PDF handling
  // Vision capability (browser_mouse_*_xy tools) is opt-in via --playwright-caps=vision
  if (!playwrightConfig.capabilities) {
    playwrightConfig.capabilities = ['pdf'];
  }

  // Create the inner Playwright MCP server
  const playwrightServer = await createPlaywrightConnection(playwrightConfig, contextGetter);

  // Create an in-process client to communicate with the Playwright server
  // Use Playwright's InProcessTransport for proper bidirectional communication
  const transport = new mcpSdk.InProcessTransport(playwrightServer);

  const client = new mcpBundle.Client({ name: 'jons-mcp-playwright-proxy', version: '0.1.0' });
  await client.connect(transport);
  await client.ping(); // Ensure connection is established

  // Create a backend-like interface that uses the client
  const innerBackend = {
    async listTools() {
      const result = await client.listTools();
      return result.tools;
    },
    async callTool(name, args, progress) {
      const result = await client.callTool({ name, arguments: args });
      return result;
    },
    initialize: undefined,
    serverClosed: () => {
      playwrightServer.close();
    },
  };

  // Update mergedConfig with the final playwright capabilities
  // This allows EnhancedBackend to check if vision capability is enabled
  mergedConfig.playwright = mergedConfig.playwright || {};
  mergedConfig.playwright.capabilities = playwrightConfig.capabilities;

  // Wrap with our EnhancedBackend
  const enhancedBackend = new EnhancedBackend(mergedConfig, innerBackend);

  // Create and return the MCP server
  return mcpSdk.createServer(
    'jons-mcp-playwright',
    '0.1.0',
    enhancedBackend,
    false
  );
}

export default { createConnection };
