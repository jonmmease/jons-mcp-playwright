#!/usr/bin/env node
/**
 * CLI entry point for jons-playwright-mcp
 *
 * Usage:
 *   npx jons-playwright-mcp [options]
 *
 * Options:
 *   --max-depth=N              Maximum tree depth (default: 5, null for no limit)
 *   --list-limit=N             Maximum items per list (default: 10, null for no limit)
 *   --include-developer-tools  Include hidden developer/testing tools
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
  if (arg.startsWith('--max-depth=')) {
    const value = arg.split('=')[1];
    config.maxDepth = value === 'null' ? null : parseInt(value, 10);
  } else if (arg.startsWith('--list-limit=')) {
    const value = arg.split('=')[1];
    config.listLimit = value === 'null' ? null : parseInt(value, 10);
  } else if (arg === '--include-developer-tools') {
    config.includeDeveloperTools = true;
  } else if (arg.startsWith('--playwright-')) {
    // Pass through to Playwright (convert kebab-case to camelCase)
    const playwrightArg = arg.replace('--playwright-', '');
    config.playwright = config.playwright || {};
    const [key, value] = playwrightArg.split('=');
    const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    config.playwright[camelKey] = value || true;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
jons-playwright-mcp - Enhanced Playwright MCP with snapshot filtering

Usage:
  npx jons-playwright-mcp [options]

Options:
  --max-depth=N              Maximum tree depth (default: 5, null for no limit)
  --list-limit=N             Maximum items per list (default: 10, null for no limit)
  --include-developer-tools  Include hidden developer/testing tools
  --playwright-*             Options passed through to Playwright MCP
                             Examples: --playwright-browser=firefox
                                       --playwright-headless

Environment Variables:
  PWMCP_DEBUG=1              Print debug output
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
    console.error('Failed to start jons-playwright-mcp:', error);
    process.exit(1);
  }
}

main();
