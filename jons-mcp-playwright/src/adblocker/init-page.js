/**
 * Init-page script for Playwright MCP's browser.initPage mechanism.
 * This runs once per page to enable ad blocking.
 */

import { getBlocker } from './blocker.js';

// Symbol to prevent double-initialization
const ADBLOCKER_INITIALIZED = Symbol.for('jons-mcp-playwright.adblocker');

/**
 * @param {{ page: import('playwright').Page }} params
 */
export default async function initPage({ page }) {
  // Check if adblocking is disabled
  if (process.env.JONS_MCP_ADBLOCK === 'off') {
    return;
  }

  // Guard against double-initialization
  if (page[ADBLOCKER_INITIALIZED]) {
    return;
  }
  page[ADBLOCKER_INITIALIZED] = true;

  try {
    const blocker = await getBlocker();
    await blocker.enableBlockingInPage(page);
  } catch (err) {
    // Log but don't crash - ad blocking is a nice-to-have
    console.error('[adblocker] Failed to enable blocking:', err.message);
  }
}
