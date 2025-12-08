/**
 * NgrokManager - Manages ngrok tunnel for serving downloaded files and accepting uploads
 *
 * Provides:
 * - HTTP server to serve downloaded files
 * - HTTP server to accept file uploads from sandboxed environments
 * - ngrok tunnel for public URL access
 * - Security via session-scoped token whitelists
 * - Lazy initialization (only starts on first download/upload)
 */

import http from 'http';
import { createReadStream, createWriteStream, existsSync, statSync, mkdirSync, unlinkSync } from 'fs';
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
   * @param {number} [config.maxUploadSize] - Maximum upload size in bytes (default 50MB)
   * @param {number} [config.uploadTokenTTL] - Upload token TTL in ms (default 5 minutes)
   */
  constructor(config = {}) {
    this.config = config;
    this._server = null;
    this._listener = null;
    this._publicBaseUrl = null;
    this._downloads = new Map(); // token -> { localPath, filename }
    this._uploadTokens = new Map(); // uploadToken -> { createdAt, filename, maxBytes }
    this._uploadedFiles = new Map(); // fileToken -> { localPath, filename, uploadedAt }
    this._maxUploadSize = config.maxUploadSize || 50 * 1024 * 1024; // 50MB default
    this._uploadTokenTTL = config.uploadTokenTTL || 5 * 60 * 1000; // 5 minutes default
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

    // Clear all maps
    this._downloads.clear();
    this._uploadTokens.clear();
    this._uploadedFiles.clear();
    this._publicBaseUrl = null;
    this._isRunning = false;
  }
}

export default NgrokManager;
