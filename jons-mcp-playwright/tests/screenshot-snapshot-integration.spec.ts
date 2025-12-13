/**
 * Integration tests for browser_screenshot_snapshot tool
 *
 * Tests tool visibility, error handling, and v-ref operations.
 * Integration tests requiring Gemini API only run when GEMINI_API_KEY is set.
 */

import { test, expect } from './fixtures';

test.describe('browser_screenshot_snapshot tool visibility', () => {
  test('tool is hidden when vision capability is disabled', async ({ client }) => {
    // Default client has no vision capability
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    expect(toolNames).not.toContain('browser_screenshot_snapshot');
  });

  test('tool is available when vision capability is enabled', async ({ startClient }) => {
    const { client } = await startClient({ args: ['--playwright-caps=vision'] });
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    expect(toolNames).toContain('browser_screenshot_snapshot');
  });

  test('returns error when called without vision capability', async ({ client }) => {
    const response = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: {},
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toContain('requires vision capability');
    expect(text).toContain('--playwright-caps=vision');
  });
});

test.describe('browser_screenshot_snapshot error handling', () => {
  test('returns error when GEMINI_API_KEY is not set', async ({ startClient, server }) => {
    server.setRoute('/simple', (req, res) => {
      res.end('<html><body><p>Hello World</p></body></html>');
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
      env: { GEMINI_API_KEY: '' },
    });

    // Navigate first so there's a page
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/simple' },
    });

    const response = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: {},
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toContain('GEMINI_API_KEY');
  });

  test('returns error when no browser is open', async ({ startClient }) => {
    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
      env: { GEMINI_API_KEY: 'test-key' },
    });

    // Don't navigate - try to snapshot without a page
    const response = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: {},
    });

    // Should indicate some kind of error (page not available, screenshot failed, etc.)
    expect(response.isError).toBe(true);
  });
});

