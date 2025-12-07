# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Playwright MCP is a Model Context Protocol (MCP) server that provides browser automation capabilities using Playwright. It enables LLMs to interact with web pages through structured accessibility snapshots, bypassing the need for screenshots or visually-tuned models.

**Important:** The core Playwright MCP source code lives in the [Playwright monorepo](https://github.com/microsoft/playwright) at `packages/playwright/src/mcp`. This repository is a thin wrapper that re-exports the functionality and contains integration tests.

## Common Commands

```bash
# Run all tests (Chrome)
npm test

# Run tests for specific browser
npm run ctest    # Chrome
npm run ftest    # Firefox
npm run wtest    # WebKit

# Run Docker tests
npm run dtest

# Run a single test file
npx playwright test tests/core.spec.ts

# Run a single test by name
npx playwright test -g "browser_navigate"

# Lint / update README
npm run lint
```

## Architecture

### Thin Wrapper Pattern
- `cli.js` - Entry point for the CLI, delegates to `playwright/lib/mcp/program`
- `index.js` - Exports `createConnection` from `playwright/lib/mcp/index`
- `config.d.ts` - TypeScript types for configuration (copied from Playwright monorepo via `npm run copy-config`)

### Test Structure
- Tests are in `tests/` and use Playwright Test
- `tests/fixtures.ts` - Core test fixtures including `startClient` for creating MCP client connections
- Tests communicate with the MCP server via stdio transport using `@modelcontextprotocol/sdk`
- `tests/testserver/` - Local HTTP/HTTPS test server for testing browser automation

### Test Fixtures
The `startClient` fixture creates an MCP client that connects to the Playwright MCP server. It accepts optional config, CLI args, and roots. Example usage:

```typescript
test('my test', async ({ client, server }) => {
  const response = await client.callTool({
    name: 'browser_navigate',
    arguments: { url: server.HELLO_WORLD },
  });
  expect(response).toHaveResponse({ /* expected response */ });
});
```

### Environment Variables
- `PWMCP_DEBUG=1` - Print MCP server stderr during tests
- `MCP_IN_DOCKER=1` - Run tests in Docker mode

## jons-mcp-playwright Subproject

The `jons-mcp-playwright/` directory contains an enhanced wrapper around `@playwright/mcp` with additional features for LLM usage optimization.

### Features
- **Snapshot Filtering**: Reduces token usage by 80%+ via depth truncation, list truncation, and noise removal
- **New Tools**: `browser_get_text`, `browser_get_table`, `browser_get_image`, `browser_fill_form`, `browser_get_bounds`
- **Developer Tools Filtering**: Hides rarely-used tools by default
- **saveToFile Parameter**: Save output to temp files instead of inline

### Commands
```bash
cd jons-mcp-playwright

# Run all tests
npx playwright test

# Run specific test file
npx playwright test tests/filtering.spec.ts
npx playwright test tests/tools.spec.ts
npx playwright test tests/validation.spec.ts
```

### Architecture
- `src/index.js` - Creates MCP server with EnhancedBackend wrapper
- `src/enhanced-backend.js` - Wraps Playwright MCP with filtering and new tools
- `src/snapshot-filter.js` - YAML parsing and filtering logic
- `src/snapshot-cache.js` - 5-second cache for subtree extraction
- `src/tools/*.js` - Tool definition files (placeholder, logic in enhanced-backend)
- `src/utils/*.js` - File output and ref resolver utilities

### CLI Options
```bash
node cli.js --max-depth=5 --list-limit=10 --include-developer-tools
```

## Contributing

Contributions require an issue first. Major code changes should be made in the [Playwright monorepo](https://github.com/microsoft/playwright), not this repository. Follow [Semantic Commit Messages](https://www.conventionalcommits.org/en/v1.0.0/) format.
