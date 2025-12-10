/**
 * Screenshot crosshairs module
 *
 * Generates JavaScript code to draw coordinate reference overlays at a specified position:
 * - Purple cursor arrow (matches existing visual feedback cursor)
 * - Horizontal line (full viewport width) through cursor
 * - Vertical line (full viewport height) through cursor
 * - +45 and -45 degree diagonal lines through cursor
 * - Concentric circles with distinct colors for easy distance identification
 */

// Cursor and line color (matches existing visual feedback cursor)
const CURSOR_COLOR = '#C72BE8';

// Circle colors - distinct nameable colors for each radius
// These map to common color names that LLMs can easily identify
const CIRCLE_CONFIG = [
  { radius: 10, color: '#FF0000', name: 'Red' },
  { radius: 20, color: '#FF8000', name: 'Orange' },
  { radius: 50, color: '#FFFF00', name: 'Yellow' },
  { radius: 100, color: '#00FF00', name: 'Green' },
  { radius: 200, color: '#0000FF', name: 'Blue' },
  { radius: 500, color: '#8000FF', name: 'Purple' },
];

/**
 * Generate the JavaScript code to inject into the page for drawing crosshairs
 * @param {number} x - X coordinate for crosshairs center (CSS pixels from left)
 * @param {number} y - Y coordinate for crosshairs center (CSS pixels from top)
 * @returns {string} JavaScript code to execute in browser context
 */
export function generateCrosshairsScript(x, y) {
  const circleConfigJson = JSON.stringify(CIRCLE_CONFIG);

  return `(() => {
    const CURSOR_COLOR = '${CURSOR_COLOR}';
    const x = ${x};
    const y = ${y};
    const circleConfig = ${circleConfigJson};

    // Create SVG overlay for all crosshairs elements
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = '__mcp-screenshot-crosshairs';
    svg.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:999999;overflow:visible;';

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    svg.setAttribute('viewBox', '0 0 ' + vw + ' ' + vh);

    // Helper to create SVG line
    function line(x1, y1, x2, y2, opacity = 0.7) {
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', x1);
      l.setAttribute('y1', y1);
      l.setAttribute('x2', x2);
      l.setAttribute('y2', y2);
      l.setAttribute('stroke', CURSOR_COLOR);
      l.setAttribute('stroke-width', '1');
      l.setAttribute('opacity', opacity);
      return l;
    }

    // Helper to create SVG circle with specific color
    function circle(cx, cy, r, color) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', cx);
      c.setAttribute('cy', cy);
      c.setAttribute('r', r);
      c.setAttribute('fill', 'none');
      c.setAttribute('stroke', color);
      c.setAttribute('stroke-width', '2');
      return c;
    }

    // Horizontal line (full viewport width)
    svg.appendChild(line(0, y, vw, y));

    // Vertical line (full viewport height)
    svg.appendChild(line(x, 0, x, vh));

    // Diagonal lines (+45 and -45 degrees)
    // Extend well beyond viewport to ensure full coverage
    const diag = Math.max(vw, vh) * 2;

    // +45 degree: goes from bottom-left to top-right through cursor
    svg.appendChild(line(x - diag, y + diag, x + diag, y - diag, 0.4));

    // -45 degree: goes from top-left to bottom-right through cursor
    svg.appendChild(line(x - diag, y - diag, x + diag, y + diag, 0.4));

    // Concentric circles with distinct colors
    for (const cfg of circleConfig) {
      svg.appendChild(circle(x, y, cfg.radius, cfg.color));
    }

    // Cursor arrow (same SVG path as visual feedback overlay)
    const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    cursor.setAttribute('transform', 'translate(' + x + ',' + y + ')');
    cursor.innerHTML = '<path fill="' + CURSOR_COLOR + '" stroke="#000000" stroke-width="1.25" d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.85a.5.5 0 0 0-.85.35Z" transform="translate(-5.5,-3.21)"></path>';
    svg.appendChild(cursor);

    document.body.appendChild(svg);
  })()`;
}

/**
 * Generate script to remove crosshairs overlay from the page
 * @returns {string} JavaScript code to execute in browser context
 */
export function generateRemoveCrosshairsScript() {
  return `(() => {
    const el = document.getElementById('__mcp-screenshot-crosshairs');
    if (el) el.remove();
  })()`;
}

/**
 * Generate the coordinate explanation text to append to screenshot response
 * @param {number} x - X coordinate used
 * @param {number} y - Y coordinate used
 * @returns {string} Explanation text with distance circle color table
 */
export function generateCoordinateExplanation(x, y) {
  const colorTable = CIRCLE_CONFIG.map(c => `| ${c.name.padEnd(6)} | ${String(c.radius).padStart(3)}px |`).join('\n');

  return `

**Coordinate Reference:**
- Crosshairs drawn at (${x}, ${y})
- Origin (0,0) is top-left corner of viewport
- X increases rightward, Y increases downward
- Coordinates are CSS pixels (viewport-relative, not page-relative)

**Distance Circles (find the nearest colored circle to estimate distance):**
| Color  | Radius |
|--------|--------|
${colorTable}

To adjust position: add/subtract from x (horizontal) or y (vertical)`;
}
