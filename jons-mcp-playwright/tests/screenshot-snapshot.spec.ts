/**
 * Tests for browser_screenshot_snapshot functionality
 *
 * Covers:
 * - Schema building and ARIA roles
 * - Vision ref caching and TTL
 * - HiDPI coordinate conversion
 * - YAML output formatting
 */

import { test, expect } from './fixtures';

// Import modules to test directly
import { ARIA_ROLES, buildElementSchema, assignRefs, isValidRole } from '../src/schema/screenshot-snapshot-schema.js';
import { VisionRefCache, isVisionRef } from '../src/vision-ref-cache.js';
import { elementsToYaml, formatMetadata, formatVisionResponse } from '../src/utils/vision-yaml.js';

test.describe('Schema module', () => {
  test('ARIA_ROLES contains expected roles', () => {
    expect(ARIA_ROLES).toContain('button');
    expect(ARIA_ROLES).toContain('link');
    expect(ARIA_ROLES).toContain('checkbox');
    expect(ARIA_ROLES).toContain('img');
    expect(ARIA_ROLES).toContain('heading');
    expect(ARIA_ROLES).toContain('paragraph');
    expect(ARIA_ROLES).toContain('code');
    expect(ARIA_ROLES).toContain('tree');
    expect(ARIA_ROLES).toContain('treeitem');
    expect(ARIA_ROLES).toContain('generic');
    expect(ARIA_ROLES.length).toBe(51);
  });

  test('buildElementSchema creates nested structure', () => {
    const schema = buildElementSchema(2);

    expect(schema.type).toBe('object');
    expect(schema.properties.role.enum).toBe(ARIA_ROLES);
    expect(schema.properties.name.type).toBe('string');
    expect(schema.properties.bounding_box.type).toBe('array');
    expect(schema.properties.children).toBeDefined();
    expect(schema.properties.children.items.properties.children).toBeDefined();
    // Depth 2 means 3 levels total (0, 1, 2), so level 2 should NOT have children
    expect(schema.properties.children.items.properties.children.items.properties.children).toBeUndefined();
  });

  test('buildElementSchema with depth 0 has no children', () => {
    const schema = buildElementSchema(0);

    expect(schema.properties.children).toBeUndefined();
  });

  test('assignRefs assigns v-prefixed refs', () => {
    const elements = [
      { role: 'img', name: 'Chart', bounding_box: [0, 0, 100, 100], children: [
        { role: 'heading', name: 'Title', bounding_box: [0, 0, 50, 50], children: [] },
        { role: 'label', name: 'X Axis', bounding_box: [50, 0, 100, 100], children: [] },
      ]},
    ];

    assignRefs(elements);

    expect(elements[0].ref).toBe('v1');
    expect(elements[0].children[0].ref).toBe('v2');
    expect(elements[0].children[1].ref).toBe('v3');
  });

  test('isValidRole validates against ARIA_ROLES', () => {
    expect(isValidRole('button')).toBe(true);
    expect(isValidRole('checkbox')).toBe(true);
    expect(isValidRole('invalid-role')).toBe(false);
    expect(isValidRole('')).toBe(false);
  });
});

