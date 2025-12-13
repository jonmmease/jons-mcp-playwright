/**
 * Vision Ref Cache
 *
 * Manages caching of vision-detected element refs (v1, v2, ...) with:
 * - Page-scoped keys to prevent cross-tab bugs
 * - HiDPI coordinate conversion (pixel -> CSS)
 * - TTL-based expiration (configurable via SCREENSHOT_REF_TTL)
 *
 * @module vision-ref-cache
 */

/**
 * Default TTL in milliseconds (30 seconds).
 * Can be overridden via SCREENSHOT_REF_TTL environment variable.
 */
const DEFAULT_TTL_MS = 30000;

/**
 * Cache entry structure for vision refs.
 * @typedef {object} CacheEntry
 * @property {object} bounds - CSS pixel coordinates for interaction
 * @property {number} bounds.x - Left edge (CSS pixels)
 * @property {number} bounds.y - Top edge (CSS pixels)
 * @property {number} bounds.width - Width (CSS pixels)
 * @property {number} bounds.height - Height (CSS pixels)
 * @property {number} bounds.centerX - Center X for clicking (CSS pixels)
 * @property {number} bounds.centerY - Center Y for clicking (CSS pixels)
 * @property {object} imageBounds - Original pixel coordinates from Gemini
 * @property {number} imageBounds.y_min - Top edge (image pixels)
 * @property {number} imageBounds.x_min - Left edge (image pixels)
 * @property {number} imageBounds.y_max - Bottom edge (image pixels)
 * @property {number} imageBounds.x_max - Right edge (image pixels)
 * @property {number} timestamp - When this entry was cached (Date.now())
 * @property {string} screenshotUrl - URL of the source screenshot
 * @property {number} deviceScaleFactor - Device pixel ratio used for conversion
 * @property {string} pageId - ID of the page this ref belongs to
 * @property {string} name - Element name (for browser_get_text)
 * @property {string} role - Element ARIA role
 */

/**
 * Vision Ref Cache for managing screenshot-detected element references.
 */
export class VisionRefCache {
  /**
   * Create a new VisionRefCache.
   * @param {number} [ttl] - TTL in milliseconds (default: SCREENSHOT_REF_TTL env or 30000)
   */
  constructor(ttl) {
    /** @type {Map<string, CacheEntry>} */
    this._cache = new Map();
    this._ttl = ttl ?? (parseInt(process.env.SCREENSHOT_REF_TTL) || DEFAULT_TTL_MS);
  }

  /**
   * Get the configured TTL in milliseconds.
   * @returns {number}
   */
  get ttl() {
    return this._ttl;
  }

  /**
   * Cache a single element's ref.
   *
   * @param {string} pageId - ID of the page
   * @param {string} ref - The ref string (e.g., "v1")
   * @param {object} element - Element data from Gemini
   * @param {number[]} element.bounding_box - [y_min, x_min, y_max, x_max] in image pixels
   * @param {string} element.name - Element name
   * @param {string} element.role - ARIA role
   * @param {string} screenshotUrl - URL of the source screenshot
   * @param {number} deviceScaleFactor - Device pixel ratio
   */
  set(pageId, ref, element, screenshotUrl, deviceScaleFactor) {
    const [y_min, x_min, y_max, x_max] = element.bounding_box;
    const scale = deviceScaleFactor || 1;

    // Convert image pixels to CSS pixels
    const bounds = {
      x: Math.round(x_min / scale),
      y: Math.round(y_min / scale),
      width: Math.round((x_max - x_min) / scale),
      height: Math.round((y_max - y_min) / scale),
      centerX: Math.round((x_min + x_max) / 2 / scale),
      centerY: Math.round((y_min + y_max) / 2 / scale),
    };

    const key = `${pageId}:${ref}`;
    this._cache.set(key, {
      bounds,
      imageBounds: { y_min, x_min, y_max, x_max },
      timestamp: Date.now(),
      screenshotUrl,
      deviceScaleFactor: scale,
      pageId,
      name: element.name,
      role: element.role,
    });
  }

  /**
   * Get a cached entry if it exists and hasn't expired.
   *
   * @param {string} pageId - ID of the page
   * @param {string} ref - The ref string (e.g., "v1")
   * @returns {CacheEntry|null} The cache entry or null if not found/expired
   */
  get(pageId, ref) {
    const key = `${pageId}:${ref}`;
    const entry = this._cache.get(key);

    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp >= this._ttl) {
      this._cache.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * Check if a ref is valid (exists and not expired).
   *
   * @param {string} pageId - ID of the page
   * @param {string} ref - The ref string (e.g., "v1")
   * @returns {boolean} True if the ref is valid
   */
  isValid(pageId, ref) {
    return this.get(pageId, ref) !== null;
  }

  /**
   * Get CSS pixel coordinates for clicking/hovering.
   *
   * @param {string} pageId - ID of the page
   * @param {string} ref - The ref string (e.g., "v1")
   * @returns {{x: number, y: number}|null} Center coordinates or null
   */
  getClickCoords(pageId, ref) {
    const entry = this.get(pageId, ref);
    if (!entry) return null;

    return {
      x: entry.bounds.centerX,
      y: entry.bounds.centerY,
    };
  }

  /**
   * Get CSS pixel bounds for an element.
   *
   * @param {string} pageId - ID of the page
   * @param {string} ref - The ref string (e.g., "v1")
   * @returns {{x: number, y: number, width: number, height: number}|null}
   */
  getBounds(pageId, ref) {
    const entry = this.get(pageId, ref);
    if (!entry) return null;

    return {
      x: entry.bounds.x,
      y: entry.bounds.y,
      width: entry.bounds.width,
      height: entry.bounds.height,
    };
  }

  /**
   * Get the element name (for browser_get_text).
   *
   * @param {string} pageId - ID of the page
   * @param {string} ref - The ref string (e.g., "v1")
   * @returns {string|null} Element name or null
   */
  getName(pageId, ref) {
    const entry = this.get(pageId, ref);
    return entry?.name ?? null;
  }

  /**
   * Clear all refs for a specific page.
   * Called on navigation, reload, or new screenshot_snapshot.
   *
   * @param {string} pageId - ID of the page to clear
   */
  clearPage(pageId) {
    const prefix = `${pageId}:`;
    for (const key of this._cache.keys()) {
      if (key.startsWith(prefix)) {
        this._cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached refs.
   */
  clearAll() {
    this._cache.clear();
  }

  /**
   * Get the number of cached entries.
   * @returns {number}
   */
  get size() {
    return this._cache.size;
  }

  /**
   * Cache all elements from a Gemini response recursively.
   *
   * @param {Array} elements - Array of elements with refs assigned
   * @param {string} pageId - ID of the page
   * @param {string} screenshotUrl - URL of the source screenshot
   * @param {number} deviceScaleFactor - Device pixel ratio
   */
  cacheElements(elements, pageId, screenshotUrl, deviceScaleFactor) {
    // Clear existing cache for this page first
    this.clearPage(pageId);

    const cacheRecursive = (els) => {
      for (const el of els) {
        if (el.ref && el.bounding_box) {
          this.set(pageId, el.ref, el, screenshotUrl, deviceScaleFactor);
        }
        if (el.children?.length > 0) {
          cacheRecursive(el.children);
        }
      }
    };

    cacheRecursive(elements);
  }
}

/**
 * Check if a ref string is a vision ref (starts with 'v').
 *
 * @param {string} ref - The ref string to check
 * @returns {boolean} True if this is a vision ref
 */
export function isVisionRef(ref) {
  return typeof ref === 'string' && ref.startsWith('v');
}
