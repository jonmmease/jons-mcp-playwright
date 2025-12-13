/**
 * LocalhostServer - Manages local HTTP server for serving downloaded files and accepting uploads
 *
 * Provides:
 * - HTTP server to serve downloaded files
 * - HTTP server to accept file uploads from sandboxed environments
 * - Optional ngrok tunnel for public URL access (for Claude Desktop compatibility)
 * - Security via session-scoped token whitelists with TTL
 * - Lazy initialization (only starts on first download/upload)
 * - Automatic cleanup of expired downloads and uploads
 */

import http from 'http';
import { createReadStream, createWriteStream, existsSync, statSync, mkdirSync, unlinkSync, readdirSync, rmSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import Busboy from 'busboy';

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

// Default TTL for download tokens (1 hour)
const DEFAULT_DOWNLOAD_TOKEN_TTL = 60 * 60 * 1000;

// Cleanup interval for expired downloads (10 minutes)
const CLEANUP_INTERVAL = 10 * 60 * 1000;

/**
 * Get MIME type for a file based on extension
 * @param {string} filePath - Path to file
 * @returns {string} MIME type
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export class LocalhostServer {
  /**
   * Create a new LocalhostServer
   * @param {Object} config - Configuration options
   * @param {string} [config.tempDir] - Base temp directory for path validation
   * @param {number} [config.maxUploadSize] - Maximum upload size in bytes (default 50MB)
   * @param {number} [config.uploadTokenTTL] - Upload token TTL in ms (default 5 minutes)
   * @param {number} [config.downloadTokenTTL] - Download token TTL in ms (default 1 hour)
   * @param {boolean} [config.ngrok] - Use ngrok tunnel for public URL (requires NGROK_AUTHTOKEN)
   */
  constructor(config = {}) {
    this.config = config;
    this._server = null;
    this._listener = null; // ngrok listener (if enabled)
    this._publicBaseUrl = null;
    this._downloads = new Map(); // token -> { localPath, filename, registeredAt }
    this._uploadTokens = new Map(); // uploadToken -> { createdAt, filename, maxBytes }
    this._uploadedFiles = new Map(); // fileToken -> { localPath, filename, uploadedAt }
    this._maxUploadSize = config.maxUploadSize || 50 * 1024 * 1024; // 50MB default
    this._uploadTokenTTL = config.uploadTokenTTL || 5 * 60 * 1000; // 5 minutes default
    this._downloadTokenTTL = config.downloadTokenTTL || DEFAULT_DOWNLOAD_TOKEN_TTL; // 1 hour default
    this._isRunning = false;
    this._cleanupTimer = null;
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
   * Creates HTTP server on first call, optionally with ngrok tunnel
   */
  async ensureRunning() {
    if (this._isRunning) {
      return;
    }

    // Clean up orphaned uploads from previous sessions
    this._cleanupOrphanedUploads();

    // Create HTTP server
    this._server = http.createServer(this._handleRequest.bind(this));

    // Determine port: use MCP_FILE_SERVER_PORT env var if set, otherwise random
    const envPort = process.env.MCP_FILE_SERVER_PORT;
    const port = envPort ? parseInt(envPort, 10) : 0;

    // Listen on 0.0.0.0 for Docker compatibility
    await new Promise((resolve, reject) => {
      this._server.listen(port, '0.0.0.0', () => resolve());
      this._server.on('error', reject);
    });

    const actualPort = this._server.address().port;

    // If ngrok is enabled, start tunnel and use ngrok URL
    if (this.config.ngrok) {
      const ngrok = await import('@ngrok/ngrok');
      try {
        this._listener = await ngrok.forward({
          addr: actualPort,
          authtoken_from_env: true,
        });
        this._publicBaseUrl = this._listener.url();
      } catch (error) {
        // Clean up server if ngrok fails
        this._server.close();
        this._server = null;
        throw new Error(`Failed to start ngrok tunnel: ${error.message}`);
      }
    } else {
      this._publicBaseUrl = `http://localhost:${actualPort}`;
    }

    this._isRunning = true;

    // Start periodic cleanup timer
    this._cleanupTimer = setInterval(() => {
      this._cleanupExpiredDownloads();
    }, CLEANUP_INTERVAL);
  }

  /**
   * Handle incoming HTTP requests
   * Routes to appropriate handler based on method and path
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  _handleRequest(req, res) {
    const urlPath = req.url || '/';

    // Add CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Upload-Token');

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Route based on method and path
    if (req.method === 'GET' && urlPath.startsWith('/downloads/')) {
      return this._handleDownload(req, res);
    }

    if (req.method === 'POST' && urlPath === '/uploads') {
      return this._handleUpload(req, res);
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  /**
   * Handle download requests
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  _handleDownload(req, res) {
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

    // Check if download token has expired
    if (Date.now() - download.registeredAt > this._downloadTokenTTL) {
      this._downloads.delete(token);
      res.writeHead(404);
      res.end('Download link expired');
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
   * Handle upload requests
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  _handleUpload(req, res) {
    // Validate upload token from header
    const uploadToken = req.headers['x-upload-token'];
    if (!uploadToken) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Missing X-Upload-Token header' }));
      return;
    }

    // Check if token exists and is valid
    const tokenData = this._uploadTokens.get(uploadToken);
    if (!tokenData) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid upload token' }));
      return;
    }

    // Check if token has expired
    if (Date.now() - tokenData.createdAt > this._uploadTokenTTL) {
      this._uploadTokens.delete(uploadToken);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Upload token expired' }));
      return;
    }

    // Check Content-Length header for size limit
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    const maxSize = tokenData.maxBytes || this._maxUploadSize;
    if (contentLength > maxSize) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: `File too large. Maximum size: ${maxSize} bytes` }));
      return;
    }

    // Ensure uploads directory exists
    const uploadsDir = this._getUploadsDir();
    mkdirSync(uploadsDir, { recursive: true });

    // Parse multipart form data
    let busboy;
    try {
      busboy = Busboy({ headers: req.headers, limits: { fileSize: maxSize } });
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid request format. Expected multipart/form-data' }));
      return;
    }

    let fileReceived = false;
    let uploadedFilePath = null;
    let uploadedFilename = null;
    let uploadedBytes = 0;
    let fileTooLarge = false;
    let writeStreamFinished = false;
    let busboyFinished = false;
    let responseHandled = false;

    const sendResponse = () => {
      // Wait for both busboy and write stream to finish
      if (!busboyFinished || !writeStreamFinished || responseHandled) {
        return;
      }
      responseHandled = true;

      // Invalidate the upload token (single use)
      this._uploadTokens.delete(uploadToken);

      if (fileTooLarge) {
        // Clean up partial file
        try {
          if (uploadedFilePath && existsSync(uploadedFilePath)) {
            unlinkSync(uploadedFilePath);
          }
        } catch (e) { /* ignore cleanup errors */ }

        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: `File too large. Maximum size: ${maxSize} bytes` }));
        return;
      }

      if (!fileReceived || !uploadedFilePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'No file received' }));
        return;
      }

      // Generate file token for later use with browser_file_upload
      const fileToken = randomUUID();
      this._uploadedFiles.set(fileToken, {
        localPath: uploadedFilePath,
        filename: uploadedFilename,
        uploadedAt: Date.now(),
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        fileToken,
        filename: uploadedFilename,
        bytes: uploadedBytes,
      }));
    };

    busboy.on('file', (fieldname, fileStream, info) => {
      if (fileReceived) {
        // Only accept one file per upload
        fileStream.resume();
        return;
      }
      fileReceived = true;

      const { filename } = info;
      uploadedFilename = filename || tokenData.filename || 'uploaded-file';

      // Generate unique filename to avoid collisions
      const fileTokenForPath = randomUUID();
      const safeFilename = uploadedFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
      uploadedFilePath = path.join(uploadsDir, `${fileTokenForPath}-${safeFilename}`);

      const writeStream = createWriteStream(uploadedFilePath);

      fileStream.on('data', (data) => {
        uploadedBytes += data.length;
        if (uploadedBytes > maxSize) {
          fileTooLarge = true;
          fileStream.destroy();
          writeStream.destroy();
        }
      });

      writeStream.on('finish', () => {
        writeStreamFinished = true;
        sendResponse();
      });

      writeStream.on('error', () => {
        writeStreamFinished = true;
        sendResponse();
      });

      fileStream.pipe(writeStream);

      fileStream.on('limit', () => {
        fileTooLarge = true;
      });
    });

    busboy.on('finish', () => {
      busboyFinished = true;
      // If no file was received, we can respond immediately
      if (!fileReceived) {
        writeStreamFinished = true;
      }
      sendResponse();
    });

    busboy.on('error', (error) => {
      if (!responseHandled) {
        responseHandled = true;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: `Upload error: ${error.message}` }));
      }
    });

    // Handle request errors
    req.on('error', (error) => {
      if (!responseHandled) {
        responseHandled = true;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: `Request error: ${error.message}` }));
      }
    });

    // Handle aborted requests
    req.on('aborted', () => {
      if (!responseHandled) {
        responseHandled = true;
        // Don't send response on aborted request
      }
    });

    try {
      req.pipe(busboy);
    } catch (error) {
      if (!responseHandled) {
        responseHandled = true;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: `Pipe error: ${error.message}` }));
      }
    }
  }

  /**
   * Get the uploads directory path
   * @returns {string}
   */
  _getUploadsDir() {
    const tempDir = this.config.tempDir || tmpdir();
    return path.join(tempDir, 'playwright-mcp', 'uploads');
  }

  /**
   * Clean up orphaned upload files from previous sessions
   * Called on startup to clear any leftover files in the uploads directory
   */
  _cleanupOrphanedUploads() {
    const uploadsDir = this._getUploadsDir();
    if (!existsSync(uploadsDir)) {
      return;
    }

    try {
      const files = readdirSync(uploadsDir);
      for (const file of files) {
        try {
          const filePath = path.join(uploadsDir, file);
          rmSync(filePath, { force: true });
        } catch (e) {
          // Ignore individual file cleanup errors
        }
      }
    } catch (e) {
      // Ignore directory read errors
    }
  }

  /**
   * Clean up expired download tokens
   * Removes download registrations that have exceeded their TTL
   */
  _cleanupExpiredDownloads() {
    const now = Date.now();
    const expiredTokens = [];

    for (const [token, download] of this._downloads.entries()) {
      if (now - download.registeredAt > this._downloadTokenTTL) {
        expiredTokens.push(token);
      }
    }

    for (const token of expiredTokens) {
      this._downloads.delete(token);
    }
  }

  /**
   * Register a downloaded file for serving
   * @param {string} localPath - Absolute path to the downloaded file
   * @param {string} filename - Original filename for download
   * @returns {{ token: string, publicUrl: string }}
   */
  registerDownload(localPath, filename) {
    // Clean up expired downloads before registering new one
    this._cleanupExpiredDownloads();

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
   * Resolve a download token to its local file path
   * Validates token exists, checks TTL expiration, and verifies filename
   *
   * @param {string} token - The download token from URL
   * @param {string} filename - The filename from URL (for validation)
   * @returns {{ localPath: string, filename: string }} File info
   * @throws {Error} If token is invalid, expired, or filename doesn't match
   */
  resolveDownloadToken(token, filename) {
    // Check if token exists
    const download = this._downloads.get(token);
    if (!download) {
      throw new Error('Download token not found or has been invalidated');
    }

    // Check if token has expired (same TTL check as _handleDownload)
    if (Date.now() - download.registeredAt > this._downloadTokenTTL) {
      this._downloads.delete(token);
      throw new Error('Download token has expired');
    }

    // Validate filename matches (security check)
    if (filename !== download.filename) {
      throw new Error('Filename does not match download token');
    }

    // Verify file still exists
    if (!existsSync(download.localPath)) {
      this._downloads.delete(token);
      throw new Error('Downloaded file no longer exists');
    }

    return {
      localPath: download.localPath,
      filename: download.filename,
    };
  }

  /**
   * Register a new upload token
   * @param {Object} options - Options for the upload
   * @param {string} [options.filename] - Expected filename (optional)
   * @param {number} [options.maxBytes] - Max file size for this upload (optional, uses default if not specified)
   * @returns {{ uploadToken: string, uploadUrl: string, expiresIn: number }}
   */
  registerUploadToken(options = {}) {
    const uploadToken = randomUUID();
    const expiresIn = Math.floor(this._uploadTokenTTL / 1000); // Convert to seconds

    this._uploadTokens.set(uploadToken, {
      createdAt: Date.now(),
      filename: options.filename || null,
      maxBytes: options.maxBytes || null,
    });

    const uploadUrl = `${this._publicBaseUrl}/uploads`;

    return {
      uploadToken,
      uploadUrl,
      expiresIn,
    };
  }

  /**
   * Get the local file path for an uploaded file token
   * @param {string} fileToken - Token from a completed upload
   * @returns {string|null} Local file path, or null if token is invalid/expired
   */
  getUploadedFilePath(fileToken) {
    const uploadData = this._uploadedFiles.get(fileToken);
    if (!uploadData) {
      return null;
    }

    // Check if file still exists
    if (!existsSync(uploadData.localPath)) {
      this._uploadedFiles.delete(fileToken);
      return null;
    }

    return uploadData.localPath;
  }

  /**
   * Get the filename for an uploaded file token
   * @param {string} fileToken - Token from a completed upload
   * @returns {string|null} Original filename, or null if token is invalid
   */
  getUploadedFilename(fileToken) {
    const uploadData = this._uploadedFiles.get(fileToken);
    return uploadData ? uploadData.filename : null;
  }

  /**
   * Delete all files in the uploads directory
   * Called during stop() to clean up uploaded files
   */
  _cleanupUploadFiles() {
    const uploadsDir = this._getUploadsDir();
    if (!existsSync(uploadsDir)) {
      return;
    }

    try {
      const files = readdirSync(uploadsDir);
      for (const file of files) {
        try {
          const filePath = path.join(uploadsDir, file);
          rmSync(filePath, { force: true });
        } catch (e) {
          // Ignore individual file cleanup errors
        }
      }
    } catch (e) {
      // Ignore directory read errors
    }
  }

  /**
   * Stop the server and clean up resources
   */
  async stop() {
    if (!this._isRunning) {
      return;
    }

    // Stop cleanup timer
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }

    // Close ngrok listener if present
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

    // Clean up uploaded files from disk
    this._cleanupUploadFiles();

    // Clear all maps
    this._downloads.clear();
    this._uploadTokens.clear();
    this._uploadedFiles.clear();
    this._publicBaseUrl = null;
    this._isRunning = false;
  }
}

export default LocalhostServer;
