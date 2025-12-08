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

        /* Custom cursor */
        #__mcp-cursor {
          position: fixed;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: rgba(255, 59, 48, 0.7);
          border: 2px solid rgba(255, 255, 255, 0.9);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          pointer-events: none;
          z-index: 999999;
          transform: translate(-50%, -50%);
          transition: left 0.05s ease-out, top 0.05s ease-out;
          display: none;
        }

        #__mcp-cursor::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 4px;
          height: 4px;
          background: white;
          border-radius: 50%;
          transform: translate(-50%, -50%);
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
          border: 3px solid rgba(255, 59, 48, 0.8);
          pointer-events: none;
          z-index: 999998;
          animation: __mcp-ripple 0.5s ease-out forwards;
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
          color: #ffd60a;
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

        // Create cursor
        cursorElement = document.createElement('div');
        cursorElement.id = '__mcp-cursor';
        overlayContainer.appendChild(cursorElement);

        // Create keystroke HUD
        keystrokeHud = document.createElement('div');
        keystrokeHud.id = '__mcp-keystroke-hud';
        overlayContainer.appendChild(keystrokeHud);
      }

      function moveCursor(x, y) {
        if (!cursorElement || isHidden) return;
        cursorElement.style.left = `${x}px`;
        cursorElement.style.top = `${y}px`;
        cursorElement.style.display = 'block';
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
