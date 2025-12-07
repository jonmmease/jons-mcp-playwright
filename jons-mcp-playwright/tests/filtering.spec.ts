/**
 * Tests for snapshot filtering functionality
 */

import { test, expect, extractYaml, countYamlElements } from './fixtures';

test.describe('Snapshot Filtering', () => {
  test('applies depth limit to nested structure', async ({ startClient, server }) => {
    // Create a deeply nested page with ARIA landmarks for depth
    server.setRoute('/deep', (req, res) => {
      res.end(`
        <html>
          <body>
            <main>
              <section aria-label="Level 1">
                <article>
                  <section aria-label="Level 2">
                    <nav>
                      <ul>
                        <li><a href="#">Deep Link</a></li>
                      </ul>
                    </nav>
                  </section>
                </article>
              </section>
            </main>
          </body>
        </html>
      `);
    });

    // With maxDepth=2, should truncate after 2 levels
    const { client } = await startClient({ config: { maxDepth: 2 } });
    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/deep' } });
    const response = await client.callTool({ name: 'browser_snapshot', arguments: {} });

    const yaml = extractYaml(response);
    expect(yaml).toBeTruthy();
    // With depth 2, should truncate and show indicator
    expect(yaml).toContain('▶ deeper content');
  });

  test('respects null maxDepth (no limit)', async ({ startClient, server }) => {
    server.setRoute('/unlimited', (req, res) => {
      res.end(`
        <html><body>
          <main>
            <section aria-label="Section">
              <article>
                <button>Deep</button>
              </article>
            </section>
          </main>
        </body></html>
      `);
    });

    const { client } = await startClient({ config: { maxDepth: null } });
    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/unlimited' } });
    const response = await client.callTool({ name: 'browser_snapshot', arguments: {} });

    const yaml = extractYaml(response);
    expect(yaml).toBeTruthy();
    // With no limit, should NOT contain truncation indicator
    expect(yaml).not.toContain('▶ deeper content');
    expect(yaml).toContain('button');
  });

  test('applies list limit', async ({ client, server }) => {
    server.setRoute('/list', (req, res) => {
      const items = Array.from({ length: 20 }, (_, i) => `<li>Item ${i + 1}</li>`).join('');
      res.end(`<html><body><ul>${items}</ul></body></html>`);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/list' } });
    const response = await client.callTool({ name: 'browser_snapshot', arguments: {} });

    const yaml = extractYaml(response);
    expect(yaml).toBeTruthy();
    // Default listLimit=10, should truncate list
    expect(yaml).toContain('▶');
    expect(yaml).toContain('more items');
  });

  test('respects custom listLimit via tool argument', async ({ client, server }) => {
    server.setRoute('/small-list', (req, res) => {
      const items = Array.from({ length: 10 }, (_, i) => `<li>Item ${i + 1}</li>`).join('');
      res.end(`<html><body><ul>${items}</ul></body></html>`);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/small-list' } });
    // Pass listLimit as tool argument - LLM controls this per-call
    const response = await client.callTool({ name: 'browser_snapshot', arguments: { listLimit: 3 } });

    const yaml = extractYaml(response);
    expect(yaml).toBeTruthy();
    // With listLimit=3, should show "7 more items"
    expect(yaml).toContain('▶ 7 more items');
  });

  test('extracts subtree by ref', async ({ client, server }) => {
    server.setRoute('/subtree', (req, res) => {
      res.end(`
        <html><body>
          <header><nav><a href="#">Home</a></nav></header>
          <main>
            <article>
              <h1>Title</h1>
              <p>Paragraph 1</p>
              <p>Paragraph 2</p>
            </article>
          </main>
          <footer><p>Footer</p></footer>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/subtree' } });

    // Get full snapshot first
    const fullResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const fullText = fullResponse.content[0].text;
    expect(fullText).toContain('banner');
    expect(fullText).toContain('contentinfo');

    // Find a ref for the main element
    const refMatch = fullText.match(/main[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    // Extract subtree by ref
    const subtreeResponse = await client.callTool({
      name: 'browser_snapshot',
      arguments: { ref },
    });

    // Should only contain the subtree content
    const subtreeText = subtreeResponse.content[0].text;
    expect(subtreeResponse.isError).toBeFalsy();
    // Subtree should have fewer elements than full page
    expect(subtreeText.length).toBeLessThan(fullText.length);
  });

  test('returns error for invalid ref', async ({ client, server }) => {
    server.setRoute('/simple', (req, res) => {
      res.end('<html><body><p>Hello</p></body></html>');
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/simple' } });
    const response = await client.callTool({
      name: 'browser_snapshot',
      arguments: { ref: 'invalid-ref-that-does-not-exist' },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('not found');
  });
});

test.describe('Snapshot Tool Filtering', () => {
  test('browser_navigate applies default filtering (maxDepth=5, listLimit=10)', async ({ client, server }) => {
    // Create a page with deep nesting and a long list
    server.setRoute('/navigate-filter', (req, res) => {
      const items = Array.from({ length: 15 }, (_, i) => `<li>Item ${i + 1}</li>`).join('');
      res.end(`
        <html><body>
          <main>
            <section aria-label="Level 1">
              <article>
                <section aria-label="Level 2">
                  <div>
                    <section aria-label="Level 3">
                      <nav>
                        <section aria-label="Level 4">
                          <div>
                            <section aria-label="Level 5">
                              <button>Deep Button</button>
                            </section>
                          </div>
                        </section>
                      </nav>
                    </section>
                  </div>
                </section>
              </article>
            </section>
          </main>
          <nav>
            <ul>${items}</ul>
          </nav>
        </body></html>
      `);
    });

    // browser_navigate uses defaults: maxDepth=5, listLimit=10
    const response = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/navigate-filter' },
    });

    const yaml = extractYaml(response);
    expect(yaml).toBeTruthy();
    // With maxDepth=5, should truncate deep content
    expect(yaml).toContain('▶ deeper content');
    // With listLimit=10, should truncate the 15-item list
    expect(yaml).toContain('▶ 5 more items');
  });

  test('browser_navigate respects custom maxDepth parameter', async ({ client, server }) => {
    server.setRoute('/navigate-depth', (req, res) => {
      res.end(`
        <html><body>
          <main>
            <section aria-label="Level 1">
              <article>
                <section aria-label="Level 2">
                  <button>Deep Button</button>
                </section>
              </article>
            </section>
          </main>
        </body></html>
      `);
    });

    // With maxDepth=10, should not truncate
    const response = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/navigate-depth', maxDepth: 10 },
    });

    const yaml = extractYaml(response);
    expect(yaml).toBeTruthy();
    expect(yaml).not.toContain('▶ deeper content');
    expect(yaml).toContain('button');
  });

  test('browser_navigate respects custom listLimit parameter', async ({ client, server }) => {
    server.setRoute('/navigate-list', (req, res) => {
      const items = Array.from({ length: 10 }, (_, i) => `<li>Item ${i + 1}</li>`).join('');
      res.end(`<html><body><ul>${items}</ul></body></html>`);
    });

    // With listLimit=8, should show "2 more items"
    const response = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/navigate-list', listLimit: 8 },
    });

    const yaml = extractYaml(response);
    expect(yaml).toBeTruthy();
    expect(yaml).toContain('▶ 2 more items');
  });

  test('browser_click accepts filtering parameters', async ({ client, server }) => {
    server.setRoute('/click-filter', (req, res) => {
      res.end(`
        <html><body>
          <button id="test-btn">Click Me</button>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/click-filter' } });

    // Get snapshot to find the button ref
    const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshot.content[0].text;
    const refMatch = snapshotText.match(/button "Click Me"[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    // Click the button with custom filtering params - verify they are accepted
    const response = await client.callTool({
      name: 'browser_click',
      arguments: { element: 'Click Me button', ref, maxDepth: 10, listLimit: 20 },
    });

    // browser_click returns incremental snapshot focused on clicked element
    // Verify the response is successful and contains button reference
    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toContain('button');
  });

  test('browser_snapshot and browser_navigate use same defaults (maxDepth=5, listLimit=10)', async ({ client, server }) => {
    server.setRoute('/snapshot-defaults', (req, res) => {
      const items = Array.from({ length: 15 }, (_, i) => `<li>Item ${i + 1}</li>`).join('');
      res.end(`<html><body><ul>${items}</ul></body></html>`);
    });

    // browser_navigate uses defaults: maxDepth=5, listLimit=10
    const navigateResponse = await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/snapshot-defaults' } });
    const navigateYaml = extractYaml(navigateResponse);
    expect(navigateYaml).toBeTruthy();
    // With listLimit=10, should show "5 more items" (15 - 10 = 5)
    expect(navigateYaml).toContain('▶ 5 more items');

    // browser_snapshot uses same defaults: maxDepth=5, listLimit=10
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotYaml = extractYaml(snapshotResponse);
    expect(snapshotYaml).toBeTruthy();
    expect(snapshotYaml).toContain('▶ 5 more items');
  });

  test('truncation guidance appears in filtered responses', async ({ client, server }) => {
    server.setRoute('/guidance', (req, res) => {
      res.end(`
        <html><body>
          <main>
            <section aria-label="Level 1">
              <article>
                <section aria-label="Level 2">
                  <div>
                    <section aria-label="Level 3">
                      <nav>
                        <section aria-label="Level 4">
                          <div>
                            <section aria-label="Level 5">
                              <button>Deep Button</button>
                            </section>
                          </div>
                        </section>
                      </nav>
                    </section>
                  </div>
                </section>
              </article>
            </section>
          </main>
        </body></html>
      `);
    });

    const response = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/guidance' },
    });

    const text = response.content[0].text;
    // Should include guidance about using browser_snapshot with ref
    expect(text).toContain('browser_snapshot');
    expect(text).toContain('ref');
  });
});