test.describe('VisionRefCache', () => {
  test('stores and retrieves refs', () => {
    const cache = new VisionRefCache(5000);
    const element = {
      bounding_box: [10, 20, 110, 220],
      name: 'Test Element',
      role: 'button',
    };

    cache.set('page1', 'v1', element, 'http://test.com/screenshot.png', 1);

    const entry = cache.get('page1', 'v1');
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe('Test Element');
    expect(entry!.role).toBe('button');
  });

  test('converts pixel to CSS coordinates with deviceScaleFactor', () => {
    const cache = new VisionRefCache(5000);
    const element = {
      bounding_box: [100, 200, 300, 400], // y_min, x_min, y_max, x_max in pixels
      name: 'Test',
      role: 'button',
    };

    // With scale factor 2 (retina)
    cache.set('page1', 'v1', element, 'http://test.com/screenshot.png', 2);

    const entry = cache.get('page1', 'v1');
    expect(entry).not.toBeNull();
    // CSS coords should be pixel coords / 2
    expect(entry!.bounds.x).toBe(100); // x_min / 2 = 200 / 2 = 100
    expect(entry!.bounds.y).toBe(50);  // y_min / 2 = 100 / 2 = 50
    expect(entry!.bounds.width).toBe(100); // (400 - 200) / 2 = 100
    expect(entry!.bounds.height).toBe(100); // (300 - 100) / 2 = 100
    expect(entry!.bounds.centerX).toBe(150); // (200 + 400) / 2 / 2 = 150
    expect(entry!.bounds.centerY).toBe(100); // (100 + 300) / 2 / 2 = 100
  });

  test('getClickCoords returns center coordinates', () => {
    const cache = new VisionRefCache(5000);
    const element = {
      bounding_box: [0, 0, 100, 200],
      name: 'Test',
      role: 'button',
    };

    cache.set('page1', 'v1', element, 'http://test.com/screenshot.png', 1);

    const coords = cache.getClickCoords('page1', 'v1');
    expect(coords).toEqual({ x: 100, y: 50 }); // center of [0,0,100,200]
  });

  test('getBounds returns CSS pixel bounds', () => {
    const cache = new VisionRefCache(5000);
    const element = {
      bounding_box: [10, 20, 110, 220],
      name: 'Test',
      role: 'button',
    };

    cache.set('page1', 'v1', element, 'http://test.com/screenshot.png', 1);

    const bounds = cache.getBounds('page1', 'v1');
    expect(bounds).toEqual({ x: 20, y: 10, width: 200, height: 100 });
  });

  test('getName returns element name', () => {
    const cache = new VisionRefCache(5000);
    const element = {
      bounding_box: [0, 0, 100, 100],
      name: 'Important Button',
      role: 'button',
    };

    cache.set('page1', 'v1', element, 'http://test.com/screenshot.png', 1);

    expect(cache.getName('page1', 'v1')).toBe('Important Button');
  });

  test('returns null for expired refs', async () => {
    const cache = new VisionRefCache(50); // 50ms TTL
    const element = {
      bounding_box: [0, 0, 100, 100],
      name: 'Test',
      role: 'button',
    };

    cache.set('page1', 'v1', element, 'http://test.com/screenshot.png', 1);

    // Wait for TTL to expire
    await new Promise(r => setTimeout(r, 100));

    expect(cache.get('page1', 'v1')).toBeNull();
    expect(cache.isValid('page1', 'v1')).toBe(false);
  });

  test('clearPage removes only that page\'s refs', () => {
    const cache = new VisionRefCache(5000);
    const element = {
      bounding_box: [0, 0, 100, 100],
      name: 'Test',
      role: 'button',
    };

    cache.set('page1', 'v1', element, 'http://test.com/screenshot.png', 1);
    cache.set('page2', 'v1', element, 'http://test.com/screenshot.png', 1);

    cache.clearPage('page1');

    expect(cache.get('page1', 'v1')).toBeNull();
    expect(cache.get('page2', 'v1')).not.toBeNull();
  });

  test('cacheElements caches all nested elements', () => {
    const cache = new VisionRefCache(5000);
    const elements = [
      {
        ref: 'v1',
        role: 'img',
        name: 'Chart',
        bounding_box: [0, 0, 400, 600],
        children: [
          { ref: 'v2', role: 'heading', name: 'Title', bounding_box: [0, 0, 50, 600], children: [] },
          { ref: 'v3', role: 'group', name: 'Plot', bounding_box: [50, 0, 400, 600], children: [
            { ref: 'v4', role: 'generic', name: 'Bar 1', bounding_box: [100, 50, 300, 150], children: [] },
          ]},
        ],
      },
    ];

    cache.cacheElements(elements, 'page1', 'http://test.com/screenshot.png', 1);

    expect(cache.isValid('page1', 'v1')).toBe(true);
    expect(cache.isValid('page1', 'v2')).toBe(true);
    expect(cache.isValid('page1', 'v3')).toBe(true);
    expect(cache.isValid('page1', 'v4')).toBe(true);
    expect(cache.size).toBe(4);
  });
});

test.describe('HiDPI scaling', () => {
  test('deviceScaleFactor=2 (retina) divides coordinates by 2', () => {
    const cache = new VisionRefCache(5000);
    // Element at [100, 200, 300, 400] pixels on a 2x display
    const element = {
      bounding_box: [100, 200, 300, 400],
      name: 'Retina Button',
      role: 'button',
    };

    cache.set('page1', 'v1', element, 'http://test.com/screenshot.png', 2);

    const entry = cache.get('page1', 'v1');
    expect(entry).not.toBeNull();
    // All coordinates divided by 2
    expect(entry!.bounds.x).toBe(100);       // 200 / 2
    expect(entry!.bounds.y).toBe(50);        // 100 / 2
    expect(entry!.bounds.width).toBe(100);   // (400 - 200) / 2
    expect(entry!.bounds.height).toBe(100);  // (300 - 100) / 2

    const coords = cache.getClickCoords('page1', 'v1');
    expect(coords).toEqual({ x: 150, y: 100 }); // center in CSS pixels
  });

  test('deviceScaleFactor=3 (high-DPI) divides coordinates by 3', () => {
    const cache = new VisionRefCache(5000);
    // Element at [90, 150, 270, 450] pixels on a 3x display
    const element = {
      bounding_box: [90, 150, 270, 450],
      name: 'High-DPI Button',
      role: 'button',
    };

    cache.set('page1', 'v1', element, 'http://test.com/screenshot.png', 3);

    const entry = cache.get('page1', 'v1');
    expect(entry).not.toBeNull();
    // All coordinates divided by 3
    expect(entry!.bounds.x).toBe(50);        // 150 / 3
    expect(entry!.bounds.y).toBe(30);        // 90 / 3
    expect(entry!.bounds.width).toBe(100);   // (450 - 150) / 3
    expect(entry!.bounds.height).toBe(60);   // (270 - 90) / 3

    const coords = cache.getClickCoords('page1', 'v1');
    expect(coords).toEqual({ x: 100, y: 60 }); // center in CSS pixels: ((150+450)/2)/3, ((90+270)/2)/3
  });

  test('deviceScaleFactor=1 (standard) preserves pixel coordinates', () => {
    const cache = new VisionRefCache(5000);
    const element = {
      bounding_box: [50, 100, 150, 300],
      name: 'Standard Button',
      role: 'button',
    };

    cache.set('page1', 'v1', element, 'http://test.com/screenshot.png', 1);

    const entry = cache.get('page1', 'v1');
    expect(entry).not.toBeNull();
    // Coordinates unchanged at scale 1
    expect(entry!.bounds.x).toBe(100);
    expect(entry!.bounds.y).toBe(50);
    expect(entry!.bounds.width).toBe(200);  // 300 - 100
    expect(entry!.bounds.height).toBe(100); // 150 - 50

    const coords = cache.getClickCoords('page1', 'v1');
    expect(coords).toEqual({ x: 200, y: 100 }); // center: (100+300)/2, (50+150)/2
  });

  test('getBounds returns scaled CSS coordinates', () => {
    const cache = new VisionRefCache(5000);
    const element = {
      bounding_box: [200, 100, 400, 500],
      name: 'Scaled Element',
      role: 'img',
    };

    cache.set('page1', 'v1', element, 'http://test.com/screenshot.png', 2);

    const bounds = cache.getBounds('page1', 'v1');
    expect(bounds).toEqual({
      x: 50,       // 100 / 2
      y: 100,      // 200 / 2
      width: 200,  // (500 - 100) / 2
      height: 100, // (400 - 200) / 2
    });
  });
});

