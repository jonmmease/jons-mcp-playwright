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
      arguments: { ref: 'e1' },
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toContain('requires vision capability');
    expect(text).toContain('--playwright-caps=vision');
  });
});

test.describe('browser_screenshot_snapshot error handling', () => {
  test('returns error when ref is not provided', async ({ startClient, server }) => {
    server.setRoute('/simple', (req, res) => {
      res.end('<html><body><p>Hello World</p></body></html>');
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
      name: 'browser_screenshot_snapshot',
      arguments: {},
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toContain('requires a ref parameter');
    expect(text).toContain('img elements');
    expect(text).toContain('canvas elements');
  });

  test('returns error when GEMINI_API_KEY is not set', async ({ startClient, server }) => {
    server.setRoute('/simple', (req, res) => {
      res.end('<html><body><p id="target">Hello World</p></body></html>');
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
      env: { GEMINI_API_KEY: '' },
    });

    // Navigate first so there's a page and we can get a ref
    const navResponse = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/simple' },
    });

    // Extract a ref from the snapshot
    const navText = navResponse.content?.[0]?.text || '';
    const refMatch = navText.match(/\[ref=(e\d+)\]/);
    const ref = refMatch ? refMatch[1] : 'e1';

    const response = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: { ref },
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

    // Don't navigate - try to snapshot without a page (but with a ref)
    const response = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: { ref: 'e1' },
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
    // Use a canvas element since browser_screenshot_snapshot should be used on img/canvas
    server.setRoute('/chart', (req, res) => {
      res.end(`
        <html>
          <body style="padding: 20px;">
            <h1>Sales Report 2024</h1>
            <canvas id="chart" width="340" height="300" style="background: #f0f0f0;"></canvas>
            <script>
              const canvas = document.getElementById('chart');
              const ctx = canvas.getContext('2d');
              // Draw simple bar chart
              ctx.fillStyle = '#3498db'; ctx.fillRect(20, 50, 60, 200);
              ctx.fillStyle = '#2ecc71'; ctx.fillRect(100, 100, 60, 150);
              ctx.fillStyle = '#e74c3c'; ctx.fillRect(180, 30, 60, 220);
              ctx.fillStyle = '#f39c12'; ctx.fillRect(260, 140, 60, 110);
              // Labels
              ctx.fillStyle = '#000'; ctx.font = '14px sans-serif';
              ctx.fillText('Q1', 35, 280); ctx.fillText('Q2', 115, 280);
              ctx.fillText('Q3', 195, 280); ctx.fillText('Q4', 275, 280);
            </script>
          </body>
        </html>
      `);
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
    });

    const navResponse = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/chart' },
    });

    // Extract ref for the canvas element
    const navText = navResponse.content?.[0]?.text || '';
    const canvasRefMatch = navText.match(/\[ref=(e\d+)\].*canvas/i) || navText.match(/canvas.*\[ref=(e\d+)\]/i);
    // Fallback: find any ref
    const anyRefMatch = navText.match(/\[ref=(e\d+)\]/);
    const chartRef = canvasRefMatch ? canvasRefMatch[1] : (anyRefMatch ? anyRefMatch[1] : 'e1');

    const response = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: { ref: chartRef, description: 'A bar chart showing quarterly sales data' },
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
    // Use canvas element for screenshot_snapshot
    server.setRoute('/simple', (req, res) => {
      res.end(`
        <html>
          <body style="padding: 50px;">
            <h1>Test Heading</h1>
            <canvas id="chart" width="200" height="100" style="background: #eee;"></canvas>
            <script>
              const ctx = document.getElementById('chart').getContext('2d');
              ctx.fillStyle = 'blue'; ctx.fillRect(10, 10, 80, 80);
              ctx.fillStyle = 'red'; ctx.fillRect(110, 10, 80, 80);
            </script>
          </body>
        </html>
      `);
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
    });

    const navResponse = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/simple' },
    });

    // Get ref for canvas
    const navText = navResponse.content?.[0]?.text || '';
    const refMatch = navText.match(/\[ref=(e\d+)\]/);
    const canvasRef = refMatch ? refMatch[1] : 'e1';

    const response = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: { ref: canvasRef, description: 'A page with a heading and chart' },
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
    // Use canvas element - entire canvas is clickable (not just a button inside)
    // This makes the test resilient to Gemini detecting any part of the canvas
    server.setRoute('/button', (req, res) => {
      res.end(`
        <html>
          <body style="padding: 50px;">
            <canvas id="button-canvas" width="200" height="100" style="cursor: pointer; background: blue;"></canvas>
            <div id="result" style="margin-top: 20px;"></div>
            <script>
              const canvas = document.getElementById('button-canvas');
              const ctx = canvas.getContext('2d');
              // Fill entire canvas with clickable area
              ctx.fillStyle = 'blue'; ctx.fillRect(0, 0, 200, 100);
              ctx.fillStyle = 'white'; ctx.font = '24px sans-serif';
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillText('Click Anywhere', 100, 50);
              // Entire canvas is clickable
              canvas.onclick = function() {
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

    const navResponse = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/button' },
    });

    // Get ref for canvas - canvas may not appear in accessibility tree, so fallback to e1
    const navText = navResponse.content?.[0]?.text || '';
    const canvasRefMatch = navText.match(/graphics-document[^\[]*\[ref=(e\d+)\]/i)
      || navText.match(/img[^\[]*\[ref=(e\d+)\]/i);
    const canvasRef = canvasRefMatch ? canvasRefMatch[1] : 'e1';

    // Take screenshot snapshot of the canvas
    const snapshotResponse = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: { ref: canvasRef, description: 'A canvas with a blue button' },
    });

    expect(snapshotResponse.isError).toBeFalsy();

    // Find the button v-ref - prefer specific elements over the root img
    const snapshotText = snapshotResponse.content?.[0]?.text || '';
    let vRefMatch = snapshotText.match(/- button.*?\[ref=(v\d+)\]/)
      || snapshotText.match(/- paragraph.*?\[ref=(v\d+)\]/)
      || snapshotText.match(/- label.*?\[ref=(v\d+)\]/)
      || snapshotText.match(/\[ref=(v\d+)\]/);
    expect(vRefMatch).toBeTruthy();

    const vRef = vRefMatch![1];

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
    // Use canvas elements on both pages
    server.setRoute('/page1', (req, res) => {
      res.end(`
        <html><body>
          <h1>Page 1</h1>
          <canvas id="c1" width="100" height="50"></canvas>
          <script>
            const ctx = document.getElementById('c1').getContext('2d');
            ctx.fillStyle = 'blue'; ctx.fillRect(0, 0, 100, 50);
          </script>
        </body></html>
      `);
    });
    server.setRoute('/page2', (req, res) => {
      res.end(`
        <html><body>
          <h1>Page 2</h1>
          <canvas id="c2" width="100" height="50"></canvas>
          <script>
            const ctx = document.getElementById('c2').getContext('2d');
            ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 100, 50);
          </script>
        </body></html>
      `);
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
    });

    // Navigate to page1 and take snapshot
    const nav1 = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/page1' },
    });
    const nav1Text = nav1.content?.[0]?.text || '';
    const ref1Match = nav1Text.match(/\[ref=(e\d+)\]/);
    const ref1 = ref1Match ? ref1Match[1] : 'e1';

    const snapshot1 = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: { ref: ref1 },
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

  test('ref parameter crops to DOM element bounds', async ({ startClient, server }) => {
    server.setRoute('/layout', (req, res) => {
      res.end(`
        <html>
          <body style="margin: 0; padding: 0;">
            <div style="height: 100px; background: red;"></div>
            <div id="target" style="height: 200px; background: blue; display: flex; align-items: center; justify-content: center;">
              <button style="padding: 20px; font-size: 18px;">Target Button</button>
            </div>
            <div style="height: 100px; background: green;"></div>
          </body>
        </html>
      `);
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
    });

    // Navigate and get snapshot to find the target element ref
    const navResponse = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/layout' },
    });

    // Extract ref for #target from the snapshot
    const navText = navResponse.content?.[0]?.text || '';
    // Look for the group/generic containing "Target Button"
    const refMatch = navText.match(/\[ref=(e\d+)\].*Target Button/s) || navText.match(/\[ref=(e\d+)\].*target/i);

    // If we can find a ref, test cropped analysis
    if (refMatch) {
      const domRef = refMatch[1];

      // Take cropped screenshot snapshot of just that element
      const snapshotResponse = await client.callTool({
        name: 'browser_screenshot_snapshot',
        arguments: { ref: domRef, description: 'A blue section with a button' },
      });

      expect(snapshotResponse.isError).toBeFalsy();
      const text = snapshotResponse.content?.[0]?.text || '';

      // Should have detected elements
      expect(text).toMatch(/\[ref=v\d+\]/);

      // Should include annotated image URL
      expect(text).toContain('Annotated:');
    }
  });

  test('ref parameter with vision ref crops and returns absolute coordinates', async ({ startClient, server }) => {
    // Use canvas element
    server.setRoute('/chart', (req, res) => {
      res.end(`
        <html>
          <body style="padding: 50px;">
            <h1>Page Title</h1>
            <canvas id="chart" width="400" height="300" style="margin-top: 50px; background: #f0f0f0;"></canvas>
            <script>
              const ctx = document.getElementById('chart').getContext('2d');
              // Draw bars
              ctx.fillStyle = '#3498db'; ctx.fillRect(50, 50, 60, 200);
              ctx.fillStyle = '#2ecc71'; ctx.fillRect(150, 100, 60, 150);
              // Labels
              ctx.fillStyle = '#000'; ctx.font = '14px sans-serif';
              ctx.fillText('Q1', 65, 280); ctx.fillText('Q2', 165, 280);
            </script>
          </body>
        </html>
      `);
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
    });

    const navResponse = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/chart' },
    });

    // Get ref for canvas
    const navText = navResponse.content?.[0]?.text || '';
    const canvasRefMatch = navText.match(/\[ref=(e\d+)\]/);
    const canvasRef = canvasRefMatch ? canvasRefMatch[1] : 'e1';

    // First, take a screenshot snapshot of the canvas
    const fullSnapshot = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: { ref: canvasRef, description: 'A bar chart canvas' },
    });

    expect(fullSnapshot.isError).toBeFalsy();
    const fullText = fullSnapshot.content?.[0]?.text || '';

    // Find any v-ref from the snapshot
    const vRefMatch = fullText.match(/\[ref=(v\d+)\]/);
    expect(vRefMatch).toBeTruthy();

    const vRef = vRefMatch![1];

    // Now take a cropped snapshot using the vision ref
    const croppedSnapshot = await client.callTool({
      name: 'browser_screenshot_snapshot',
      arguments: { ref: vRef, description: 'Cropped region' },
    });

    expect(croppedSnapshot.isError).toBeFalsy();
    const croppedText = croppedSnapshot.content?.[0]?.text || '';

    // Should have new v-refs
    expect(croppedText).toMatch(/\[ref=v\d+\]/);

    // The v-refs from cropped analysis should have absolute coordinates
    // that can be used to click elements on the full page
    const newRefMatch = croppedText.match(/\[ref=(v\d+)\]/);
    if (newRefMatch) {
      const newRef = newRefMatch[1];

      // Get bounds of the new ref
      const boundsResponse = await client.callTool({
        name: 'browser_get_bounds',
        arguments: { ref: newRef },
      });

      // Should not error - the coordinates should be valid absolute page coords
      if (boundsResponse.isError) {
        console.log('Bounds error:', boundsResponse.content?.[0]?.text);
      }
      expect(boundsResponse.isError).toBeFalsy();

      const boundsText = boundsResponse.content?.[0]?.text || '';
      // Should contain position and size info
      expect(boundsText).toContain('Position:');
      expect(boundsText).toContain('Size:');
      expect(boundsText).toContain('Center:');
    }
  });
});
