/**
 * Init-page script for Playwright MCP's browser.initPage mechanism.
 * This runs once per page to enable visual feedback overlays.
 */

import overlay from './overlay.js';

// Symbol to prevent double-initialization
const VISUAL_FEEDBACK_INITIALIZED = Symbol.for('jons-mcp-playwright.visual-feedback');

/**
 * @param {{ page: import('playwright').Page }} params
 */
export default async function initPage({ page }) {
  // Check if visual feedback is disabled
  if (process.env.JONS_MCP_SHOW_ACTIONS === 'off') {
    return;
  }

  // Guard against double-initialization
  if (page[VISUAL_FEEDBACK_INITIALIZED]) {
    return;
  }
  page[VISUAL_FEEDBACK_INITIALIZED] = true;

  try {
    // Inject the overlay module into the page
    await page.addInitScript(() => {
      // Inline the overlay code to run in browser context
      // This creates the same functionality as overlay.js but in the page

      // Configurable cursor color (purple by default)
      const CURSOR_COLOR = '#C72BE8';

      const STYLES = `
        /* Overlay container */
        #__mcp-overlay-container {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 999999;
        }

        /* Custom cursor - SVG arrow pointer */
        #__mcp-cursor {
          position: fixed;
          width: 30px;
          height: 30px;
          pointer-events: none;
          z-index: 999999;
          transition: left 0.05s ease-out, top 0.05s ease-out, opacity 0.3s ease-out;
          display: none;
          opacity: 1;
        }

        #__mcp-cursor.fading {
          opacity: 0;
        }

        /* Click ripple animation */
        @keyframes __mcp-ripple {
          0% {
            transform: translate(-50%, -50%) scale(0.5);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(2.5);
            opacity: 0;
          }
        }

        .__mcp-click-ripple {
          position: fixed;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: 3px solid ${CURSOR_COLOR};
          pointer-events: none;
          z-index: 999998;
          animation: __mcp-ripple 0.1s ease-out forwards;
        }

        /* Keystroke HUD */
        #__mcp-keystroke-hud {
          position: fixed;
          bottom: 40px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 8px;
          align-items: center;
          padding: 12px 20px;
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(10px);
          border-radius: 12px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 16px;
          color: white;
          pointer-events: none;
          z-index: 999999;
          opacity: 0;
          transition: opacity 0.3s ease;
          max-width: 80vw;
          overflow: hidden;
        }

        #__mcp-keystroke-hud.visible {
          opacity: 1;
        }

        .__mcp-key {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          background: rgba(255, 255, 255, 0.15);
          border-radius: 6px;
          font-weight: 500;
          white-space: nowrap;
        }

        .__mcp-key-special {
          color: ${CURSOR_COLOR};
        }

        .__mcp-text {
          font-style: italic;
          color: #a8dadc;
          max-width: 400px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .__mcp-text::before {
          content: '"';
          color: #a8dadc;
        }

        .__mcp-text::after {
          content: '"';
          color: #a8dadc;
        }
      `;

      const SPECIAL_KEYS = {
        'Enter': '\u23ce Enter',
        'Backspace': '\u232b Backspace',
        'Tab': '\u21b9 Tab',
        'Escape': '\u238b Esc',
        'ArrowUp': '\u2191',
        'ArrowDown': '\u2193',
        'ArrowLeft': '\u2190',
        'ArrowRight': '\u2192',
        'Space': '\u2423 Space',
        ' ': '\u2423 Space',
        'Delete': '\u2326 Del',
        'Home': '\u2196 Home',
        'End': '\u2198 End',
        'PageUp': '\u21de PgUp',
        'PageDown': '\u21df PgDn',
        'Control': '\u2303 Ctrl',
        'Alt': '\u2325 Alt',
        'Meta': '\u2318 Cmd',
        'Shift': '\u21e7 Shift',
      };

      let overlayContainer = null;
      let cursorElement = null;
      let keystrokeHud = null;
      let hideTimeout = null;
      let cursorFadeTimeout = null;
      let isHidden = false;

      function createOverlay() {
        if (overlayContainer) return;

        // Inject styles
        const styleElement = document.createElement('style');
        styleElement.id = '__mcp-overlay-styles';
        styleElement.textContent = STYLES;
        document.head.appendChild(styleElement);

        // Create container
        overlayContainer = document.createElement('div');
        overlayContainer.id = '__mcp-overlay-container';
        document.body.appendChild(overlayContainer);

        // Create cursor as SVG arrow pointer
        cursorElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        cursorElement.id = '__mcp-cursor';
        cursorElement.setAttribute('width', '30');
        cursorElement.setAttribute('height', '30');
        cursorElement.setAttribute('viewBox', '0 0 24 24');
        cursorElement.innerHTML = `<path fill="${CURSOR_COLOR}" stroke="#000000" stroke-width="1.25" d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.85a.5.5 0 0 0-.85.35Z"></path>`;
        overlayContainer.appendChild(cursorElement);

        // Create keystroke HUD
        keystrokeHud = document.createElement('div');
        keystrokeHud.id = '__mcp-keystroke-hud';
        overlayContainer.appendChild(keystrokeHud);
      }

      function moveCursor(x, y) {
        if (!cursorElement || isHidden) return;

        // Clear any pending fade timeout
        if (cursorFadeTimeout) {
          clearTimeout(cursorFadeTimeout);
          cursorFadeTimeout = null;
        }

        // Show cursor and remove fading class
        cursorElement.classList.remove('fading');
        cursorElement.style.left = `${x}px`;
        cursorElement.style.top = `${y}px`;
        cursorElement.style.display = 'block';

        // Set timeout to fade out after 1 second of inactivity
        cursorFadeTimeout = setTimeout(() => {
          if (cursorElement) {
            cursorElement.classList.add('fading');
          }
        }, 5000);
      }

      function showClick(x, y) {
        if (!overlayContainer || isHidden) return;
        moveCursor(x, y);

        const ripple = document.createElement('div');
        ripple.className = '__mcp-click-ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        overlayContainer.appendChild(ripple);

        setTimeout(() => ripple.remove(), 500);
      }

      function showHud() {
        if (!keystrokeHud) return;
        if (hideTimeout) clearTimeout(hideTimeout);
        keystrokeHud.classList.add('visible');
        hideTimeout = setTimeout(() => {
          keystrokeHud.classList.remove('visible');
        }, 3000);
      }

      function showKey(key) {
        if (!keystrokeHud || isHidden) return;

        const keyElement = document.createElement('span');
        keyElement.className = '__mcp-key';

        const displayKey = SPECIAL_KEYS[key];
        if (displayKey) {
          keyElement.classList.add('__mcp-key-special');
          keyElement.textContent = displayKey;
        } else {
          keyElement.textContent = key;
        }

        keystrokeHud.innerHTML = '';
        keystrokeHud.appendChild(keyElement);
        showHud();
      }

      function showText(text) {
        if (!keystrokeHud || isHidden) return;

        const textElement = document.createElement('span');
        textElement.className = '__mcp-text';
        textElement.textContent = text;

        keystrokeHud.innerHTML = '';
        keystrokeHud.appendChild(textElement);
        showHud();
      }

      function hide() {
        isHidden = true;
        if (overlayContainer) {
          overlayContainer.style.display = 'none';
        }
      }

      function show() {
        isHidden = false;
        if (overlayContainer) {
          overlayContainer.style.display = 'block';
        }
      }

      // Initialize when DOM is ready
      if (document.body) {
        createOverlay();
      } else {
        document.addEventListener('DOMContentLoaded', createOverlay);
      }

      // Expose global API
      window.__mcpVisualFeedback = {
        moveCursor,
        showClick,
        showKey,
        showText,
        hide,
        show,
      };
    });
  } catch (err) {
    // Log but don't crash - visual feedback is a nice-to-have
    console.error('[visual-feedback] Failed to enable overlay:', err.message);
  }
}