test.describe('isVisionRef', () => {
  test('identifies vision refs', () => {
    expect(isVisionRef('v1')).toBe(true);
    expect(isVisionRef('v123')).toBe(true);
    expect(isVisionRef('v')).toBe(true);
  });

  test('rejects non-vision refs', () => {
    expect(isVisionRef('e1')).toBe(false);
    expect(isVisionRef('ref1')).toBe(false);
    expect(isVisionRef('')).toBe(false);
    expect(isVisionRef(null as any)).toBe(false);
    expect(isVisionRef(undefined as any)).toBe(false);
    expect(isVisionRef(123 as any)).toBe(false);
  });
});

test.describe('YAML formatting', () => {
  test('elementsToYaml formats simple elements', () => {
    const elements = [
      { ref: 'v1', role: 'button', name: 'Click me', bounding_box: [0, 0, 50, 100] },
      { ref: 'v2', role: 'link', name: 'Learn more', bounding_box: [50, 0, 100, 100] },
    ];

    const yaml = elementsToYaml(elements);

    expect(yaml).toContain('- button "Click me" [ref=v1]');
    expect(yaml).toContain('- link "Learn more" [ref=v2]');
  });

  test('elementsToYaml formats nested elements with indentation', () => {
    const elements = [
      {
        ref: 'v1',
        role: 'img',
        name: 'Chart',
        bounding_box: [0, 0, 400, 600],
        children: [
          { ref: 'v2', role: 'heading', name: 'Title', bounding_box: [0, 0, 50, 600], children: [] },
          { ref: 'v3', role: 'label', name: 'X Axis', bounding_box: [350, 0, 400, 600], children: [] },
        ],
      },
    ];

    const yaml = elementsToYaml(elements);

    expect(yaml).toContain('- img "Chart" [ref=v1]');
    expect(yaml).toContain('  - heading "Title" [ref=v2]');
    expect(yaml).toContain('  - label "X Axis" [ref=v3]');
  });

  test('elementsToYaml escapes quotes in names', () => {
    const elements = [
      { ref: 'v1', role: 'button', name: 'Say "Hello"', bounding_box: [0, 0, 50, 100] },
    ];

    const yaml = elementsToYaml(elements);

    expect(yaml).toContain('- button "Say \\"Hello\\"" [ref=v1]');
  });

  test('formatMetadata includes all fields', () => {
    const metadata = formatMetadata({
      width: 800,
      height: 600,
      deviceScaleFactor: 2,
      ttlMs: 30000,
    });

    expect(metadata).toContain('Image: 800x600px');
    expect(metadata).toContain('Scale: 2x');
    expect(metadata).toContain('Refs valid for: 30s');
  });

  test('formatMetadata includes warnings count', () => {
    const metadata = formatMetadata({
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
      ttlMs: 5000,
      warnings: ['warning1', 'warning2'],
    });

    expect(metadata).toContain('Warnings: 2');
  });

  test('formatVisionResponse combines metadata and YAML', () => {
    const elements = [
      { ref: 'v1', role: 'button', name: 'Test', bounding_box: [0, 0, 50, 100] },
    ];

    const response = formatVisionResponse({
      elements,
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
      ttlMs: 30000,
    });

    expect(response).toContain('Image: 800x600px');
    expect(response).toContain('- button "Test" [ref=v1]');
    expect(response).toContain('\n\n'); // metadata separated from YAML
  });
});
