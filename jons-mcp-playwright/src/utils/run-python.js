/**
 * run-python.js - Utility for spawning Python scripts via uv
 *
 * Handles:
 * - UV_PATH environment variable override
 * - ESM-safe path resolution
 * - ENOENT error handling with helpful messages
 * - Configurable timeout
 * - stderr surfacing on errors
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Run a Python script via uv and parse JSON output
 *
 * @param {string} scriptPath - Absolute path to Python script
 * @param {string[]} args - Arguments to pass to script
 * @param {Object} options - Configuration options
 * @param {number} [options.timeout=120000] - Timeout in milliseconds (default: 120s for first-run deps download)
 * @param {number} [options.maxBuffer=10485760] - Max output size in bytes (default: 10MB)
 * @returns {Promise<Object>} Parsed JSON output from script
 * @throws {Error} On command not found, timeout, script error, or invalid JSON
 */
export async function runPythonScript(scriptPath, args = [], options = {}) {
  const {
    timeout = 120000, // 120 seconds - accounts for first-run dependency download
    maxBuffer = 10 * 1024 * 1024, // 10MB
  } = options;

  // Get uv path from environment or use default
  const uvPath = process.env.UV_PATH || 'uv';

  try {
    const { stdout, stderr } = await execFileAsync(
      uvPath,
      ['run', scriptPath, ...args],
      {
        env: { ...process.env },
        timeout,
        maxBuffer,
      }
    );

    // Try to parse JSON output
    try {
      return JSON.parse(stdout);
    } catch (parseError) {
      throw new Error(
        `Failed to parse JSON output from Python script.\n` +
        `stdout: ${stdout.substring(0, 500)}\n` +
        `stderr: ${stderr || '(empty)'}`
      );
    }
  } catch (error) {
    // Handle specific error codes
    if (error.code === 'ENOENT') {
      throw new Error(
        `uv command not found at '${uvPath}'.\n\n` +
        `Install uv with:\n` +
        `  curl -LsSf https://astral.sh/uv/install.sh | sh\n\n` +
        `Or set UV_PATH environment variable to the uv executable path.`
      );
    }

    if (error.code === 'ETIMEDOUT' || error.killed) {
      throw new Error(
        `Python script timed out after ${timeout / 1000} seconds.\n\n` +
        `This may happen on first run when uv downloads dependencies (~200MB).\n` +
        `Try running again - subsequent runs will be faster.`
      );
    }

    // Include stderr in error message for debugging
    const stderrInfo = error.stderr ? `\nstderr: ${error.stderr}` : '';
    throw new Error(
      `Python script failed with exit code ${error.code || 'unknown'}.\n` +
      `${error.message}${stderrInfo}`
    );
  }
}

export default { runPythonScript };
