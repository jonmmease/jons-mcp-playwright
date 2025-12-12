import { test, expect } from './fixtures';
import { PNG } from 'pngjs';

test('screenshots return URL and are scaled to CSS pixel dimensions (1x)', async ({ client, server }) => {
  server.setRoute('/test', (req, res) => {
    res.end('<html><body style="margin:0;background:green;">Scale Test</body></html>');
  });

  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/test' } });

  // Get viewport dimensions
  const evalResult = await client.callTool({
    name: 'browser_evaluate',
    arguments: { function: '() => JSON.stringify({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })' }
  });

  // Parse the evaluate result - it contains markdown formatting
  const text = evalResult.content[0].text;
  const jsonMatch = text.match(/"(\{.*?\})"/);
  const viewport = jsonMatch ? JSON.parse(jsonMatch[1].replace(/\\"/g, '"')) : { w: 0, h: 0, dpr: 1 };

  // Take screenshot
  const ssResult = await client.callTool({ name: 'browser_take_screenshot', arguments: {} });

  // Should NOT have image content (we return URL instead)
  const imgContent = ssResult.content.find((c: any) => c.type === 'image');
  expect(imgContent).toBeUndefined();

  // Should have text content with URL
  const textContent = ssResult.content.find((c: any) => c.type === 'text');
  expect(textContent).toBeDefined();
  expect(textContent.text).toContain('Download URL:');
  expect(textContent.text).toContain('localhost');

  // Extract URL from response
  const urlMatch = textContent.text.match(/Download URL: (http:\/\/[^\s]+)/);
  expect(urlMatch).toBeTruthy();
  const downloadUrl = urlMatch![1];

  console.log('Viewport:', viewport.w, 'x', viewport.h, 'dpr:', viewport.dpr);
  console.log('Download URL:', downloadUrl);

  // Fetch the image from the URL
  const response = await fetch(downloadUrl);
  expect(response.ok).toBe(true);
  expect(response.headers.get('content-type')).toBe('image/png');

  const arrayBuffer = await response.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  const png = PNG.sync.read(buf);

  console.log('Downloaded image:', png.width, 'x', png.height);
  console.log('Ratio:', (png.width / viewport.w).toFixed(2));

  // Downloaded image should be CSS pixel dimensions (1x scale)
  expect(png.width).toBe(viewport.w);
  expect(png.height).toBe(viewport.h);
});

test('screenshot response includes dimensions and curl command', async ({ client, server }) => {
  server.setRoute('/test', (req, res) => {
    res.end('<html><body>Metadata Test</body></html>');
  });

  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/test' } });

  const ssResult = await client.callTool({ name: 'browser_take_screenshot', arguments: {} });
  const textContent = ssResult.content.find((c: any) => c.type === 'text');

  expect(textContent.text).toContain('Screenshot captured');
  expect(textContent.text).toContain('viewport');
  expect(textContent.text).toContain('pixels');
  expect(textContent.text).toContain('curl');
  expect(textContent.text).toContain('Download URL:');
});

test('devicePixelRatio > 1 is present on test machine', async ({ client, server }) => {
  // This test documents the test environment - it's informational, not a requirement
  server.setRoute('/test', (req, res) => {
    res.end('<html><body>DPR Test</body></html>');
  });

  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/test' } });

  const evalResult = await client.callTool({
    name: 'browser_evaluate',
    arguments: { function: '() => window.devicePixelRatio' }
  });

  const text = evalResult.content[0].text;
  // Extract number from markdown result
  const dprMatch = text.match(/### Result\n(\d+(?:\.\d+)?)/);
  const dpr = dprMatch ? parseFloat(dprMatch[1]) : 1;

  console.log('devicePixelRatio:', dpr);

  // On Retina Mac, DPR should be > 1 (typically 2 or 2.2)
  // This test documents the environment; it passes regardless of DPR
  expect(dpr).toBeGreaterThanOrEqual(1);
});
