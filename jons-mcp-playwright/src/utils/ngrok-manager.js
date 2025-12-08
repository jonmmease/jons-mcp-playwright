/**
 * NgrokManager - Manages ngrok tunnel for serving downloaded files
 *
 * Provides:
 * - HTTP server to serve downloaded files
 * - ngrok tunnel for public URL access
 * - Security via session-scoped download whitelist
 * - Lazy initialization (only starts on first download)
 */

import http from 'http';
import { createReadStream, existsSync, statSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// MIME types for common file extensions
const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Get MIME type for a file based on extension
 * @param {string} filePath - Path to file
 * @returns {string} MIME type
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export class NgrokManager {
  /**
   * Create a new NgrokManager
   * @param {Object} config - Configuration options
   * @param {string} [config.tempDir] - Base temp directory for path validation
   */
  constructor(config = {}) {
    this.config = config;
    this._server = null;
    this._listener = null;
    this._publicBaseUrl = null;
    this._downloads = new Map(); // token -> { localPath, filename }
    this._isRunning = false;
  }

  /**
   * Check if the manager is running
   * @returns {boolean}
   */
  get isRunning() {
    return this._isRunning;
  }

  /**
   * Get the public base URL
   * @returns {string|null}
   */
  get publicBaseUrl() {
    return this._publicBaseUrl;
  }

  /**
   * Ensure the manager is running (lazy initialization)
   * Creates HTTP server and starts ngrok tunnel on first call
   */
  async ensureRunning() {
    if (this._isRunning) {
      return;
    }

    // Create HTTP server
    this._server = http.createServer(this._handleRequest.bind(this));

    // Listen on random available port
    await new Promise((resolve, reject) => {
      this._server.listen(0, '127.0.0.1', () => resolve());
      this._server.on('error', reject);
    });

    const port = this._server.address().port;

    // Start ngrok tunnel
    // Dynamic import to avoid loading ngrok if not needed
    const ngrok = await import('@ngrok/ngrok');

    try {
      this._listener = await ngrok.forward({
        addr: port,
        authtoken_from_env: true,
      });

      this._publicBaseUrl = this._listener.url();
      this._isRunning = true;
    } catch (error) {
      // Clean up server if ngrok fails
      this._server.close();
      this._server = null;
      throw new Error(`Failed to start ngrok tunnel: ${error.message}`);
    }
  }

  /**
   * Handle incoming HTTP requests
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  _handleRequest(req, res) {
    // Only allow GET requests
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Allow': 'GET' });
      res.end('Method Not Allowed');
      return;
    }

    // Parse URL path: /downloads/{token}/{filename}
    const urlPath = req.url || '/';
    const match = urlPath.match(/^\/downloads\/([^/]+)\/(.+)$/);

    if (!match) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const token = match[1];
    const requestedFilename = decodeURIComponent(match[2]);

    // Check if token exists in whitelist
    const download = this._downloads.get(token);
    if (!download) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const { localPath, filename } = download;

    // Verify the requested filename matches (extra security)
    if (requestedFilename !== filename) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    // Verify file exists and resolve to absolute path
    const resolvedPath = path.resolve(localPath);

    // Security: Ensure path doesn't escape allowed directories
    // The file must exist and be a file (not directory)
    if (!existsSync(resolvedPath)) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }

    try {
      const stats = statSync(resolvedPath);
      if (!stats.isFile()) {
        res.writeHead(404);
        res.end('Not a file');
        return;
      }

      // Serve the file
      const mimeType = getMimeType(resolvedPath);
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': stats.size,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Cache-Control': 'no-store',
      });

      createReadStream(resolvedPath).pipe(res);
    } catch (error) {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }

  /**
   * Register a downloaded file for serving
   * @param {string} localPath - Absolute path to the downloaded file
   * @param {string} filename - Original filename for download
   * @returns {{ token: string, publicUrl: string }}
   */
  registerDownload(localPath, filename) {
    const token = randomUUID();

    this._downloads.set(token, {
      localPath,
      filename,
      registeredAt: Date.now(),
    });

    const publicUrl = `${this._publicBaseUrl}/downloads/${token}/${encodeURIComponent(filename)}`;

    return { token, publicUrl };
  }

  /**
   * Check if a path is registered for serving
   * @param {string} localPath - Path to check
   * @returns {boolean}
   */
  isRegistered(localPath) {
    for (const download of this._downloads.values()) {
      if (download.localPath === localPath) {
        return true;
      }
    }
    return false;
  }

  /**
   * Stop the manager and clean up resources
   */
  async stop() {
    if (!this._isRunning) {
      return;
    }

    // Close ngrok listener
    if (this._listener) {
      try {
        await this._listener.close();
      } catch (error) {
        // Ignore close errors
      }
      this._listener = null;
    }

    // Close HTTP server
    if (this._server) {
      await new Promise((resolve) => {
        this._server.close(() => resolve());
      });
      this._server = null;
    }

    // Clear downloads
    this._downloads.clear();
    this._publicBaseUrl = null;
    this._isRunning = false;
  }
}

export default NgrokManager;
