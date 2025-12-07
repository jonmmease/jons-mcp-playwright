/**
 * jons-playwright-mcp configuration
 * Simple filtering options; Playwright options passed through
 */
interface Config {
  // ============ Filtering options (our value-add) ============

  /**
   * Maximum tree depth to include in snapshots
   * Content beyond this depth shows "(▶ deeper content)" indicator
   * Set to null to disable depth limiting
   * @default 5
   */
  maxDepth?: number | null;

  /**
   * Maximum items to show per list/container
   * Additional items show "(▶ N more items)" indicator
   * Set to null to disable list limiting
   * @default 10
   */
  listLimit?: number | null;

  /**
   * Truncate element names longer than N characters
   * Applies to accessible names and values in snapshots
   * @default 100
   */
  maxTextLength?: number;

  /**
   * Directory for saveToFile output
   * Files are organized in subdirectories: snapshots/, images/, screenshots/, text/, tables/
   * Default: OS temp directory + '/playwright-mcp'
   * Examples:
   *   - Unix: /tmp/playwright-mcp
   *   - Windows: %TEMP%\playwright-mcp
   * @default OS temp directory + '/playwright-mcp'
   */
  tempDir?: string;

  /**
   * Include developer/testing tools that are hidden by default
   * When false (default), these tools are not exposed:
   *   - browser_install (one-time setup only)
   *   - browser_generate_locator (developer debugging)
   *   - browser_start_tracing (developer debugging)
   *   - browser_stop_tracing (developer debugging)
   *   - browser_connect (extension/remote mode only)
   *   - browser_verify_* (automated testing only)
   * Set to true to expose these tools
   * @default false
   */
  includeDeveloperTools?: boolean;

  // ============ Playwright passthrough ============

  /**
   * All Playwright MCP options passed through as-is
   * These are the standard Playwright MCP server configuration options
   */
  playwright?: {
    /**
     * Browser engine to use
     * @default 'chromium'
     */
    browser?: 'chromium' | 'firefox' | 'webkit';

    /**
     * Playwright browser launch options
     * See: https://playwright.dev/docs/api/class-browsertype#browser-type-launch
     */
    launchOptions?: Record<string, unknown>;

    /**
     * Playwright browser context options
     * See: https://playwright.dev/docs/api/class-browser#browser-new-context
     */
    contextOptions?: Record<string, unknown>;

    /**
     * Browser-specific capabilities to enable/disable
     */
    capabilities?: Record<string, boolean>;

    // Allow any other Playwright MCP options
    [key: string]: unknown;
  };
}

export type { Config };
