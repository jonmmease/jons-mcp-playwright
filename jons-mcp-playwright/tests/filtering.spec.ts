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

  test('respects custom listLimit', async ({ startClient, server }) => {
    server.setRoute('/small-list', (req, res) => {
      const items = Array.from({ length: 10 }, (_, i) => `<li>Item ${i + 1}</li>`).join('');
      res.end(`<html><body><ul>${items}</ul></body></html>`);
    });

    const { client } = await startClient({ config: { listLimit: 3 } });
    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/small-list' } });
    const response = await client.callTool({ name: 'browser_snapshot', arguments: {} });

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

test.describe('Noise Removal', () => {
  test('preserves interactive elements', async ({ client, server }) => {
    server.setRoute('/interactive', (req, res) => {
      res.end(`
        <html><body>
          <button>Click Me</button>
          <a href="#">Link</a>
          <input type="text" placeholder="Type here">
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/interactive' } });
    const response = await client.callTool({ name: 'browser_snapshot', arguments: {} });

    const text = response.content[0].text;
    expect(text).toContain('button');
    expect(text).toContain('link');
    expect(text).toContain('textbox');
  });

  test('preserves landmarks', async ({ client, server }) => {
    server.setRoute('/landmarks', (req, res) => {
      res.end(`
        <html><body>
          <header><p>Header</p></header>
          <nav><a href="#">Nav</a></nav>
          <main><p>Main content</p></main>
          <footer><p>Footer</p></footer>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/landmarks' } });
    const response = await client.callTool({ name: 'browser_snapshot', arguments: {} });

    const text = response.content[0].text;
    expect(text).toContain('banner');
    expect(text).toContain('navigation');
    expect(text).toContain('main');
    expect(text).toContain('contentinfo');
  });
});
