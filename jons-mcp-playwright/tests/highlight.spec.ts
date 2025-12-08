/**
 * Tests for browser_highlight and browser_clear_highlights tools
 */

import { test, expect } from './fixtures';

test.describe('browser_highlight', () => {
  test('highlights single element with box-shadow', async ({ client, server }) => {
    server.setRoute('/highlight', (req, res) => {
      res.end(`
        <html><body>
          <button id="target">Click me</button>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/highlight' } });

    // Get snapshot to find ref
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/button[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    // Highlight the element
    const response = await client.callTool({
      name: 'browser_highlight',
      arguments: { refs: [ref] },
    });

    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toContain('Highlighted 1/1');

    // Verify the element has highlight class via evaluate
    const evalResponse = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        ref,
        element: 'button',
        function: '(el) => el.classList.contains("__mcp-highlight")',
      },
    });
    expect(evalResponse.content[0].text).toContain('true');
  });

  test('highlights multiple elements', async ({ client, server }) => {
    server.setRoute('/multi', (req, res) => {
      res.end(`
        <html><body>
          <button id="btn1">Button 1</button>
          <button id="btn2">Button 2</button>
          <button id="btn3">Button 3</button>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/multi' } });

    // Get snapshot to find refs
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatches = [...snapshotText.matchAll(/button[^\]]*\[ref=([^\]]+)\]/g)];
    expect(refMatches.length).toBeGreaterThanOrEqual(3);

    const refs = refMatches.slice(0, 3).map(m => m[1]);

    // Highlight all three
    const response = await client.callTool({
      name: 'browser_highlight',
      arguments: { refs },
    });

    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toContain('Highlighted 3/3');
  });

  test('auto-clears highlights after browser_click', async ({ client, server }) => {
    server.setRoute('/autoclick', (req, res) => {
      res.end(`
        <html><body>
          <button id="target">Click me</button>
          <button id="other">Other</button>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/autoclick' } });

    // Get refs
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatches = [...snapshotText.matchAll(/button[^\]]*\[ref=([^\]]+)\]/g)];
    const targetRef = refMatches[0][1];
    const otherRef = refMatches[1][1];

    // Highlight target
    await client.callTool({
      name: 'browser_highlight',
      arguments: { refs: [targetRef] },
    });

    // Verify highlight exists
    const beforeClick = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        ref: targetRef,
        element: 'button',
        function: '(el) => el.classList.contains("__mcp-highlight")',
      },
    });
    expect(beforeClick.content[0].text).toContain('true');

    // Click the other button (should auto-clear highlights)
    await client.callTool({
      name: 'browser_click',
      arguments: { element: 'Other button', ref: otherRef },
    });

    // Verify highlight is cleared
    const afterClick = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        ref: targetRef,
        element: 'button',
        function: '(el) => el.classList.contains("__mcp-highlight")',
      },
    });
    expect(afterClick.content[0].text).toContain('false');
  });

  test('auto-clears highlights after browser_navigate', async ({ client, server }) => {
    server.setRoute('/page1', (req, res) => {
      res.end(`
        <html><body>
          <button id="target">Click me</button>
        </body></html>
      `);
    });
    server.setRoute('/page2', (req, res) => {
      res.end(`<html><body><p>Page 2</p></body></html>`);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/page1' } });

    // Get ref and highlight
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/button[^\]]*\[ref=([^\]]+)\]/);
    const ref = refMatch![1];

    await client.callTool({
      name: 'browser_highlight',
      arguments: { refs: [ref] },
    });

    // Navigate away (should auto-clear highlights)
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: server.PREFIX + '/page2' },
    });

    // Check there are no highlight elements on new page
    const evalResponse = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        function: '() => document.querySelectorAll(".__mcp-highlight").length',
      },
    });
    expect(evalResponse.content[0].text).toContain('0');
  });

  test('browser_clear_highlights removes all highlights', async ({ client, server }) => {
    server.setRoute('/clear', (req, res) => {
      res.end(`
        <html><body>
          <button id="target">Click me</button>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/clear' } });

    // Get ref and highlight
    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/button[^\]]*\[ref=([^\]]+)\]/);
    const ref = refMatch![1];

    await client.callTool({
      name: 'browser_highlight',
      arguments: { refs: [ref] },
    });

    // Manually clear
    const clearResponse = await client.callTool({
      name: 'browser_clear_highlights',
      arguments: {},
    });

    expect(clearResponse.content[0].text).toContain('Cleared all highlights');

    // Verify highlight is gone
    const evalResponse = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        ref,
        element: 'button',
        function: '(el) => el.classList.contains("__mcp-highlight")',
      },
    });
    expect(evalResponse.content[0].text).toContain('false');
  });

  test('supports custom colors', async ({ client, server }) => {
    server.setRoute('/colors', (req, res) => {
      res.end(`
        <html><body>
          <button id="target">Click me</button>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/colors' } });

    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/button[^\]]*\[ref=([^\]]+)\]/);
    const ref = refMatch![1];

    // Highlight with blue color
    const response = await client.callTool({
      name: 'browser_highlight',
      arguments: { refs: [ref], color: 'blue' },
    });

    expect(response.isError).toBeFalsy();

    // Verify the color variable is set
    const evalResponse = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        ref,
        element: 'button',
        function: '(el) => getComputedStyle(el).getPropertyValue("--mcp-highlight-color").trim()',
      },
    });
    expect(evalResponse.content[0].text).toContain('#0066ff');
  });

  test('shows label near highlighted element', async ({ client, server }) => {
    server.setRoute('/label', (req, res) => {
      res.end(`
        <html><body style="padding: 100px;">
          <button id="target" style="padding: 20px;">Click me</button>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/label' } });

    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/button[^\]]*\[ref=([^\]]+)\]/);
    const ref = refMatch![1];

    // Highlight with label
    const response = await client.callTool({
      name: 'browser_highlight',
      arguments: { refs: [ref], label: 'Click this button!' },
    });

    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toContain('with label "Click this button!"');

    // Verify label element exists - check all label-related elements
    const evalResponse = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        function: `() => {
          const labels = document.querySelectorAll('[class*="mcp-highlight-label"]');
          const allDivs = document.querySelectorAll('div');
          return JSON.stringify({
            labelsFound: labels.length,
            totalDivs: allDivs.length,
            labelClasses: Array.from(labels).map(l => l.className),
            labelText: labels.length > 0 ? labels[0].textContent : null
          });
        }`,
      },
    });
    const resultText = evalResponse.content[0].text;
    expect(resultText).toContain('Click this button!');
  });

  test('highlights text input element', async ({ client, server }) => {
    server.setRoute('/input', (req, res) => {
      res.end(`
        <html><body>
          <input type="text" placeholder="Enter your name" id="name-input">
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/input' } });

    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/textbox[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_highlight',
      arguments: { refs: [ref], color: 'blue' },
    });

    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toContain('Highlighted 1/1');

    // Verify highlight applied
    const evalResponse = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        ref,
        element: 'input',
        function: '(el) => el.classList.contains("__mcp-highlight")',
      },
    });
    expect(evalResponse.content[0].text).toContain('true');
  });

  test('highlights paragraph element', async ({ client, server }) => {
    server.setRoute('/paragraph', (req, res) => {
      res.end(`
        <html><body>
          <p id="intro">This is an important paragraph that explains the main concept.</p>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/paragraph' } });

    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/paragraph[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_highlight',
      arguments: { refs: [ref], color: 'green' },
    });

    expect(response.isError).toBeFalsy();

    // Verify highlight applied
    const evalResponse = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        ref,
        element: 'paragraph',
        function: '(el) => el.classList.contains("__mcp-highlight")',
      },
    });
    expect(evalResponse.content[0].text).toContain('true');
  });

  test('highlights link element', async ({ client, server }) => {
    server.setRoute('/link', (req, res) => {
      res.end(`
        <html><body>
          <a href="https://example.com" id="main-link">Click here to learn more</a>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/link' } });

    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    // Link elements may have multiple attributes like [cursor=pointer], so use .* to skip them
    const refMatch = snapshotText.match(/link.*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_highlight',
      arguments: { refs: [ref], color: 'orange' },
    });

    expect(response.isError).toBeFalsy();

    // Verify highlight applied
    const evalResponse = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        ref,
        element: 'link',
        function: '(el) => el.classList.contains("__mcp-highlight")',
      },
    });
    expect(evalResponse.content[0].text).toContain('true');
  });

  test('highlights heading element', async ({ client, server }) => {
    server.setRoute('/heading', (req, res) => {
      res.end(`
        <html><body>
          <h1 id="main-title">Welcome to Our Website</h1>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/heading' } });

    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    // Heading elements have [level=N] attribute, so use .* to skip to [ref=...]
    const refMatch = snapshotText.match(/heading.*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_highlight',
      arguments: { refs: [ref], color: 'purple' },
    });

    expect(response.isError).toBeFalsy();

    // Verify highlight applied
    const evalResponse = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        ref,
        element: 'heading',
        function: '(el) => el.classList.contains("__mcp-highlight")',
      },
    });
    expect(evalResponse.content[0].text).toContain('true');
  });

  test('highlights list item element', async ({ client, server }) => {
    server.setRoute('/list', (req, res) => {
      res.end(`
        <html><body>
          <ul>
            <li id="item1">First important item</li>
            <li id="item2">Second important item</li>
          </ul>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/list' } });

    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/listitem[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_highlight',
      arguments: { refs: [ref] },
    });

    expect(response.isError).toBeFalsy();

    // Verify highlight applied
    const evalResponse = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        ref,
        element: 'listitem',
        function: '(el) => el.classList.contains("__mcp-highlight")',
      },
    });
    expect(evalResponse.content[0].text).toContain('true');
  });

  test('highlights checkbox element', async ({ client, server }) => {
    server.setRoute('/checkbox', (req, res) => {
      res.end(`
        <html><body>
          <label>
            <input type="checkbox" id="agree"> I agree to the terms
          </label>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/checkbox' } });

    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/checkbox[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_highlight',
      arguments: { refs: [ref], color: 'blue' },
    });

    expect(response.isError).toBeFalsy();

    // Verify highlight applied
    const evalResponse = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        ref,
        element: 'checkbox',
        function: '(el) => el.classList.contains("__mcp-highlight")',
      },
    });
    expect(evalResponse.content[0].text).toContain('true');
  });

  test('highlights image element', async ({ client, server }) => {
    server.setRoute('/image', (req, res) => {
      res.end(`
        <html><body>
          <img src="https://via.placeholder.com/150" alt="Sample image" id="sample-img">
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/image' } });

    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;
    const refMatch = snapshotText.match(/img[^\]]*\[ref=([^\]]+)\]/);
    expect(refMatch).toBeTruthy();
    const ref = refMatch![1];

    const response = await client.callTool({
      name: 'browser_highlight',
      arguments: { refs: [ref], color: 'green' },
    });

    expect(response.isError).toBeFalsy();

    // Verify highlight applied
    const evalResponse = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        ref,
        element: 'image',
        function: '(el) => el.classList.contains("__mcp-highlight")',
      },
    });
    expect(evalResponse.content[0].text).toContain('true');
  });

  test('highlights mixed element types simultaneously', async ({ client, server }) => {
    server.setRoute('/mixed', (req, res) => {
      res.end(`
        <html><body>
          <h1 id="title">Form Title</h1>
          <p id="desc">Please fill out this form</p>
          <input type="text" placeholder="Name" id="name">
          <button id="submit">Submit</button>
        </body></html>
      `);
    });

    await client.callTool({ name: 'browser_navigate', arguments: { url: server.PREFIX + '/mixed' } });

    const snapshotResponse = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    const snapshotText = snapshotResponse.content[0].text;

    // Find refs for different element types (use .* to skip multiple attributes)
    const headingMatch = snapshotText.match(/heading.*\[ref=([^\]]+)\]/);
    const paragraphMatch = snapshotText.match(/paragraph.*\[ref=([^\]]+)\]/);
    const textboxMatch = snapshotText.match(/textbox.*\[ref=([^\]]+)\]/);
    const buttonMatch = snapshotText.match(/button.*\[ref=([^\]]+)\]/);

    expect(headingMatch).toBeTruthy();
    expect(paragraphMatch).toBeTruthy();
    expect(textboxMatch).toBeTruthy();
    expect(buttonMatch).toBeTruthy();

    const refs = [headingMatch![1], paragraphMatch![1], textboxMatch![1], buttonMatch![1]];

    const response = await client.callTool({
      name: 'browser_highlight',
      arguments: { refs, color: 'orange' },
    });

    expect(response.isError).toBeFalsy();
    expect(response.content[0].text).toContain('Highlighted 4/4');

    // Verify all elements have highlight class
    const evalResponse = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        function: '() => document.querySelectorAll(".__mcp-highlight").length',
      },
    });
    expect(evalResponse.content[0].text).toContain('4');
  });

  test('requires non-empty refs array', async ({ client }) => {
    const response = await client.callTool({
      name: 'browser_highlight',
      arguments: { refs: [] },
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('non-empty refs array');
  });

  test('tools include highlight tools', async ({ client }) => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t: any) => t.name);

    expect(toolNames).toContain('browser_highlight');
    expect(toolNames).toContain('browser_clear_highlights');
  });
});