test.describe('v-ref handling', () => {
  test('v-ref click returns error when ref is invalid', async ({ startClient, server }) => {
    server.setRoute('/simple', (req, res) => {
      res.end('<html><body><button>Click me</button></body></html>');
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
      env: { GEMINI_API_KEY: 'test-key' },
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/simple' },
    });

    // Try to click a v-ref that doesn't exist (no snapshot taken)
    const response = await client.callTool({
      name: 'browser_click',
      arguments: { ref: 'v1' },
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toMatch(/vision ref.*not found|expired|invalid/i);
  });

  test('v-ref hover returns error when ref is invalid', async ({ startClient, server }) => {
    server.setRoute('/simple', (req, res) => {
      res.end('<html><body><button>Hover me</button></body></html>');
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
      env: { GEMINI_API_KEY: 'test-key' },
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/simple' },
    });

    const response = await client.callTool({
      name: 'browser_hover',
      arguments: { ref: 'v1' },
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toMatch(/vision ref.*not found|expired|invalid/i);
  });

  test('v-ref bounds returns error when ref is invalid', async ({ startClient, server }) => {
    server.setRoute('/simple', (req, res) => {
      res.end('<html><body><div>Content</div></body></html>');
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
      env: { GEMINI_API_KEY: 'test-key' },
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/simple' },
    });

    const response = await client.callTool({
      name: 'browser_get_bounds',
      arguments: { ref: 'v99' },
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toMatch(/vision ref.*not found|expired|invalid/i);
  });

  test('v-ref get_text returns error when ref is invalid', async ({ startClient, server }) => {
    server.setRoute('/simple', (req, res) => {
      res.end('<html><body><p>Some text</p></body></html>');
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
      env: { GEMINI_API_KEY: 'test-key' },
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/simple' },
    });

    const response = await client.callTool({
      name: 'browser_get_text',
      arguments: { ref: 'v42' },
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toMatch(/vision ref.*not found|expired|invalid/i);
  });
});

// Integration tests - only run if GEMINI_API_KEY is set
const hasGeminiKey = !!process.env.GEMINI_API_KEY;

test.describe('browser_screenshot_snapshot integration', () => {
  test.skip(!hasGeminiKey, 'Requires GEMINI_API_KEY environment variable');

  test('generates accessibility tree from page screenshot', async ({ startClient, server }) => {
    server.setRoute('/chart', (req, res) => {
      res.end(`
        <html>
          <body style="padding: 20px;">
            <h1>Sales Report 2024</h1>
            <div style="width: 340px; height: 300px; background: #f0f0f0; padding: 20px;">
              <div style="display: flex; align-items: flex-end; height: 250px; gap: 20px;">
                <div style="background: #3498db; width: 60px; height: 80%;"></div>
                <div style="background: #2ecc71; width: 60px; height: 60%;"></div>
                <div style="background: #e74c3c; width: 60px; height: 90%;"></div>
                <div style="background: #f39c12; width: 60px; height: 45%;"></div>
              </div>
              <div style="display: flex; gap: 20px; padding-top: 10px;">
                <span style="width: 60px; text-align: center;">Q1</span>
                <span style="width: 60px; text-align: center;">Q2</span>
                <span style="width: 60px; text-align: center;">Q3</span>
                <span style="width: 60px; text-align: center;">Q4</span>
              </div>
            </div>
          </body>
        </html>
      `);
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/chart' },
    });

    const response = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: { description: 'A bar chart showing quarterly sales data' },
    });

    if (response.isError) {
      console.log('Snapshot error:', response.content?.[0]?.text);
    }
    expect(response.isError).toBeFalsy();

    const text = response.content?.[0]?.text || '';

    // Should include metadata
    expect(text).toContain('Image:');
    expect(text).toContain('Scale:');
    expect(text).toContain('Refs valid for:');

    // Should include annotated image URL
    expect(text).toContain('Annotated:');
    expect(text).toMatch(/Annotated: http:\/\/localhost:\d+\/downloads\/[a-f0-9-]+\/screenshot_\d+_annotated\.png/);

    // Should include YAML-formatted elements with v-refs
    expect(text).toMatch(/\[ref=v\d+\]/);

    // Should detect common elements (may vary by model)
    // Just verify we got some structured output
    expect(text.length).toBeGreaterThan(100);
  });

  test('annotated image URL is downloadable and returns valid PNG', async ({ startClient, server }) => {
    server.setRoute('/simple', (req, res) => {
      res.end(`
        <html>
          <body style="padding: 50px;">
            <h1>Test Heading</h1>
            <button style="padding: 20px;">Big Button</button>
          </body>
        </html>
      `);
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/simple' },
    });

    const response = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: { description: 'A page with a heading and button' },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content?.[0]?.text || '';

    // Extract annotated image URL
    const urlMatch = text.match(/Annotated: (http:\/\/localhost:\d+\/downloads\/[^\s]+)/);
    expect(urlMatch).toBeTruthy();

    const annotatedUrl = urlMatch![1];

    // Fetch the annotated image
    const imageResponse = await fetch(annotatedUrl);
    expect(imageResponse.ok).toBe(true);
    expect(imageResponse.headers.get('content-type')).toContain('image/png');

    // Verify it's a valid PNG (magic bytes)
    const buffer = await imageResponse.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // PNG magic bytes: 137 80 78 71 13 10 26 10
    expect(bytes[0]).toBe(137);
    expect(bytes[1]).toBe(80);  // P
    expect(bytes[2]).toBe(78);  // N
    expect(bytes[3]).toBe(71);  // G
  });

  test('v-ref click works after screenshot_snapshot', async ({ startClient, server }) => {
    server.setRoute('/button', (req, res) => {
      res.end(`
        <html>
          <body style="padding: 50px;">
            <button id="main-button" style="padding: 20px 40px; font-size: 24px; background: blue; color: white;">
              Click Me
            </button>
            <div id="result" style="margin-top: 20px;"></div>
            <script>
              document.getElementById('main-button').onclick = function() {
                document.getElementById('result').textContent = 'Button was clicked!';
              };
            </script>
          </body>
        </html>
      `);
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/button' },
    });

    // Take screenshot snapshot
    const snapshotResponse = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: { description: 'A page with a large blue button' },
    });

    expect(snapshotResponse.isError).toBeFalsy();

    // Find any v-ref from the response (first one should be the button)
    const snapshotText = snapshotResponse.content?.[0]?.text || '';

    // Look for any v-ref in the output
    const refMatch = snapshotText.match(/\[ref=(v\d+)\]/);
    expect(refMatch).toBeTruthy();

    const vRef = refMatch![1];

    // Click using the v-ref
    const clickResponse = await client.callTool({
      name: 'browser_click',
      arguments: { ref: vRef },
    });

    expect(clickResponse.isError).toBeFalsy();

    // Verify the click worked by checking the page state
    const snapshot = await client.callTool({
      name: 'browser_snapshot',
      arguments: {},
    });

    const pageText = snapshot.content?.[0]?.text || '';
    expect(pageText).toContain('Button was clicked!');
  });

  test('navigation clears v-ref cache', async ({ startClient, server }) => {
    server.setRoute('/page1', (req, res) => {
      res.end('<html><body><h1>Page 1</h1><button>Button 1</button></body></html>');
    });
    server.setRoute('/page2', (req, res) => {
      res.end('<html><body><h1>Page 2</h1><button>Button 2</button></body></html>');
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
    });

    // Navigate to page1 and take snapshot
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/page1' },
    });

    const snapshot1 = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: {},
    });
    expect(snapshot1.isError).toBeFalsy();

    // Navigate to page2
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/page2' },
    });

    // Try to click v1 from the old snapshot - should fail
    const clickResponse = await client.callTool({
      name: 'browser_click',
      arguments: { ref: 'v1' },
    });

    expect(clickResponse.isError).toBe(true);
    const text = clickResponse.content?.[0]?.text || '';
    expect(text).toMatch(/vision ref.*not found|expired|invalid|cleared/i);
  });
});
