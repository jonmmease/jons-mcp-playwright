/**
 * Utilities for saveToFile functionality
 *
 * Handles:
 * - OS-specific temp directory detection
 * - File naming with timestamps
 * - Subdirectory management (snapshots/, images/, etc.)
 * - Cleanup on session end
 */

import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, writeFile, rm } from 'fs/promises';
import { existsSync } from 'fs';

// Track the base temp directory for cleanup
let baseTempDir = null;

/**
 * Get the temp directory for file output
 * @param {string|null} configuredDir - User-configured directory, or null for default
 * @returns {string} Absolute path to temp directory
 */
export function getTempDir(configuredDir = null) {
  if (configuredDir) {
    return configuredDir;
  }
  return join(tmpdir(), 'playwright-mcp');
}

/**
 * Ensure a directory exists, creating it and any parent directories if needed
 * @param {string} dir - Directory path to ensure exists
 */
export async function ensureDir(dir) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Get the subdirectory name for a given content type
 * @param {string} type - Content type
 * @returns {string} Subdirectory name
 */
function getSubdirectory(type) {
  const subdirs = {
    'snapshot': 'snapshots',
    'image': 'images',
    'screenshot': 'screenshots',
    'text': 'text',
    'table': 'tables'
  };
  return subdirs[type] || 'misc';
}

/**
 * Generate a filename for the content
 * @param {string} type - Content type
 * @param {string|null} ref - Optional element ref for naming
 * @param {string} extension - File extension (without dot)
 * @returns {string} Filename
 */
function generateFilename(type, ref, extension) {
  const timestamp = Date.now();
  if (ref) {
    return `${type}-${ref}-${timestamp}.${extension}`;
  }
  return `${type}-${timestamp}.${extension}`;
}

/**
 * Save content to a file and return metadata
 * @param {string|Buffer} content - Content to save (string or binary buffer)
 * @param {Object} options - Save options
 * @param {string} options.type - Content type: 'snapshot' | 'image' | 'screenshot' | 'text' | 'table'
 * @param {string|null} [options.ref] - Optional element ref for naming
 * @param {string} options.extension - File extension (without dot)
 * @param {string|null} [options.tempDir] - Base temp directory (uses default if not provided)
 * @returns {Promise<{path: string, bytes: number}>} File metadata
 */
export async function saveToFile(content, options = {}) {
  const { type, ref = null, extension, tempDir = null } = options;

  if (!type) {
    throw new Error('saveToFile requires options.type');
  }
  if (!extension) {
    throw new Error('saveToFile requires options.extension');
  }

  // Get base temp directory
  const baseDir = getTempDir(tempDir);
  baseTempDir = baseDir; // Track for cleanup

  // Get subdirectory for this type
  const subdir = getSubdirectory(type);
  const fullDir = join(baseDir, subdir);

  // Ensure directory exists
  await ensureDir(fullDir);

  // Generate filename
  const filename = generateFilename(type, ref, extension);
  const filepath = join(fullDir, filename);

  // Write file
  const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  await writeFile(filepath, contentBuffer);

  return {
    path: filepath,
    bytes: contentBuffer.length
  };
}

/**
 * Clean up temp files on session end
 * @param {string|null} tempDir - Temp directory to clean (uses tracked directory if not provided)
 */
export async function cleanup(tempDir = null) {
  const dirToClean = tempDir || baseTempDir;

  if (!dirToClean) {
    // No temp directory was ever created, nothing to clean
    return;
  }

  if (existsSync(dirToClean)) {
    try {
      await rm(dirToClean, { recursive: true, force: true });
    } catch (error) {
      // Log but don't throw - cleanup is best-effort
      console.error('Failed to cleanup temp directory:', error);
    }
  }

  // Reset tracking
  if (!tempDir) {
    baseTempDir = null;
  }
}
