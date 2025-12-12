/**
 * Tests for browser_console_messages filtering
 */

import { test, expect } from './fixtures';

test.describe('browser_console_messages filtering', () => {
  test('default call returns messages', async ({ client, server }) => {
    server.setRoute('/console', (req, res) => {
      res.end(`
        <html><body>
          <script>
            console.log('Log message');
            console.warn('Warning message');
            console.error('Error message');
          </script>
          <p>Console test page</p>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/console' } });

    const response = await client.callTool({
      name: 'browser_console_messages',
      arguments: {},
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    expect(text).toContain('Log message');
    expect(text).toContain('Warning message');
    expect(text).toContain('Error message');
  });

  test('type filter works for error', async ({ client, server }) => {
    server.setRoute('/console-types', (req, res) => {
      res.end(`
        <html><body>
          <script>
            console.log('This is a log');
            console.warn('This is a warning');
            console.error('This is an error');
            console.info('This is info');
          </script>
          <p>Console test</p>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/console-types' } });

    const response = await client.callTool({
      name: 'browser_console_messages',
      arguments: { type: 'error' },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    expect(text).toContain('This is an error');
    expect(text).not.toContain('This is a log');
    expect(text).not.toContain('This is a warning');
    expect(text).not.toContain('This is info');
  });

  test('type filter works for warn', async ({ client, server }) => {
    server.setRoute('/console-warn', (req, res) => {
      res.end(`
        <html><body>
          <script>
            console.log('Log entry');
            console.warn('Warning entry');
            console.error('Error entry');
          </script>
          <p>Console test</p>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/console-warn' } });

    const response = await client.callTool({
      name: 'browser_console_messages',
      arguments: { type: 'warn' },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    expect(text).toContain('Warning entry');
    expect(text).not.toContain('Log entry');
    expect(text).not.toContain('Error entry');
  });

  test('type filter works for log', async ({ client, server }) => {
    server.setRoute('/console-log', (req, res) => {
      res.end(`
        <html><body>
          <script>
            console.log('Just a log');
            console.warn('Just a warning');
          </script>
          <p>Console test</p>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/console-log' } });

    const response = await client.callTool({
      name: 'browser_console_messages',
      arguments: { type: 'log' },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    expect(text).toContain('Just a log');
    expect(text).not.toContain('Just a warning');
  });

  test('contains filter matches case-insensitive substring', async ({ client, server }) => {
    server.setRoute('/console-contains', (req, res) => {
      res.end(`
        <html><body>
          <script>
            console.log('Loading data...');
            console.log('Data LOADED successfully');
            console.log('Processing complete');
          </script>
          <p>Console test</p>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/console-contains' } });

    const response = await client.callTool({
      name: 'browser_console_messages',
      arguments: { contains: 'load' },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    expect(text).toContain('Loading data');
    expect(text).toContain('Data LOADED');
    expect(text).not.toContain('Processing complete');
  });

  test('pattern filter matches message text with regex', async ({ client, server }) => {
    server.setRoute('/console-pattern', (req, res) => {
      res.end(`
        <html><body>
          <script>
            console.log('User 123 logged in');
            console.log('User 456 logged out');
            console.log('System started');
          </script>
          <p>Console test</p>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/console-pattern' } });

    const response = await client.callTool({
      name: 'browser_console_messages',
      arguments: { pattern: 'User \\d+ logged' },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    expect(text).toContain('User 123 logged in');
    expect(text).toContain('User 456 logged out');
    expect(text).not.toContain('System started');
  });

  test('limit restricts count to most recent N', async ({ client, server }) => {
    server.setRoute('/console-limit', (req, res) => {
      res.end(`
        <html>
          <head><link rel="icon" href="data:,"></head>
          <body>
            <script>
              console.log('Message 1');
              console.log('Message 2');
              console.log('Message 3');
              console.log('Message 4');
              console.log('Message 5');
            </script>
            <p>Console test</p>
          </body>
        </html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/console-limit' } });

    // Filter to only LOG type and limit to 3
    const response = await client.callTool({
      name: 'browser_console_messages',
      arguments: { type: 'log', limit: 3 },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    // Should have only the last 3 log messages
    expect(text).toContain('Message 3');
    expect(text).toContain('Message 4');
    expect(text).toContain('Message 5');
    expect(text).not.toContain('Message 1');
    expect(text).not.toContain('Message 2');
  });

  test('combined filters work together', async ({ client, server }) => {
    server.setRoute('/console-combined', (req, res) => {
      res.end(`
        <html>
          <head><link rel="icon" href="data:,"></head>
          <body>
            <script>
              console.error('network failure occurred');
              console.error('timeout failure occurred');
              console.warn('deprecated api warning');
              console.log('request started');
              console.error('connection failure occurred');
            </script>
            <p>Console test</p>
          </body>
        </html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/console-combined' } });

    // Filter: type=error + contains="failure" + limit=2
    const response = await client.callTool({
      name: 'browser_console_messages',
      arguments: { type: 'error', contains: 'failure', limit: 2 },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    // Should have only the last 2 errors containing "failure"
    expect(text).toContain('timeout failure');
    expect(text).toContain('connection failure');
    expect(text).not.toContain('network failure');
    expect(text).not.toContain('deprecated');
    expect(text).not.toContain('request started');
  });

  test('empty result when no matches', async ({ client, server }) => {
    server.setRoute('/console-empty', (req, res) => {
      res.end(`
        <html>
          <head><link rel="icon" href="data:,"></head>
          <body>
            <script>
              console.log('Just a log');
            </script>
            <p>Console test</p>
          </body>
        </html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/console-empty' } });

    // Filter for warnings - should find none since we only logged
    const response = await client.callTool({
      name: 'browser_console_messages',
      arguments: { type: 'warn' },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    expect(text).toContain('No console messages');
  });

  test('invalid regex pattern returns error', async ({ client, server }) => {
    server.setRoute('/console-regex-err', (req, res) => {
      res.end(`
        <html><body>
          <script>
            console.log('Test message');
          </script>
          <p>Console test</p>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/console-regex-err' } });

    const response = await client.callTool({
      name: 'browser_console_messages',
      arguments: { pattern: '[invalid' },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Invalid regex');
  });
});
