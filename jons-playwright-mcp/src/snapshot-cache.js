/**
 * Snapshot caching for subtree extraction
 *
 * Caches full snapshots with a TTL to enable consistent subtree extraction.
 * When browser_snapshot({ ref }) is called, we extract from the cached
 * snapshot to ensure consistency even if the page has changed.
 */

/**
 * Snapshot cache with TTL
 */
export class SnapshotCache {
  /**
   * @param {number} ttlMs - Time-to-live in milliseconds (default: 5000)
   */
  constructor(ttlMs = 5000) {
    this._ttlMs = ttlMs;
    this._snapshot = null;
    this._timestamp = null;
  }

  /**
   * Store a snapshot
   * @param {string} yaml - Full YAML snapshot
   */
  set(yaml) {
    this._snapshot = yaml;
    this._timestamp = Date.now();
  }

  /**
   * Get cached snapshot if not expired
   * @returns {string|null} - Cached snapshot or null if expired/empty
   */
  get() {
    if (!this._snapshot || !this._timestamp) {
      return null;
    }

    if (Date.now() - this._timestamp > this._ttlMs) {
      // Expired
      this._snapshot = null;
      this._timestamp = null;
      return null;
    }

    return this._snapshot;
  }

  /**
   * Check if cache is valid (has data and not expired)
   * @returns {boolean}
   */
  isValid() {
    return this.get() !== null;
  }

  /**
   * Get time until expiration in milliseconds
   * @returns {number} - Milliseconds until expiration, or 0 if expired/empty
   */
  timeRemaining() {
    if (!this._snapshot || !this._timestamp) {
      return 0;
    }

    const elapsed = Date.now() - this._timestamp;
    const remaining = this._ttlMs - elapsed;
    return Math.max(0, remaining);
  }

  /**
   * Clear the cache
   */
  clear() {
    this._snapshot = null;
    this._timestamp = null;
  }

  /**
   * Get the TTL setting
   * @returns {number} - TTL in milliseconds
   */
  get ttl() {
    return this._ttlMs;
  }
}

// Default singleton instance
let defaultCache = null;

/**
 * Get the default snapshot cache singleton
 * @param {number} ttlMs - TTL in milliseconds (only used on first call)
 * @returns {SnapshotCache}
 */
export function getSnapshotCache(ttlMs = 5000) {
  if (!defaultCache) {
    defaultCache = new SnapshotCache(ttlMs);
  }
  return defaultCache;
}

/**
 * Reset the default cache (useful for testing)
 */
export function resetSnapshotCache() {
  if (defaultCache) {
    defaultCache.clear();
  }
  defaultCache = null;
}
