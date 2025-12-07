/**
 * Singleton PlaywrightBlocker with file-based caching.
 *
 * Modes:
 * - 'ads': Block only ads (EasyList)
 * - 'tracking': Block ads + tracking (EasyList + EasyPrivacy) [default]
 * - 'full': Block ads, tracking, and annoyances
 * - 'custom': Use custom filter lists from JONS_MCP_ADBLOCK_LISTS
 */

import { PlaywrightBlocker, adsLists, adsAndTrackingLists, fullLists } from '@ghostery/adblocker-playwright';
import fetch from 'cross-fetch';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE_DIR = path.join(os.tmpdir(), 'jons-mcp-playwright');
const CACHE_FILE = path.join(CACHE_DIR, 'adblocker.bin');
const CACHE_META_FILE = path.join(CACHE_DIR, 'adblocker.meta.json');
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 10000; // 10 seconds

/** @type {PlaywrightBlocker | null} */
let blockerInstance = null;

/** @type {Promise<PlaywrightBlocker> | null} */
let blockerPromise = null;

/**
 * Get the filter lists for the given mode.
 * @param {string} mode - One of: ads, tracking, full, custom
 * @returns {string[]} Array of filter list URLs
 */
function getListsForMode(mode) {
  switch (mode) {
    case 'ads':
      return adsLists;
    case 'tracking':
      return adsAndTrackingLists;
    case 'full':
      return fullLists;
    case 'custom': {
      const customLists = process.env.JONS_MCP_ADBLOCK_LISTS;
      if (!customLists) {
        console.error('[adblocker] Custom mode specified but JONS_MCP_ADBLOCK_LISTS is not set');
        return adsAndTrackingLists; // Fallback to tracking mode
      }
      return customLists.split(',').map(url => url.trim()).filter(Boolean);
    }
    default:
      console.error(`[adblocker] Unknown mode: ${mode}, falling back to tracking`);
      return adsAndTrackingLists;
  }
}

/**
 * Check if the cached blocker is still valid.
 * @returns {Promise<{valid: boolean, mode?: string}>}
 */
async function checkCacheValidity() {
  try {
    const metaStr = await fs.readFile(CACHE_META_FILE, 'utf-8');
    const meta = JSON.parse(metaStr);
    const age = Date.now() - meta.timestamp;
    const currentMode = process.env.JONS_MCP_ADBLOCK_MODE || 'tracking';

    if (age > CACHE_MAX_AGE_MS) {
      return { valid: false };
    }

    if (meta.mode !== currentMode) {
      return { valid: false };
    }

    return { valid: true, mode: meta.mode };
  } catch {
    return { valid: false };
  }
}

/**
 * Load the blocker from cache if available and valid.
 * @returns {Promise<PlaywrightBlocker | null>}
 */
async function loadFromCache() {
  const { valid } = await checkCacheValidity();
  if (!valid) {
    return null;
  }

  try {
    const data = await fs.readFile(CACHE_FILE);
    const blocker = PlaywrightBlocker.deserialize(data);
    return blocker;
  } catch {
    return null;
  }
}

/**
 * Save the blocker to cache.
 * @param {PlaywrightBlocker} blocker
 * @param {string} mode
 */
async function saveToCache(blocker, mode) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });

    const serialized = blocker.serialize();
    await fs.writeFile(CACHE_FILE, serialized);

    const meta = {
      timestamp: Date.now(),
      mode,
    };
    await fs.writeFile(CACHE_META_FILE, JSON.stringify(meta));
  } catch (err) {
    console.error('[adblocker] Failed to save cache:', err.message);
  }
}

/**
 * Fetch with timeout.
 * @param {string} url
 * @param {number} timeout
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Create a new blocker by fetching filter lists.
 * @param {string} mode
 * @returns {Promise<PlaywrightBlocker>}
 */
async function createBlocker(mode) {
  const lists = getListsForMode(mode);

  // Fetch all filter lists
  const listContents = await Promise.all(
    lists.map(async (url) => {
      try {
        const response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
        if (!response.ok) {
          console.error(`[adblocker] Failed to fetch ${url}: ${response.status}`);
          return '';
        }
        return await response.text();
      } catch (err) {
        console.error(`[adblocker] Failed to fetch ${url}: ${err.message}`);
        return '';
      }
    })
  );

  const combinedLists = listContents.filter(Boolean).join('\n');

  if (!combinedLists) {
    throw new Error('Failed to fetch any filter lists');
  }

  return PlaywrightBlocker.parse(combinedLists);
}

/**
 * Get the singleton PlaywrightBlocker instance.
 * Creates a new one if not already initialized.
 * @returns {Promise<PlaywrightBlocker>}
 */
export async function getBlocker() {
  // Return existing instance
  if (blockerInstance) {
    return blockerInstance;
  }

  // Return in-flight promise to prevent duplicate fetches
  if (blockerPromise) {
    return blockerPromise;
  }

  const mode = process.env.JONS_MCP_ADBLOCK_MODE || 'tracking';

  blockerPromise = (async () => {
    // Try loading from cache first
    const cached = await loadFromCache();
    if (cached) {
      blockerInstance = cached;
      return cached;
    }

    // Create new blocker
    const blocker = await createBlocker(mode);

    // Save to cache (don't await - fire and forget)
    saveToCache(blocker, mode);

    blockerInstance = blocker;
    return blocker;
  })();

  try {
    return await blockerPromise;
  } finally {
    blockerPromise = null;
  }
}

/**
 * Clear the singleton instance (useful for testing).
 */
export function clearBlocker() {
  blockerInstance = null;
  blockerPromise = null;
}
