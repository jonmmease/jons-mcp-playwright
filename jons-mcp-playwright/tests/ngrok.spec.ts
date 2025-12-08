/**
 * Tests for ngrok download URL functionality
 *
 * Note: Most tests run without real ngrok to avoid network dependencies.
 * Tests that require real ngrok are marked with .skip and can be run manually
 * with NGROK_AUTHTOKEN set.
 */

import { test, expect } from './fixtures';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('ngrok CLI flag', () => {
  test('--ngrok flag requires NGROK_AUTHTOKEN', async () => {
    // Spawn CLI with --ngrok but without NGROK_AUTHTOKEN
    const cliPath = path.join(__dirname, '../cli.js');

    const result = await new Promise<{ code: number; stderr: string }>((resolve) => {
      const proc = spawn('node', [cliPath, '--ngrok'], {
        env: { ...process.env, NGROK_AUTHTOKEN: '' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({ code: code ?? 1, stderr });
      });

      // Kill after a short timeout in case it doesn't exit
      setTimeout(() => proc.kill(), 3000);
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--ngrok requires NGROK_AUTHTOKEN');
  });

  test('--ngrok appears in help text', async () => {
    const cliPath = path.join(__dirname, '../cli.js');

    const result = await new Promise<{ stdout: string }>((resolve) => {
      const proc = spawn('node', [cliPath, '--help'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.on('close', () => {
        resolve({ stdout });
      });
    });

    expect(result.stdout).toContain('--ngrok');
    expect(result.stdout).toContain('ngrok tunnel');
  });
});

test.describe('ngrok disabled (default)', () => {
  test('saveToFile shows local path when ngrok disabled', async ({ client, server }) => {
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

    // Should show local path, not ngrok URL
    expect(text).toContain('Path:');
    expect(text).not.toContain('ngrok');
    expect(text).not.toContain('https://');
  });

  test('browser_get_text saveToFile shows local path when ngrok disabled', async ({ client, server }) => {
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

    // Should show local path, not ngrok URL
    expect(text).toContain('saved to:');
    expect(text).not.toContain('ngrok');
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

// Tests that require real ngrok - skip by default
test.describe('ngrok enabled (requires NGROK_AUTHTOKEN)', () => {
  // Skip these tests unless NGROK_AUTHTOKEN is set
  test.skip(!process.env.NGROK_AUTHTOKEN, 'Requires NGROK_AUTHTOKEN environment variable');

  test('saveToFile shows ngrok URL when enabled', async ({ startClient, server }) => {
    const { client } = await startClient({
      args: ['--ngrok'],
    });

    server.setRoute('/ngrok-test', (req, res) => {
      res.end('<html><body><p>Test content</p></body></html>');
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/ngrok-test' } });
    const response = await client.callTool({
      name: 'browser_snapshot',
      arguments: { saveToFile: true },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;

    // Should show ngrok URL instead of local path
    expect(text).toContain('https://');
    expect(text).toMatch(/\.ngrok.*\.io|ngrok-free\.(app|dev)/);
  });
});
