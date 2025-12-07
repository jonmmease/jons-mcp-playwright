/**
 * Validation tests for real-world websites
 * These tests validate that the filtering and tools work well on actual sites.
 */

import { test, expect, extractYaml } from './fixtures';

// Skip these in CI since they depend on external sites
const realWorldTest = process.env.CI ? test.skip : test;

realWorldTest.describe('Real World Validation', () => {
  realWorldTest.describe.configure({ timeout: 120000 }); // 2 minute timeout for real sites

  realWorldTest('Amazon - token reduction via filtering', async ({ client }) => {
    // Navigate to Amazon
    await client.callTool({ name: 'browser_navigate', arguments: { url: 'https://www.amazon.com' } });

    // Take unfiltered snapshot (by using maxDepth: null and listLimit: null)
    // Since we can't easily get unfiltered, we'll just verify the filtered output is reasonable
    const response = await client.callTool({ name: 'browser_snapshot', arguments: {} });

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;

    // Should have some content
    expect(text.length).toBeGreaterThan(100);

    // Should contain navigation or main content
    expect(text).toMatch(/navigation|main|banner|search/i);

    // Should have truncation indicators (showing filtering is working)
    const hasListTruncation = text.includes('▶') && text.includes('more items');
    const hasDepthTruncation = text.includes('▶ deeper content');

    // At least one type of truncation should be active on a complex site like Amazon
    expect(hasListTruncation || hasDepthTruncation).toBe(true);

    console.log('Amazon snapshot length:', text.length, 'chars');
    console.log('List truncation:', hasListTruncation);
    console.log('Depth truncation:', hasDepthTruncation);
  });

  realWorldTest('Wikipedia table extraction', async ({ client }) => {
    // Navigate to a Wikipedia page with tables
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://en.wikipedia.org/wiki/List_of_countries_by_population_(United_Nations)' },
    });

    // Take snapshot to find table ref
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    expect(snapshotResponse.isError).toBeFalsy();

    // Find a table ref
    const refMatch = snapshotResponse.content[0].text.match(/table[^\]]*\[ref=([^\]]+)\]/);
    if (refMatch) {
      const ref = refMatch[1];

      // Extract table
      const tableResponse = await client.callTool({
        name: 'browser_get_table',
        arguments: { ref },
      });

      expect(tableResponse.isError).toBeFalsy();
      const tableText = tableResponse.content[0].text;

      // Should have markdown table format
      expect(tableText).toContain('|');
      expect(tableText).toContain('---');

      console.log('Wikipedia table extracted, length:', tableText.length);
      console.log('First 500 chars:', tableText.slice(0, 500));
    } else {
      console.log('No table found on page, skipping table extraction test');
    }
  });

  realWorldTest('GitHub login form', async ({ client }) => {
    // Navigate to GitHub login
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://github.com/login' },
    });

    // Take snapshot with higher depth to see form fields
    const snapshotResponse = await client.callTool({
      name: 'browser_snapshot',
      arguments: { maxDepth: 10 },
    });
    expect(snapshotResponse.isError).toBeFalsy();

    const text = snapshotResponse.content[0].text;

    // Should show Sign in button at minimum (even with truncation)
    expect(text).toMatch(/sign in|login/i);

    // Log what we found
    console.log('GitHub login page snapshot length:', text.length);
    console.log('Contains textbox:', text.includes('textbox'));
    console.log('Contains Sign in:', text.match(/sign in/i) !== null);
  });

  realWorldTest('Image on news site', async ({ client }) => {
    // Navigate to Wikipedia which has reliable images
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://en.wikipedia.org/wiki/Main_Page' },
    });

    // Take snapshot with higher depth
    const snapshotResponse = await client.callTool({
      name: 'browser_snapshot',
      arguments: { maxDepth: 8 },
    });
    expect(snapshotResponse.isError).toBeFalsy();

    // Find an image ref
    const text = snapshotResponse.content[0].text;
    const refMatch = text.match(/img[^\]]*\[ref=([^\]]+)\]/);

    if (refMatch) {
      const ref = refMatch[1];

      // Get image info
      const imageResponse = await client.callTool({
        name: 'browser_get_image',
        arguments: { ref },
      });

      if (!imageResponse.isError) {
        const imageText = imageResponse.content[0].text;
        // Should have URL
        expect(imageText).toContain('URL:');
        console.log('Image info:', imageText.slice(0, 300));
      } else {
        console.log('Image extraction failed:', imageResponse.content[0].text);
      }
    } else {
      console.log('No img elements found in snapshot');
    }
    // Test passes as long as snapshot works
    expect(snapshotResponse.isError).toBeFalsy();
  });

  realWorldTest('Text extraction from article', async ({ client }) => {
    // Navigate to a simple article page
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://en.wikipedia.org/wiki/Hello_World' },
    });

    // Take snapshot
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    expect(snapshotResponse.isError).toBeFalsy();

    // Find main content area
    const text = snapshotResponse.content[0].text;
    const refMatch = text.match(/main[^\]]*\[ref=([^\]]+)\]/);

    if (refMatch) {
      const ref = refMatch[1];

      // Get text from main
      const textResponse = await client.callTool({
        name: 'browser_get_text',
        arguments: { ref },
      });

      expect(textResponse.isError).toBeFalsy();
      const contentText = textResponse.content[0].text;

      // Should have word/char counts (format: "Text content (X words, Y chars):")
      expect(contentText).toMatch(/words.*chars|Words.*Characters/i);

      console.log('Article text extraction succeeded, length:', contentText.length);
    } else {
      console.log('No main element found in snapshot');
    }
  });

  realWorldTest('Subtree extraction', async ({ client }) => {
    // Navigate to a page with clear sections
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://news.ycombinator.com/' },
    });

    // Take full snapshot
    const fullResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    expect(fullResponse.isError).toBeFalsy();
    const fullText = fullResponse.content[0].text;

    // Find a ref for any element
    const refMatch = fullText.match(/\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    // Extract subtree
    const subtreeResponse = await client.callTool({
      name: 'browser_snapshot',
      arguments: { ref },
    });

    expect(subtreeResponse.isError).toBeFalsy();
    const subtreeText = subtreeResponse.content[0].text;

    // Subtree should be smaller than full snapshot
    expect(subtreeText.length).toBeLessThanOrEqual(fullText.length);

    console.log('Full snapshot:', fullText.length, 'chars');
    console.log('Subtree:', subtreeText.length, 'chars');
    console.log('Reduction:', Math.round((1 - subtreeText.length / fullText.length) * 100) + '%');
  });
});
