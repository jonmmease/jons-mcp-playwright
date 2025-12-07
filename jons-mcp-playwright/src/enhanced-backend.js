/**
 * EnhancedBackend - Wrapper around Playwright's BrowserServerBackend
 *
 * This class intercepts MCP tool calls to:
 * - Filter accessibility snapshots (maxDepth, listLimit)
 * - Add new tools (browser_get_image, browser_get_text, etc.)
 * - Handle saveToFile parameter
 * - Filter out developer tools by default
 */

import { schema as getImageSchema } from './tools/get-image.js';
import { schema as getTextSchema } from './tools/get-text.js';
import { schema as getTableSchema } from './tools/get-table.js';
import { schema as fillFormSchema } from './tools/fill-form.js';
import { schema as getBoundsSchema } from './tools/get-bounds.js';
import { filterSnapshot, extractSubtree, estimateTokens, parseSnapshot, countElements } from './snapshot-filter.js';
import { SnapshotCache } from './snapshot-cache.js';
import { saveToFile } from './utils/file-output.js';

// Developer tools hidden by default (see design.md)
const DEVELOPER_TOOLS = [
  'browser_install',
  'browser_generate_locator',
  'browser_start_tracing',
  'browser_stop_tracing',
  'browser_connect',
  // browser_verify_* pattern
];

// Our new tool schemas
const NEW_TOOLS = [
  getImageSchema,
  getTextSchema,
  getTableSchema,
  fillFormSchema,
  getBoundsSchema,
];

/**
 * Check if a tool name is a developer tool
 * @param {string} name - Tool name
 * @returns {boolean}
 */
function isDeveloperTool(name) {
  if (DEVELOPER_TOOLS.includes(name)) return true;
  if (name.startsWith('browser_verify_')) return true;
  return false;
}

export class EnhancedBackend {
  /**
   * @param {import('./index.js').Config} config - Our enhanced config
   * @param {Object} innerBackend - The wrapped BrowserServerBackend instance
   */
  constructor(config, innerBackend) {
    this.config = config;
    this._inner = innerBackend;
    this._snapshotCache = new SnapshotCache(5000); // 5 second TTL
  }

  /**
   * Initialize the backend
   * @param {Object} clientInfo - MCP client info
   */
  async initialize(clientInfo) {
    if (this._inner.initialize) {
      await this._inner.initialize(clientInfo);
    }
  }

  /**
   * List available tools
   * Filters developer tools and adds our new tools
   * @returns {Promise<Array>} Array of MCP tool definitions
   */
  async listTools() {
    // Get base tools from inner backend
    let tools = await this._inner.listTools();

    // Filter out developer tools unless explicitly included
    if (!this.config.includeDeveloperTools) {
      tools = tools.filter(tool => !isDeveloperTool(tool.name));
    }

    // Extend browser_snapshot schema with our additional parameters
    const snapshotTool = tools.find(t => t.name === 'browser_snapshot');
    if (snapshotTool && snapshotTool.inputSchema) {
      snapshotTool.inputSchema = {
        ...snapshotTool.inputSchema,
        properties: {
          ...snapshotTool.inputSchema.properties,
          ref: {
            type: 'string',
            description: 'Element ref to use as the root of the snapshot. If provided, only the subtree under this element is returned, avoiding truncation of deeply nested content.',
          },
          maxDepth: {
            type: 'number',
            description: 'Maximum tree depth to include (default: 5). Set to a higher value to see deeper content, or null for no limit.',
          },
          listLimit: {
            type: 'number',
            description: 'Maximum number of items to include per list (default: 10). Truncated lists show "N more items".',
          },
          saveToFile: {
            type: 'boolean',
            description: 'If true, save snapshot to a temp file and return the path instead of inline content. Useful for large snapshots.',
          },
        },
      };
    }

    // Add our new tools
    for (const schema of NEW_TOOLS) {
      tools.push({
        name: schema.name,
        description: schema.description,
        inputSchema: schema.inputSchema,
        annotations: {
          title: schema.name.replace('browser_', '').replace(/_/g, ' '),
          readOnlyHint: schema.name !== 'browser_fill_form',
          destructiveHint: schema.name === 'browser_fill_form',
          openWorldHint: true,
        },
      });
    }

    return tools;
  }

