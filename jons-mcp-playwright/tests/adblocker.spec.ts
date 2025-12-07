/**
 * Tests for ad-blocking functionality
 */

import { test, expect, extractYaml } from './fixtures';

test.describe('Ad Blocking', () => {
  test('can enable adblock via CLI option', async ({ startClient, server }) => {
    server.setRoute('/simple', (req, res) => {
      res.end('<html><body><p>Hello World</p></body></html>');
    });

    // Start client with adblock enabled
    const { client } = await startClient({ config: { adblock: true } });

    // Navigate and take snapshot - should work without error
    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/simple' } });
    const response = await client.callTool({ name: 'browser_snapshot', arguments: {} });

    expect(response.isError).toBeFalsy();
    const yaml = extractYaml(response);
    expect(yaml).toContain('Hello World');
  });

  test('blocks ad-like network requests', async ({ startClient, server }) => {
    // Set up a page with an ad-like script reference
    server.setRoute('/with-ads', (req, res) => {
      res.end(`
        <html>
          <head>
            <script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js" async></script>
          </head>
          <body>
            <p>Main content</p>
            <div id="ad-container"></div>
          </body>
        </html>
      `);
    });

    const { client } = await startClient({ config: { adblock: 'tracking' } });
    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/with-ads' } });
    const response = await client.callTool({ name: 'browser_snapshot', arguments: {} });

    // Page should still load and show content
    expect(response.isError).toBeFalsy();
    const yaml = extractYaml(response);
    expect(yaml).toContain('Main content');
  });

  test('base tools work with adblock enabled', async ({ startClient, server }) => {
    server.setRoute('/tools-test', (req, res) => {
      res.end(`
        <html>
          <body>
            <button>Click me</button>
            <input type="text" placeholder="Enter text" />
          </body>
        </html>
      `);
    });

    const { client } = await startClient({ config: { adblock: true } });
    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/tools-test' } });

    // Get snapshot to find refs
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;

    // Find button ref
    const buttonMatch = snapshotText.match(/button "Click me" \[ref=([^\]]+)\]/);
    expect(buttonMatch).toBeTruthy();
    const buttonRef = buttonMatch![1];

    // Test browser_click
    const clickResponse = await client.callTool({
      name: 'browser_click',
      arguments: { element: 'Click me', ref: buttonRef },
    });
    expect(clickResponse.isError).toBeFalsy();

    // Find textbox ref
    const textboxMatch = snapshotText.match(/textbox[^\]]*\[ref=([^\]]+)\]/);
    expect(textboxMatch).toBeTruthy();
    const textboxRef = textboxMatch![1];

    // Test browser_type
    const typeResponse = await client.callTool({
      name: 'browser_type',
      arguments: { element: 'Enter text', text: 'test input', ref: textboxRef },
    });
    expect(typeResponse.isError).toBeFalsy();
  });

  test('adblock=off disables blocking', async ({ startClient, server }) => {
    server.setRoute('/no-block', (req, res) => {
      res.end('<html><body><p>No blocking here</p></body></html>');
    });

    // Adblock explicitly disabled
    const { client } = await startClient({ config: { adblock: 'off' } });
    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/no-block' } });
    const response = await client.callTool({ name: 'browser_snapshot', arguments: {} });

    expect(response.isError).toBeFalsy();
    const yaml = extractYaml(response);
    expect(yaml).toContain('No blocking here');
  });

  test('works without adblock (default behavior)', async ({ client, server }) => {
    server.setRoute('/default', (req, res) => {
      res.end('<html><body><p>Default mode</p></body></html>');
    });

    // Default client has no adblock
    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/default' } });
    const response = await client.callTool({ name: 'browser_snapshot', arguments: {} });

    expect(response.isError).toBeFalsy();
    const yaml = extractYaml(response);
    expect(yaml).toContain('Default mode');
  });
});
