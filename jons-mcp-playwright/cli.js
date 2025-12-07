#!/usr/bin/env node
/**
 * CLI entry point for jons-mcp-playwright
 *
 * Usage:
 *   npx jons-mcp-playwright [options]
 *
 * Options:
 *   --include-developer-tools  Include hidden developer/testing tools
 *   --adblock[=MODE]           Enable ad blocking (modes: ads, tracking, full, custom)
 *   --adblock-lists=URLS       Custom filter list URLs (comma-separated)
 *   --playwright-*             Options passed through to Playwright MCP
 */

import { createRequire } from 'module';
import { createConnection } from './src/index.js';

const require = createRequire(import.meta.url);
const mcpBundle = require('playwright/lib/mcp/sdk/bundle');

// Parse CLI arguments
const args = process.argv.slice(2);
const config = {};

for (const arg of args) {
  if (arg === '--include-developer-tools') {
    config.includeDeveloperTools = true;
  } else if (arg === '--adblock') {
    // --adblock with no value defaults to 'tracking' mode
    config.adblock = 'tracking';
    process.env.JONS_MCP_ADBLOCK_MODE = 'tracking';
  } else if (arg.startsWith('--adblock=')) {
    const mode = arg.split('=')[1];
    const validModes = ['ads', 'tracking', 'full', 'custom', 'off'];
    if (!validModes.includes(mode)) {
      console.error(`Invalid adblock mode: ${mode}. Valid modes: ${validModes.join(', ')}`);
      process.exit(1);
    }
    if (mode === 'off') {
      process.env.JONS_MCP_ADBLOCK = 'off';
    } else {
      config.adblock = mode;
      process.env.JONS_MCP_ADBLOCK_MODE = mode;
    }
  } else if (arg.startsWith('--adblock-lists=')) {
    const lists = arg.split('=')[1];
    config.adblockLists = lists;
    process.env.JONS_MCP_ADBLOCK_LISTS = lists;
  } else if (arg.startsWith('--playwright-')) {
    // Pass through to Playwright (convert kebab-case to camelCase)
    const playwrightArg = arg.replace('--playwright-', '');
    config.playwright = config.playwright || {};
    const [key, value] = playwrightArg.split('=');
    const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    config.playwright[camelKey] = value || true;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
jons-mcp-playwright - Enhanced Playwright MCP with snapshot filtering

Usage:
  npx jons-mcp-playwright [options]

Options:
  --include-developer-tools  Include hidden developer/testing tools
  --adblock[=MODE]           Enable ad blocking (default mode: tracking)
                             Modes: ads, tracking, full, custom, off
  --adblock-lists=URLS       Custom filter list URLs (comma-separated)
                             Only used with --adblock=custom
  --playwright-*             Options passed through to Playwright MCP
                             Examples: --playwright-browser=firefox
                                       --playwright-headless

Environment Variables:
  PWMCP_DEBUG=1              Print debug output
  JONS_MCP_ADBLOCK=off       Disable ad blocking at runtime
`);
    process.exit(0);
  }
}

async function main() {
  try {
    // Create the MCP server
    const server = await createConnection(config);

    // Connect via stdio transport
    const transport = new mcpBundle.StdioServerTransport();
    await server.connect(transport);

    // Handle shutdown
    process.on('SIGINT', async () => {
      await server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await server.close();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start jons-mcp-playwright:', error);
    process.exit(1);
  }
}

main();