  /**
   * Call a tool
   * Intercepts browser_snapshot for filtering, handles new tools
   * @param {string} name - Tool name
   * @param {Object} args - Tool arguments
   * @param {Function} progress - Progress callback (optional)
   * @returns {Promise<Object>} Tool result
   */
  async callTool(name, args = {}, progress) {
    // Handle our new tools
    if (name === 'browser_get_image') {
      return this._handleGetImage(args);
    }
    if (name === 'browser_get_text') {
      return this._handleGetText(args);
    }
    if (name === 'browser_get_table') {
      return this._handleGetTable(args);
    }
    if (name === 'browser_fill_form') {
      return this._handleFillForm(args);
    }
    if (name === 'browser_get_bounds') {
      return this._handleGetBounds(args);
    }

    // Intercept browser_snapshot for filtering
    if (name === 'browser_snapshot') {
      return this._handleSnapshot(args, progress);
    }

    // Pass through to inner backend
    return this._inner.callTool(name, args, progress);
  }

  /**
   * Handle browser_snapshot with filtering
   * @param {Object} args - Tool arguments
   * @param {Function} progress - Progress callback
   * @returns {Promise<Object>} Filtered snapshot result
   */
  async _handleSnapshot(args, progress) {
    const { ref, maxDepth, listLimit, saveToFile: shouldSaveToFile } = args;

    // Determine effective filtering options
    const effectiveMaxDepth = maxDepth !== undefined ? maxDepth : this.config.maxDepth;
    const effectiveListLimit = listLimit !== undefined ? listLimit : this.config.listLimit;

    let yamlSnapshot;

    // If ref is provided, try to use cached snapshot
    if (ref) {
      const cached = this._snapshotCache.get();
      if (cached) {
        // Extract subtree from cache
        const subtree = extractSubtree(cached, ref);
        if (subtree) {
          yamlSnapshot = subtree;
        } else {
          return {
            content: [{ type: 'text', text: `Element with ref="${ref}" not found in cached snapshot. The page may have changed. Try calling browser_snapshot() without ref to refresh.` }],
            isError: true,
          };
        }
      } else {
        // Cache expired or empty - fetch fresh snapshot first
        const freshResult = await this._inner.callTool('browser_snapshot', {}, progress);
        const freshYaml = this._extractYamlFromResult(freshResult);
        if (freshYaml) {
          this._snapshotCache.set(freshYaml);
          const subtree = extractSubtree(freshYaml, ref);
          if (subtree) {
            yamlSnapshot = subtree;
          } else {
            return {
              content: [{ type: 'text', text: `Element with ref="${ref}" not found in snapshot.` }],
              isError: true,
            };
          }
        } else {
          // Failed to get snapshot, return original result
          return freshResult;
        }
      }
    } else {
      // No ref - fetch fresh snapshot
      const result = await this._inner.callTool('browser_snapshot', {}, progress);
      const extractedYaml = this._extractYamlFromResult(result);
      if (extractedYaml) {
        yamlSnapshot = extractedYaml;
        // Cache the full snapshot
        this._snapshotCache.set(yamlSnapshot);
      } else {
        // Failed to extract YAML, return original result
        return result;
      }
    }

    // Apply filtering
    const filteredYaml = filterSnapshot(yamlSnapshot, {
      maxDepth: effectiveMaxDepth,
      listLimit: effectiveListLimit,
    });

    // Calculate stats
    const tree = parseSnapshot(filteredYaml);
    const elementCount = countElements(tree);
    const tokenEstimate = estimateTokens(filteredYaml);

    // Handle saveToFile
    if (shouldSaveToFile) {
      try {
        const { path, bytes } = await saveToFile(filteredYaml, {
          type: 'snapshot',
          ref: ref || null,
          extension: 'yaml',
          tempDir: this.config.tempDir,
        });
        return {
          content: [{
            type: 'text',
            text: `Snapshot saved to file.\n\nPath: ${path}\nBytes: ${bytes}\nTokens (est): ${tokenEstimate}\nElements: ${elementCount}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to save snapshot to file: ${error.message}` }],
          isError: true,
        };
      }
    }

    // Return filtered snapshot inline
    return {
      content: [{
        type: 'text',
        text: `\`\`\`yaml\n${filteredYaml}\n\`\`\``,
      }],
    };
  }

  /**
   * Extract YAML content from a tool result
   * @param {Object} result - Tool result from inner backend
   * @returns {string|null} - Extracted YAML or null
   */
  _extractYamlFromResult(result) {
    if (!result || !result.content) {
      return null;
    }

    for (const part of result.content) {
      if (part.type === 'text' && part.text) {
        // Look for YAML in code blocks
        const match = part.text.match(/```yaml\s*\n([\s\S]*?)\n?```/);
        if (match) {
          return match[1].trimEnd();
        }
        // If no code block, treat the whole text as YAML (if it looks like YAML)
        if (part.text.trim().startsWith('-')) {
          return part.text.trim();
        }
      }
    }

    return null;
  }

