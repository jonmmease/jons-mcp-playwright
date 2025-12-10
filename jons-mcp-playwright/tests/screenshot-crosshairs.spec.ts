/**
 * Tests for screenshot crosshairs feature
 */

import { test, expect } from './fixtures';

test.describe('browser_take_screenshot with cursor_coordinates', () => {
  test('draws crosshairs at specified coordinates', async ({ client, server }) => {
    server.setRoute('/crosshairs', (req, res) => {
      res.end(`
        <html>
          <body style="margin:0;padding:0;width:800px;height:600px;background:#f0f0f0;">
            <div style="position:absolute;left:100px;top:100px;width:100px;height:100px;background:blue;"></div>
          </body>
        </html>
      `);
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/crosshairs' },
    });

    const response = await client.callTool({
      name: 'browser_take_screenshot',
      arguments: {
        cursor_coordinates: { x: 150, y: 150 },
      },
    });

    expect(response.isError).toBeFalsy();
    // Response should contain coordinate explanation
    const text = response.content[0].text;
    expect(text).toContain('Crosshairs drawn at (150, 150)');
    expect(text).toContain('Origin (0,0) is top-left');
    expect(text).toContain('CSS pixels');
    // Should contain distance circle color table
    expect(text).toContain('Red');
    expect(text).toContain('10px');
    expect(text).toContain('Green');
    expect(text).toContain('100px');
    // Should contain image
    expect(response.content.some((c: any) => c.type === 'image')).toBe(true);
  });

  test('takes clean screenshot without cursor_coordinates', async ({ client, server }) => {
    server.setRoute('/clean', (req, res) => {
      res.end('<html><body><p>Clean page</p></body></html>');
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/clean' },
    });

    const response = await client.callTool({
      name: 'browser_take_screenshot',
      arguments: {},
    });

    expect(response.isError).toBeFalsy();
    // Should NOT contain coordinate explanation
    const text = response.content[0]?.text || '';
    expect(text).not.toContain('Crosshairs drawn at');
  });

  test('handles edge coordinates (0,0)', async ({ client, server }) => {
    server.setRoute('/origin', (req, res) => {
      res.end('<html><body style="margin:0;padding:0;">Origin test</body></html>');
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/origin' },
    });

    const response = await client.callTool({
      name: 'browser_take_screenshot',
      arguments: {
        cursor_coordinates: { x: 0, y: 0 },
      },
    });

    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toContain('Crosshairs drawn at (0, 0)');
  });

  test('handles large coordinates', async ({ client, server }) => {
    server.setRoute('/large', (req, res) => {
      res.end('<html><body style="width:2000px;height:2000px;">Large page</body></html>');
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/large' },
    });

    const response = await client.callTool({
      name: 'browser_take_screenshot',
      arguments: {
        cursor_coordinates: { x: 1500, y: 1500 },
      },
    });

    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toContain('Crosshairs drawn at (1500, 1500)');
  });

  test('validates cursor_coordinates structure - missing y ignored', async ({ client, server }) => {
    server.setRoute('/validate', (req, res) => {
      res.end('<html><body>Validation test</body></html>');
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/validate' },
    });

    // Invalid: missing y coordinate - should take screenshot without crosshairs
    const response = await client.callTool({
      name: 'browser_take_screenshot',
      arguments: {
        cursor_coordinates: { x: 100 },
      },
    });

    expect(response.isError).toBeFalsy();
    // Should NOT contain coordinate explanation (invalid coordinates ignored)
    const text = response.content[0]?.text || '';
    expect(text).not.toContain('Crosshairs drawn at');
  });

  test('crosshairs removed after screenshot', async ({ client, server }) => {
    server.setRoute('/cleanup', (req, res) => {
      res.end('<html><body>Cleanup test</body></html>');
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/cleanup' },
    });

    // Take screenshot with crosshairs
    await client.callTool({
      name: 'browser_take_screenshot',
      arguments: { cursor_coordinates: { x: 200, y: 200 } },
    });

    // Verify crosshairs element was removed
    const evalResult = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        function: `() => document.getElementById('__mcp-screenshot-crosshairs') === null`,
      },
    });

    expect(evalResult.isError).toBeFalsy();
    expect(evalResult.content[0].text).toContain('true');
  });

  test('tool schema includes cursor_coordinates', async ({ client }) => {
    const tools = await client.listTools();
    const screenshotTool = tools.tools.find((t: any) => t.name === 'browser_take_screenshot');

    expect(screenshotTool).toBeTruthy();
    expect(screenshotTool.inputSchema.properties.cursor_coordinates).toBeTruthy();
    expect(screenshotTool.inputSchema.properties.cursor_coordinates.type).toBe('object');
    expect(screenshotTool.inputSchema.properties.cursor_coordinates.properties.x).toBeTruthy();
    expect(screenshotTool.inputSchema.properties.cursor_coordinates.properties.y).toBeTruthy();
  });
});
