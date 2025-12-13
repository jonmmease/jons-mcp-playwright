/**
 * Tests for browser_locate_in_screenshot tool
 */

import { test, expect } from './fixtures';

test.describe('browser_locate_in_screenshot', () => {
  test('tool is hidden when vision capability is disabled', async ({ client }) => {
    // Default client has no vision capability
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    expect(toolNames).not.toContain('browser_locate_in_screenshot');
  });

  test('tool is available when vision capability is enabled', async ({ startClient }) => {
    const { client } = await startClient({ args: ['--playwright-caps=vision'] });
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    expect(toolNames).toContain('browser_locate_in_screenshot');
  });

  test('returns error when called without vision capability', async ({ client }) => {
    // Try calling the tool directly without vision capability
    const response = await client.callTool({
      name: 'browser_locate_in_screenshot',
      arguments: {
        screenshotUrl: 'http://localhost:9999/downloads/fake-token/screenshot.png',
        description: 'the submit button',
      },
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toContain('requires vision capability');
    expect(text).toContain('--playwright-caps=vision');
  });

  test('returns error when screenshotUrl is missing', async ({ startClient }) => {
    const { client } = await startClient({ args: ['--playwright-caps=vision'] });

    const response = await client.callTool({
      name: 'browser_locate_in_screenshot',
      arguments: {
        description: 'the submit button',
      },
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toContain('requires screenshotUrl parameter');
  });

  test('returns error when description is missing', async ({ startClient }) => {
    const { client } = await startClient({ args: ['--playwright-caps=vision'] });

    const response = await client.callTool({
      name: 'browser_locate_in_screenshot',
      arguments: {
        screenshotUrl: 'http://localhost:9999/downloads/fake-token/screenshot.png',
      },
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toContain('requires description parameter');
  });

  test('returns error when GEMINI_API_KEY is not set', async ({ startClient }) => {
    // Ensure GEMINI_API_KEY is not set for this test
    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
      env: { GEMINI_API_KEY: '' },
    });

    const response = await client.callTool({
      name: 'browser_locate_in_screenshot',
      arguments: {
        screenshotUrl: 'http://localhost:9999/downloads/fake-token/screenshot.png',
        description: 'the submit button',
      },
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toContain('GEMINI_API_KEY');
    expect(text).toContain('aistudio.google.com');
  });

  test('returns error for invalid screenshot URL format', async ({ startClient, server }) => {
    // Need to navigate first so localhost server is initialized
    server.setRoute('/simple', (req, res) => {
      res.end('<html><body><p>Hello</p></body></html>');
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
      env: { GEMINI_API_KEY: 'test-key' },
    });

    // Navigate to initialize localhost server
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/simple' },
    });

    const response = await client.callTool({
      name: 'browser_locate_in_screenshot',
      arguments: {
        screenshotUrl: 'not-a-valid-url',
        description: 'the submit button',
      },
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toContain('Invalid screenshot URL');
  });

  test('returns error for URL with invalid path format', async ({ startClient, server }) => {
    server.setRoute('/simple', (req, res) => {
      res.end('<html><body><p>Hello</p></body></html>');
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
      name: 'browser_locate_in_screenshot',
      arguments: {
        screenshotUrl: 'http://localhost:9999/invalid-path/screenshot.png',
        description: 'the submit button',
      },
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toContain('Invalid screenshot URL path');
  });

  test('returns error for unknown/expired token', async ({ startClient, server }) => {
    server.setRoute('/simple', (req, res) => {
      res.end('<html><body><p>Hello</p></body></html>');
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
      env: { GEMINI_API_KEY: 'test-key' },
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/simple' },
    });

    // Use a fake token that doesn't exist
    const response = await client.callTool({
      name: 'browser_locate_in_screenshot',
      arguments: {
        screenshotUrl: 'http://localhost:9999/downloads/fake-token-12345/screenshot.png',
        description: 'the submit button',
      },
    });

    expect(response.isError).toBe(true);
    const text = response.content?.[0]?.text || '';
    expect(text).toContain('token');
  });
});

// Integration test - only runs if GEMINI_API_KEY is set
const hasGeminiKey = !!process.env.GEMINI_API_KEY;

test.describe('browser_locate_in_screenshot integration', () => {
  test.skip(!hasGeminiKey, 'Requires GEMINI_API_KEY environment variable');

  test('locates element in screenshot with real Gemini API', async ({ startClient, server }) => {
    server.setRoute('/buttons', (req, res) => {
      res.end(`
        <html>
          <body style="padding: 50px;">
            <button style="background: blue; color: white; padding: 10px 20px; font-size: 18px;">
              Submit
            </button>
            <button style="background: green; color: white; padding: 10px 20px; font-size: 18px; margin-left: 20px;">
              Cancel
            </button>
          </body>
        </html>
      `);
    });

    const { client } = await startClient({
      args: ['--playwright-caps=vision'],
    });

    // Navigate to page
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/buttons' },
    });

    // Take screenshot
    const screenshotResponse = await client.callTool({
      name: 'browser_take_screenshot',
      arguments: {},
    });

    expect(screenshotResponse.isError).toBeFalsy();
    const screenshotText = screenshotResponse.content?.[0]?.text || '';

    // Extract download URL from response
    const urlMatch = screenshotText.match(/Download URL: (http[^\s]+)/);
    expect(urlMatch).toBeTruthy();
    const screenshotUrl = urlMatch![1];

    // Locate the blue Submit button
    const locateResponse = await client.callTool({
      name: 'browser_locate_in_screenshot',
      arguments: {
        screenshotUrl,
        description: 'the blue Submit button',
      },
    });

    // Should successfully locate the element
    const locateText = locateResponse.content?.[0]?.text || '';
    if (locateResponse.isError) {
      console.log('Locate error:', locateText);
    }
    expect(locateResponse.isError).toBeFalsy();
    expect(locateText).toContain('Element located at coordinates');
    expect(locateText).toContain('x=');
    expect(locateText).toContain('y=');
    expect(locateText).toContain('browser_mouse_click_xy');

    // Should include annotated image URL
    expect(locateText).toContain('Annotated image:');
    const annotatedUrlMatch = locateText.match(/Annotated image: (http[^\s]+)/);
    expect(annotatedUrlMatch).toBeTruthy();
    const annotatedImageUrl = annotatedUrlMatch![1];
    expect(annotatedImageUrl).toContain('http://localhost:');
    expect(annotatedImageUrl).toContain('_annotated.png');

    // Verify the annotated image URL is fetchable
    const response = await fetch(annotatedImageUrl);
    expect(response.ok).toBe(true);
    const contentType = response.headers.get('content-type');
    expect(contentType).toContain('image/png');
  });
});
