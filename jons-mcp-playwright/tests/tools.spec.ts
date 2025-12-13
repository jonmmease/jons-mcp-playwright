/**
 * Tests for new tool implementations
 */

import { test, expect } from './fixtures';

test.describe('browser_get_text', () => {
  test('extracts text from element', async ({ client, server }) => {
    server.setRoute('/text', (req, res) => {
      res.end(`
        <html><body>
          <article id="content">
            <h1>Article Title</h1>
            <p>This is the first paragraph with some text content.</p>
            <p>This is the second paragraph with more text.</p>
          </article>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/text' } });

    // Get snapshot to find ref
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/article[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_get_text',
      arguments: { ref },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    expect(text).toContain('Article Title');
    expect(text).toContain('first paragraph');
    expect(text).toContain('word');
    expect(text).toContain('char');
  });

  test('extracts value from input field', async ({ client, server }) => {
    server.setRoute('/input', (req, res) => {
      res.end(`
        <html><body>
          <input type="text" value="Hello World" id="myinput">
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/input' } });

    // Get snapshot to find ref
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/textbox[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_get_text',
      arguments: { ref },
    });

    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toContain('Hello World');
  });

  test('requires ref parameter', async ({ client, server }) => {
    server.setRoute('/simple', (req, res) => {
      res.end('<html><body><p>Hello</p></body></html>');
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/simple' } });
    const response = await client.callTool({
      name: 'browser_get_text',
      arguments: {},
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('requires a ref');
  });
});

test.describe('browser_get_table', () => {
  test('extracts table as markdown', async ({ client, server }) => {
    server.setRoute('/table', (req, res) => {
      res.end(`
        <html><body>
          <table>
            <thead>
              <tr><th>Name</th><th>Age</th><th>City</th></tr>
            </thead>
            <tbody>
              <tr><td>Alice</td><td>30</td><td>New York</td></tr>
              <tr><td>Bob</td><td>25</td><td>Los Angeles</td></tr>
            </tbody>
          </table>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/table' } });

    // Get snapshot to find ref
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/table[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_get_table',
      arguments: { ref },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    // Should contain markdown table format
    expect(text).toContain('| Name | Age | City |');
    expect(text).toContain('| --- | --- | --- |');
    expect(text).toContain('| Alice | 30 | New York |');
    expect(text).toContain('| Bob | 25 | Los Angeles |');
  });

  test('returns error for non-table element', async ({ client, server }) => {
    server.setRoute('/not-table', (req, res) => {
      res.end('<html><body><button>Not a table</button></body></html>');
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/not-table' } });

    // Get snapshot to find ref for the button
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/button[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_get_table',
      arguments: { ref },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('not a <table>');
  });
});

test.describe('browser_get_bounds', () => {
  test('returns element bounds', async ({ client, server }) => {
    server.setRoute('/bounds', (req, res) => {
      res.end(`
        <html><body>
          <div style="position: absolute; left: 100px; top: 50px; width: 200px; height: 100px;">
            <button id="target">Click Me</button>
          </div>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/bounds' } });

    // Get snapshot to find ref
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/button[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_get_bounds',
      arguments: { ref },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    expect(text).toContain('Position:');
    expect(text).toContain('Size:');
    expect(text).toContain('Center:');
  });
});

test.describe('browser_get_image', () => {
  test('extracts image info', async ({ client, server }) => {
    // Serve a minimal 1x1 red PNG image
    const redPixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64'
    );
    server.setRoute('/test-image.png', (req, res) => {
      res.setHeader('Content-Type', 'image/png');
      res.end(redPixelPng);
    });
    server.setRoute('/image', (req, res) => {
      res.end(`
        <html><body>
          <img src="${server.PREFIX}/test-image.png" alt="Example Image" width="200" height="100">
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/image' } });

    // Get snapshot to find ref
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/img[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_get_image',
      arguments: { ref },
    });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    // Should include download URL
    expect(text).toContain('Download URL:');
    expect(text).toContain('http://localhost:');
    // Should include alt text
    expect(text).toContain('Alt text:');
    expect(text).toContain('Example Image');
    // Should include original URL
    expect(text).toContain('Original URL:');
    expect(text).toContain('test-image.png');
  });

  test('returns error for non-image element', async ({ client, server }) => {
    server.setRoute('/not-image', (req, res) => {
      res.end('<html><body><button>Not an image</button></body></html>');
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/not-image' } });

    // Get snapshot to find ref
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/button[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_get_image',
      arguments: { ref },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('not an <img>');
  });
});

test.describe('Developer Tools Filtering', () => {
  test('hides developer tools by default', async ({ client }) => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    // Developer tools should be hidden
    expect(toolNames).not.toContain('browser_install');
    expect(toolNames).not.toContain('browser_start_tracing');
    expect(toolNames).not.toContain('browser_stop_tracing');
    expect(toolNames).not.toContain('browser_connect');
  });

  test('shows developer tools when enabled', async ({ startClient }) => {
    const { client } = await startClient({
      config: { includeDeveloperTools: true },
    });

    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    // Developer tools should be visible
    expect(toolNames).toContain('browser_install');
  });

  test('includes new tools', async ({ client }) => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    // Our new tools should be present
    expect(toolNames).toContain('browser_get_image');
    expect(toolNames).toContain('browser_get_text');
    expect(toolNames).toContain('browser_get_table');
    expect(toolNames).toContain('browser_get_bounds');
  });

  test('hides vision tools by default', async ({ client }) => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    // Vision tools (XY coordinate tools) should NOT be available by default
    expect(toolNames).not.toContain('browser_mouse_click_xy');
    expect(toolNames).not.toContain('browser_mouse_move_xy');
    expect(toolNames).not.toContain('browser_mouse_drag_xy');
  });

  test('includes vision tools when --playwright-caps=vision is passed', async ({ startClient }) => {
    const { client } = await startClient({ args: ['--playwright-caps=vision'] });
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    // Vision tools should be available with --playwright-caps=vision
    expect(toolNames).toContain('browser_mouse_click_xy');
    expect(toolNames).toContain('browser_mouse_move_xy');
    expect(toolNames).toContain('browser_mouse_drag_xy');
  });

  test('coordinate tools include locate_in_screenshot guidance when vision enabled', async ({ startClient }) => {
    const { client } = await startClient({ args: ['--playwright-caps=vision'] });
    const tools = await client.listTools();

    const coordinateTools = ['browser_mouse_click_xy', 'browser_mouse_move_xy', 'browser_mouse_drag_xy'];
    for (const toolName of coordinateTools) {
      const tool = tools.tools.find((t) => t.name === toolName);
      expect(tool).toBeDefined();
      expect(tool?.description).toContain('browser_locate_in_screenshot');
      expect(tool?.description).toContain('browser_take_screenshot');
    }
  });
});

test.describe('saveToFile', () => {
  test('saves snapshot to file and returns localhost URL', async ({ client, server }) => {
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
    expect(text).toContain('Snapshot saved');
    expect(text).toContain('Path:');
    expect(text).toContain('http://localhost:');
    expect(text).toContain('/downloads/');
    expect(text).toContain('Tokens');
    expect(text).toContain('Elements');

    // Extract URL and verify file can be fetched
    const urlMatch = text.match(/http:\/\/localhost:\d+\/downloads\/[a-f0-9-]+\/[^\s]+/);
    expect(urlMatch).toBeTruthy();
    const downloadUrl = urlMatch![0];
    const fetchResponse = await fetch(downloadUrl);
    expect(fetchResponse.status).toBe(200);
  });

  test('saves text to file and returns localhost URL', async ({ client, server }) => {
    server.setRoute('/save-text', (req, res) => {
      res.end('<html><body><button id="content">Some text content to save</button></body></html>');
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/save-text' } });

    // Get ref for the button (has a role that will show up)
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
    expect(text).toContain('saved to:');
    expect(text).toContain('http://localhost:');
    expect(text).toContain('/downloads/');
    expect(text).toContain('Words:');
    expect(text).toContain('Characters:');

    // Extract URL and verify file can be fetched
    const urlMatch = text.match(/http:\/\/localhost:\d+\/downloads\/[a-f0-9-]+\/[^\s]+/);
    expect(urlMatch).toBeTruthy();
    const downloadUrl = urlMatch![0];
    const fetchResponse = await fetch(downloadUrl);
    expect(fetchResponse.status).toBe(200);
  });
});
