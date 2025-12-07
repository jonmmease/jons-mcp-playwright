/**
 * jons-mcp-playwright
 *
 * Enhanced Playwright MCP with snapshot filtering and additional tools.
 *
 * @module jons-mcp-playwright
 */

import { createRequire } from 'module';
import { EnhancedBackend } from './enhanced-backend.js';

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

  // Create the inner Playwright MCP server
  const playwrightServer = await createPlaywrightConnection(config.playwright || {}, contextGetter);

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
