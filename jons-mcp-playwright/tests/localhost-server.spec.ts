/**
 * Tests for localhost server file serving and upload functionality
 *
 * The localhost server provides URL-based access to files for sandboxed environments.
 * It runs automatically (no flags needed) and binds to 0.0.0.0 for Docker compatibility.
 */

import { test, expect } from './fixtures';

test.describe('localhost server download URLs', () => {
  test('saveToFile shows localhost URL', async ({ client, server }) => {
    server.setRoute('/save', (req, res) => {
      res.end('<html><body><p>Hello World</p></body></html>');
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/save' } });
    const response = await client.callTool({
      name: 'browser_snapshot',
      arguments: { saveToFile: true },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;

    // Should show localhost URL with /downloads/ path
    expect(text).toContain('http://localhost:');
    expect(text).toContain('/downloads/');
  });

  test('browser_get_text saveToFile shows localhost URL', async ({ client, server }) => {
    server.setRoute('/text', (req, res) => {
      res.end('<html><body><button>Some text</button></body></html>');
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/text' } });

    // Get ref for the button
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/button[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_get_text',
      arguments: { ref, saveToFile: true },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;

    // Should show localhost URL with /downloads/ path
    expect(text).toContain('http://localhost:');
    expect(text).toContain('/downloads/');
  });

  test('download URL returns file content with curl', async ({ client, server }) => {
    server.setRoute('/download-test', (req, res) => {
      res.end('<html><body><p>Download test content</p></body></html>');
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/download-test' } });
    const response = await client.callTool({
      name: 'browser_snapshot',
      arguments: { saveToFile: true },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;

    // Extract the download URL (format: /downloads/{token}/{filename})
    const urlMatch = text.match(/http:\/\/localhost:\d+\/downloads\/[a-f0-9-]+\/[^\s]+/);
    expect(urlMatch).toBeTruthy();
    const downloadUrl = urlMatch![0];

    // Fetch the file
    const fetchResponse = await fetch(downloadUrl);
    expect(fetchResponse.status).toBe(200);
    const content = await fetchResponse.text();
    expect(content).toContain('Download test content');
  });
});

// Unit tests for the regex patterns used in post-processing
test.describe('download path detection patterns', () => {
  // These test the regex patterns used in _postProcessResult

  test('browser download pattern matches expected format', () => {
    const browserDownloadRegex = /^- Downloaded file (.+) to (.+)$/gm;

    const testCases = [
      {
        input: '- Downloaded file document.pdf to /tmp/playwright-mcp/downloads/document.pdf',
        filename: 'document.pdf',
        path: '/tmp/playwright-mcp/downloads/document.pdf',
      },
      {
        input: '- Downloaded file my file.xlsx to /var/folders/abc/file.xlsx',
        filename: 'my file.xlsx',
        path: '/var/folders/abc/file.xlsx',
      },
    ];

    for (const tc of testCases) {
      browserDownloadRegex.lastIndex = 0;
      const match = browserDownloadRegex.exec(tc.input);
      expect(match).toBeTruthy();
      expect(match![1]).toBe(tc.filename);
      expect(match![2]).toBe(tc.path);
    }
  });

  test('saveToFile pattern matches expected formats', () => {
    const saveToFileRegex = /(?:Path:|saved to:|Saved to:|Snapshot saved to file\.\s*\n\s*Path:)\s*(.+)$/gm;

    const testCases = [
      {
        input: 'Path: /tmp/playwright-mcp/snapshot-123.yaml',
        path: '/tmp/playwright-mcp/snapshot-123.yaml',
      },
      {
        input: 'Text saved to: /tmp/playwright-mcp/text-456.txt',
        path: '/tmp/playwright-mcp/text-456.txt',
      },
      {
        input: 'Saved to: /var/folders/output.md',
        path: '/var/folders/output.md',
      },
    ];

    for (const tc of testCases) {
      saveToFileRegex.lastIndex = 0;
      const match = saveToFileRegex.exec(tc.input);
      expect(match).toBeTruthy();
      expect(match![1].trim()).toBe(tc.path);
    }
  });
});

test.describe('upload tools', () => {
  test('browser_request_upload returns upload URL and token', async ({ client }) => {
    const response = await client.callTool({
      name: 'browser_request_upload',
      arguments: { filename: 'test.pdf' },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    expect(text).toContain('Upload URL');
    expect(text).toContain('Upload Token');
    expect(text).toContain('http://localhost:');
    expect(text).toContain('/upload');
    expect(text).toContain('X-Upload-Token');
  });

  test('browser_request_upload tool is available', async ({ client }) => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t: any) => t.name);
    expect(toolNames).toContain('browser_request_upload');
  });

  test('browser_file_upload schema includes fileTokens parameter', async ({ client }) => {
    const tools = await client.listTools();
    const fileUploadTool = tools.tools.find((t: any) => t.name === 'browser_file_upload');
    expect(fileUploadTool).toBeTruthy();
    expect(fileUploadTool.inputSchema.properties.fileTokens).toBeTruthy();
    expect(fileUploadTool.inputSchema.properties.fileTokens.type).toBe('array');
  });

  test('browser_file_upload with invalid fileToken returns error', async ({ client, server }) => {
    server.setRoute('/upload-form', (req, res) => {
      res.end(`
        <html><body>
          <input type="file" id="fileInput">
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/upload-form' } });

    // Try to use fileTokens with invalid token
    const response = await client.callTool({
      name: 'browser_file_upload',
      arguments: { fileTokens: ['invalid-token-123'] },
    });

    expect(response.isError).toBe(true);
    const text = response.content[0].text;
    expect(text).toContain('Invalid');
  });

  test('full upload flow: request_upload -> POST -> file available', async ({ client }) => {
    // Step 1: Get upload URL
    const uploadResponse = await client.callTool({
      name: 'browser_request_upload',
      arguments: { filename: 'test.txt' },
    });

    expect(uploadResponse.isError).toBeFalsy();
    const text = uploadResponse.content[0].text;

    // Extract upload URL and token from response
    const urlMatch = text.match(/\*\*Upload URL:\*\* (http:\/\/[^\s]+)/);
    const tokenMatch = text.match(/\*\*Upload Token:\*\* ([a-f0-9-]+)/);
    expect(urlMatch).toBeTruthy();
    expect(tokenMatch).toBeTruthy();

    const uploadUrl = urlMatch![1];
    const uploadToken = tokenMatch![1];

    // Step 2: POST a file to the upload URL using native fetch with FormData
    const formData = new globalThis.FormData();
    const blob = new Blob(['Hello from test!'], { type: 'text/plain' });
    formData.append('file', blob, 'test.txt');

    const fetchResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Upload-Token': uploadToken,
      },
      body: formData,
    });

    const responseBody = await fetchResponse.text();

    if (fetchResponse.status !== 200) {
      console.log('Upload failed. Status:', fetchResponse.status);
      console.log('Response body:', responseBody);
    }
    expect(fetchResponse.status).toBe(200);
    const jsonResponse = JSON.parse(responseBody);
    expect(jsonResponse.success).toBe(true);
    expect(jsonResponse.fileToken).toBeTruthy();
    expect(jsonResponse.filename).toBe('test.txt');
    expect(jsonResponse.bytes).toBe(16); // "Hello from test!".length
  });
});

test.describe('MCP_FILE_SERVER_PORT env var', () => {
  test('uses fixed port when MCP_FILE_SERVER_PORT is set', async ({ startClient }) => {
    const fixedPort = 19876;
    const { client } = await startClient({
      env: { MCP_FILE_SERVER_PORT: String(fixedPort) },
    });

    const response = await client.callTool({
      name: 'browser_request_upload',
      arguments: { filename: 'test.txt' },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    expect(text).toContain(`http://localhost:${fixedPort}`);
  });
});

test.describe('download token expiry', () => {
  // Note: This test is designed to check token expiry logic.
  // In production, tokens expire after 1 hour. For testing, we just verify
  // that the token validation mechanism works.

  test('expired tokens return 404', async ({ client, server }) => {
    // This test validates that requesting a non-existent/expired token returns 404
    server.setRoute('/expiry-test', (req, res) => {
      res.end('<html><body><p>Expiry test</p></body></html>');
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/expiry-test' } });
    const response = await client.callTool({
      name: 'browser_snapshot',
      arguments: { saveToFile: true },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;

    // Extract the download URL (format: /downloads/{token}/{filename})
    const urlMatch = text.match(/http:\/\/localhost:(\d+)\/downloads\/[a-f0-9-]+\/[^\s]+/);
    expect(urlMatch).toBeTruthy();
    const port = urlMatch![1];

    // Try to access a non-existent token (simulates expired token)
    const fakeToken = '00000000-0000-0000-0000-000000000000';
    const fakeUrl = `http://localhost:${port}/downloads/${fakeToken}/fake-file.txt`;
    const fetchResponse = await fetch(fakeUrl);
    expect(fetchResponse.status).toBe(404);
  });
});