  /**
   * Handle browser_get_image tool
   * @param {Object} args - { ref, saveToFile? }
   * @returns {Promise<Object>} Image data or file path
   */
  async _handleGetImage(args) {
    const { ref, saveToFile: shouldSaveToFile } = args;

    if (!ref) {
      return {
        content: [{ type: 'text', text: 'browser_get_image requires a ref parameter' }],
        isError: true,
      };
    }

    // Use browser_evaluate to get image info
    const evalResult = await this._inner.callTool('browser_evaluate', {
      ref,
      element: 'image element',
      function: `(element) => {
        if (element.tagName !== 'IMG') {
          return { error: 'Element is not an <img> tag, it is: ' + element.tagName };
        }
        // Get best source URL (prefer srcset if available)
        let url = element.src;
        if (element.srcset) {
          const sources = element.srcset.split(',').map(s => s.trim().split(' '));
          // Find highest resolution
          let bestSource = sources[0];
          for (const source of sources) {
            const w1 = parseInt(bestSource[1] || '0');
            const w2 = parseInt(source[1] || '0');
            if (w2 > w1) bestSource = source;
          }
          if (bestSource[0]) url = bestSource[0];
        }
        return {
          url,
          naturalWidth: element.naturalWidth,
          naturalHeight: element.naturalHeight,
          alt: element.alt || ''
        };
      }`,
    });

    // Parse the result
    const resultText = this._extractTextFromResult(evalResult);
    if (!resultText) {
      return {
        content: [{ type: 'text', text: 'Failed to evaluate image element' }],
        isError: true,
      };
    }

    let imgInfo;
    try {
      imgInfo = JSON.parse(resultText);
    } catch {
      return {
        content: [{ type: 'text', text: `Invalid response from browser: ${resultText}` }],
        isError: true,
      };
    }

    if (imgInfo.error) {
      return {
        content: [{ type: 'text', text: imgInfo.error }],
        isError: true,
      };
    }

    // For now, return image URL and metadata without fetching the actual image data
    // (fetching binary data through MCP is complex and would require additional handling)
    const response = `Image found:
- URL: ${imgInfo.url}
- Dimensions: ${imgInfo.naturalWidth}x${imgInfo.naturalHeight}
- Alt text: ${imgInfo.alt || '(none)'}

To download this image, use browser_navigate to go to the URL or use the URL in your response.`;

    if (shouldSaveToFile) {
      try {
        const { path, bytes } = await saveToFile(response, {
          type: 'image',
          ref,
          extension: 'txt',
          tempDir: this.config.tempDir,
        });
        return {
          content: [{ type: 'text', text: `Image info saved to: ${path} (${bytes} bytes)` }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to save: ${error.message}` }],
          isError: true,
        };
      }
    }

    return {
      content: [{ type: 'text', text: response }],
    };
  }

  /**
   * Handle browser_get_text tool
   * @param {Object} args - { ref, saveToFile? }
   * @returns {Promise<Object>} Text content or file path
   */
  async _handleGetText(args) {
    const { ref, saveToFile: shouldSaveToFile } = args;

    if (!ref) {
      return {
        content: [{ type: 'text', text: 'browser_get_text requires a ref parameter' }],
        isError: true,
      };
    }

    // Use browser_evaluate to get text content
    const evalResult = await this._inner.callTool('browser_evaluate', {
      ref,
      element: 'text element',
      function: `(element) => {
        // For form fields, use value; for others, use innerText
        const tagName = element.tagName.toLowerCase();
        let text;
        if (tagName === 'input' || tagName === 'textarea') {
          text = element.value || '';
        } else {
          text = element.innerText || element.textContent || '';
        }
        return {
          text: text,
          wordCount: text.split(/\\s+/).filter(w => w.length > 0).length,
          charCount: text.length
        };
      }`,
    });

    // Parse the result
    const resultText = this._extractTextFromResult(evalResult);
    if (!resultText) {
      return {
        content: [{ type: 'text', text: 'Failed to evaluate text element' }],
        isError: true,
      };
    }

    let textInfo;
    try {
      textInfo = JSON.parse(resultText);
    } catch {
      return {
        content: [{ type: 'text', text: `Invalid response from browser: ${resultText}` }],
        isError: true,
      };
    }

    if (shouldSaveToFile) {
      try {
        const { path, bytes } = await saveToFile(textInfo.text, {
          type: 'text',
          ref,
          extension: 'txt',
          tempDir: this.config.tempDir,
        });
        return {
          content: [{
            type: 'text',
            text: `Text saved to: ${path}\nBytes: ${bytes}\nWords: ${textInfo.wordCount}\nCharacters: ${textInfo.charCount}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to save: ${error.message}` }],
          isError: true,
        };
      }
    }

    return {
      content: [{
        type: 'text',
        text: `Text content (${textInfo.wordCount} words, ${textInfo.charCount} chars):\n\n${textInfo.text}`,
      }],
    };
  }

  /**
   * Handle browser_get_table tool
   * @param {Object} args - { ref, saveToFile? }
   * @returns {Promise<Object>} Table markdown or file path
   */
  async _handleGetTable(args) {
    const { ref, saveToFile: shouldSaveToFile } = args;

    if (!ref) {
      return {
        content: [{ type: 'text', text: 'browser_get_table requires a ref parameter' }],
        isError: true,
      };
    }

    // Use browser_evaluate to extract table data
    const evalResult = await this._inner.callTool('browser_evaluate', {
      ref,
      element: 'table element',
      function: `(element) => {
        if (element.tagName !== 'TABLE') {
          return { error: 'Element is not a <table>, it is: ' + element.tagName };
        }

        const headers = [];
        const rows = [];

        // Get headers from thead or first row
        const thead = element.querySelector('thead');
        if (thead) {
          const ths = thead.querySelectorAll('th');
          ths.forEach(th => headers.push(th.innerText.trim()));
        }

        // Get rows from tbody
        const tbody = element.querySelector('tbody') || element;
        const trs = tbody.querySelectorAll('tr');
        trs.forEach((tr, i) => {
          // Skip first row if it's in thead
          if (thead && tr.closest('thead')) return;

          // If no headers yet and first row has th cells, use as headers
          if (headers.length === 0 && i === 0) {
            const ths = tr.querySelectorAll('th');
            if (ths.length > 0) {
              ths.forEach(th => headers.push(th.innerText.trim()));
              return;
            }
          }

          const cells = [];
          tr.querySelectorAll('td, th').forEach(cell => {
            cells.push(cell.innerText.trim().replace(/\\n/g, ' '));
          });
          if (cells.length > 0) rows.push(cells);
        });

        return { headers, rows };
      }`,
    });

    // Parse the result
    const resultText = this._extractTextFromResult(evalResult);
    if (!resultText) {
      return {
        content: [{ type: 'text', text: 'Failed to evaluate table element' }],
        isError: true,
      };
    }

    let tableData;
    try {
      tableData = JSON.parse(resultText);
    } catch {
      return {
        content: [{ type: 'text', text: `Invalid response from browser: ${resultText}` }],
        isError: true,
      };
    }

    if (tableData.error) {
      return {
        content: [{ type: 'text', text: tableData.error }],
        isError: true,
      };
    }

    // Convert to markdown
    let markdown = '';
    const { headers, rows } = tableData;

    if (headers.length > 0) {
      markdown += '| ' + headers.join(' | ') + ' |\n';
      markdown += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
    }

    for (const row of rows) {
      markdown += '| ' + row.join(' | ') + ' |\n';
    }

    if (shouldSaveToFile) {
      try {
        const { path, bytes } = await saveToFile(markdown, {
          type: 'table',
          ref,
          extension: 'md',
          tempDir: this.config.tempDir,
        });
        return {
          content: [{
            type: 'text',
            text: `Table saved to: ${path}\nRows: ${rows.length}\nColumns: ${headers.length || (rows[0]?.length || 0)}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to save: ${error.message}` }],
          isError: true,
        };
      }
    }

    return {
      content: [{
        type: 'text',
        text: `Table (${rows.length} rows):\n\n${markdown}`,
      }],
    };
  }

  /**
   * Handle browser_fill_form tool
   * @param {Object} args - { fields: [{ ref, value }] }
   * @returns {Promise<Object>} Fill results
   */
  async _handleFillForm(args) {
    const { fields } = args;

    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      return {
        content: [{ type: 'text', text: 'browser_fill_form requires a non-empty fields array' }],
        isError: true,
      };
    }

    const filled = [];
    const failed = [];

    for (const field of fields) {
      const { ref, value } = field;

      if (!ref) {
        failed.push({ ref: '(missing)', error: 'ref is required' });
        continue;
      }

      try {
        if (typeof value === 'boolean') {
          // For checkboxes: check or uncheck
          await this._inner.callTool('browser_evaluate', {
            ref,
            element: 'checkbox',
            function: `(element, shouldCheck) => {
              if (element.type === 'checkbox' || element.type === 'radio') {
                element.checked = shouldCheck;
                element.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                throw new Error('Element is not a checkbox or radio');
              }
            }`,
          });
          filled.push(ref);
        } else {
          // For text inputs: use browser_type through click + type
          // First clear, then type
          await this._inner.callTool('browser_click', {
            ref,
            element: 'form field',
          });
          await this._inner.callTool('browser_type', {
            text: String(value),
            submit: false,
          });
          filled.push(ref);
        }
      } catch (error) {
        failed.push({ ref, error: error.message || 'Unknown error' });
      }
    }

    let resultText = `Filled ${filled.length}/${fields.length} fields.`;
    if (filled.length > 0) {
      resultText += `\n\nFilled: ${filled.join(', ')}`;
    }
    if (failed.length > 0) {
      resultText += `\n\nFailed:\n${failed.map(f => `- ${f.ref}: ${f.error}`).join('\n')}`;
    }

    return {
      content: [{ type: 'text', text: resultText }],
      isError: failed.length > 0 && filled.length === 0,
    };
  }

  /**
   * Handle browser_get_bounds tool
   * @param {Object} args - { ref }
   * @returns {Promise<Object>} Element bounds
   */
  async _handleGetBounds(args) {
    const { ref } = args;

    if (!ref) {
      return {
        content: [{ type: 'text', text: 'browser_get_bounds requires a ref parameter' }],
        isError: true,
      };
    }

    // Use browser_evaluate to get bounding rect
    const evalResult = await this._inner.callTool('browser_evaluate', {
      ref,
      element: 'target element',
      function: `(element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          centerX: rect.x + rect.width / 2,
          centerY: rect.y + rect.height / 2
        };
      }`,
    });

    // Parse the result
    const resultText = this._extractTextFromResult(evalResult);
    if (!resultText) {
      return {
        content: [{ type: 'text', text: 'Failed to evaluate element bounds' }],
        isError: true,
      };
    }

    let bounds;
    try {
      bounds = JSON.parse(resultText);
    } catch {
      return {
        content: [{ type: 'text', text: `Invalid response from browser: ${resultText}` }],
        isError: true,
      };
    }

    return {
      content: [{
        type: 'text',
        text: `Element bounds (viewport coordinates):
- Position: (${bounds.x}, ${bounds.y})
- Size: ${bounds.width} x ${bounds.height}
- Center: (${bounds.centerX}, ${bounds.centerY})`,
      }],
    };
  }

  /**
   * Extract text content from a tool result
   * @param {Object} result - Tool result
   * @returns {string|null}
   */
  _extractTextFromResult(result) {
    if (!result || !result.content) {
      return null;
    }

    for (const part of result.content) {
      if (part.type === 'text' && part.text) {
        // Look for JSON in the response
        // The result might include other text, so try to find JSON
        const text = part.text.trim();
        // Check if it starts with { or [
        if (text.startsWith('{') || text.startsWith('[')) {
          // Try to extract just the JSON portion by finding balanced braces
          const startChar = text[0];
          const endChar = startChar === '{' ? '}' : ']';
          let depth = 0;
          let inString = false;
          let escape = false;

          for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (escape) {
              escape = false;
              continue;
            }

            if (char === '\\' && inString) {
              escape = true;
              continue;
            }

            if (char === '"' && !escape) {
              inString = !inString;
              continue;
            }

            if (inString) continue;

            if (char === startChar) depth++;
            if (char === endChar) {
              depth--;
              if (depth === 0) {
                return text.slice(0, i + 1);
              }
            }
          }
          // If we couldn't find balanced braces, return as-is
          return text;
        }
        // Look for JSON anywhere in the text
        const jsonMatch = text.match(/(\{[\s\S]*?\}|\[[\s\S]*?\])/);
        if (jsonMatch) {
          return jsonMatch[1];
        }
        return text;
      }
    }

    return null;
  }

  /**
   * Called when the server is closed
   */
  serverClosed() {
    if (this._inner.serverClosed) {
      this._inner.serverClosed();
    }
  }
}
