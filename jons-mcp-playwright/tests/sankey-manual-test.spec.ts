/**
 * Manual test to see what browser_screenshot_snapshot detects in a sankey diagram
 */

import { test, expect } from './fixtures';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('analyze sankey diagram', async ({ startClient }) => {
  const { client } = await startClient({
    args: ['--playwright-caps=vision'],
  });

  // Navigate to local HTML file
  const htmlPath = path.join(__dirname, 'fixtures', 'sankey-test.html');
  await client.callTool({
    name: 'browser_navigate',
    arguments: { url: `file://${htmlPath}` },
  });

  // Run screenshot snapshot
  const response = await client.callTool({
    name: 'browser_screenshot_snapshot',
    arguments: { description: 'A sankey diagram showing flow between categories' },
  });

  expect(response.isError).toBeFalsy();
  const text = response.content?.[0]?.text || '';

  // Should detect the main image
  expect(text).toContain('img');
  expect(text).toContain('[ref=v1]');

  // Should detect key expense labels
  expect(text).toContain('Housing');
  expect(text).toContain('Savings');
  expect(text).toContain('Lifestyle');
  expect(text).toContain('Food');

  // Should detect income labels
  expect(text).toContain('Gross Income');
  expect(text).toContain('Net Income');
  expect(text).toContain('Taxes');
});
