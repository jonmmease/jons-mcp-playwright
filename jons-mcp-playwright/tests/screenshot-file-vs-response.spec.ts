import { test, expect } from './fixtures';
import { PNG } from 'pngjs';

test('screenshot URL is fetchable and returns correctly scaled image', async ({ client, server }) => {
  server.setRoute('/test', (req, res) => {
    res.end('<html><body style="margin:0;background:blue;">URL Download Test</body></html>');
  });

  await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/test' } });

  // Get viewport dimensions
  const evalResult = await client.callTool({
    name: 'browser_evaluate',
    arguments: { function: '() => JSON.stringify({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })' }
  });

  const text = evalResult.content[0].text;
  const jsonMatch = text.match(/"(\{.*?\})"/);
  const viewport = jsonMatch ? JSON.parse(jsonMatch[1].replace(/\\"/g, '"')) : { w: 0, h: 0, dpr: 1 };

  // Take screenshot
  const ssResult = await client.callTool({ name: 'browser_take_screenshot', arguments: {} });

  // Should NOT have image content (we return URL instead)
  const imgContent = ssResult.content.find((c: any) => c.type === 'image');
  expect(imgContent).toBeUndefined();

  // Get text content with URL
  const textContent = ssResult.content.find((c: any) => c.type === 'text');
  expect(textContent).toBeDefined();

  // Extract download URL
  const urlMatch = textContent.text.match(/Download URL: (http:\/\/[^\s]+)/);
  expect(urlMatch).toBeTruthy();
  const downloadUrl = urlMatch![1];

  console.log('Viewport:', viewport.w, 'x', viewport.h, 'dpr:', viewport.dpr);
  console.log('Download URL:', downloadUrl);

  // Fetch and verify downloaded image
  const response = await fetch(downloadUrl);
  expect(response.ok).toBe(true);
  expect(response.headers.get('content-type')).toBe('image/png');

  const arrayBuffer = await response.arrayBuffer();
  const downloadBuf = Buffer.from(arrayBuffer);
  const downloadPng = PNG.sync.read(downloadBuf);
  console.log('Downloaded dimensions:', downloadPng.width, 'x', downloadPng.height);

  // Downloaded image should be CSS pixel dimensions (1x scale)
  expect(downloadPng.width).toBe(viewport.w);
  expect(downloadPng.height).toBe(viewport.h);
});
