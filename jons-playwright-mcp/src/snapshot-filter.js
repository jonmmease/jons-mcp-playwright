/**
 * Snapshot filtering for accessibility trees
 *
 * Parses Playwright's YAML accessibility snapshots and applies filtering:
 * - Remove noise roles (generic, paragraph, presentation, etc.)
 * - Limit tree depth (maxDepth)
 * - Limit list items (listLimit)
 * - Support subtree extraction via ref
 */

/**
 * Extract YAML content from code blocks if present
 * @param {string} text - Raw text that may contain ```yaml code blocks
 * @returns {string} - Extracted YAML content
 */
export function extractYamlContent(text) {
  // Check if text is wrapped in ```yaml code blocks
  const yamlBlockMatch = text.match(/```yaml\s*\n([\s\S]*?)\n?```/);
  if (yamlBlockMatch) {
    return yamlBlockMatch[1].trimEnd();
  }
  return text;
}

/**
 * Parse a single YAML line into its components
 * @param {string} line - Single line from YAML snapshot
 * @returns {Object|null} - Parsed line components or null if invalid
 */
export function parseLine(line) {
  if (!line) return null;

  // Calculate indent level (number of leading spaces)
  const indentMatch = line.match(/^( *)/);
  const indent = indentMatch ? indentMatch[1].length : 0;

  // Remove leading spaces and dash
  const trimmed = line.trim();
  if (!trimmed.startsWith('-')) return null;

  const content = trimmed.substring(1).trim();

  // Parse role (first word before space, quote, or bracket)
  // Also handle property lines like "/url: https://..."
  const roleMatch = content.match(/^(\/[a-z]+|[a-z]+)/);
  if (!roleMatch) return null;
  const role = roleMatch[1];

  let remaining = content.substring(role.length).trim();

  // Parse name (quoted string)
  let name = null;
  const nameMatch = remaining.match(/^"([^"]*)"/);
  if (nameMatch) {
    name = nameMatch[1];
    remaining = remaining.substring(nameMatch[0].length).trim();
  }

  // Parse all brackets - flags and ref
  const flags = [];
  let ref = null;
  let bracketMatch;
  while ((bracketMatch = remaining.match(/^\[([^\]]+)\]/))) {
    const content = bracketMatch[1];
    if (content.startsWith('ref=')) {
      ref = content.substring(4); // Extract ref value
    } else {
      flags.push(content);
    }
    remaining = remaining.substring(bracketMatch[0].length).trim();
  }

  // Everything after flags/ref is text content (for lines like "- generic: Hello!")
  let text = null;
  if (remaining.startsWith(':')) {
    text = remaining.substring(1).trim();
  }

  return {
    indent,
    role,
    name,
    flags,
    ref,
    text
  };
}

/**
 * Parse full YAML snapshot into tree structure
 * @param {string} yaml - YAML accessibility snapshot
 * @returns {Object|Array} - Parsed tree structure
 */
export function parseSnapshot(yaml) {
  const cleanYaml = extractYamlContent(yaml);
  const lines = cleanYaml.split('\n');

  const root = {
    role: 'root',
    name: null,
    ref: null,
    flags: [],
    children: []
  };

  const stack = [{ node: root, indent: -2 }];

  for (const line of lines) {
    if (!line.trim()) continue;

    const parsed = parseLine(line);
    if (!parsed) continue;

    const node = {
      role: parsed.role,
      name: parsed.name,
      ref: parsed.ref,
      flags: parsed.flags,
      text: parsed.text,
      children: []
    };

    // Find parent based on indent
    while (stack.length > 0 && stack[stack.length - 1].indent >= parsed.indent) {
      stack.pop();
    }

    // Add to parent's children
    const parent = stack[stack.length - 1].node;
    parent.children.push(node);

    // Add to stack for potential children
    stack.push({ node, indent: parsed.indent });
  }

  return root;
}

/**
 * Serialize tree structure back to YAML string
 * @param {Object|Array} tree - Parsed tree structure
 * @param {Object} options - Serialization options
 * @param {number} options.depth - Current depth (for indentation)
 * @returns {string} - YAML string
 */
export function serializeSnapshot(tree, options = {}) {
  const depth = options.depth || 0;
  const lines = [];

  // Skip the artificial root node
  const nodes = tree.role === 'root' ? tree.children : [tree];

  for (const node of nodes) {
    if (!node) continue;

    const indent = '  '.repeat(depth);
    let line = `${indent}- ${node.role}`;

    // Add name if present
    if (node.name) {
      line += ` "${node.name}"`;
    }

    // Add flags if present
    for (const flag of node.flags || []) {
      line += ` [${flag}]`;
    }

    // Add ref if present
    if (node.ref) {
      line += ` [ref=${node.ref}]`;
    }

    // Add text content if present
    if (node.text) {
      line += `: ${node.text}`;
    }

    lines.push(line);

    // Recursively serialize children
    if (node.children && node.children.length > 0) {
      const childYaml = serializeSnapshot(
        { role: 'root', children: node.children },
        { depth: depth + 1 }
      );
      lines.push(childYaml);
    }
  }

  return lines.join('\n');
}

// Roles considered "noise" - usually removed unless they have interactive children
const NOISE_ROLES = new Set([
  'generic',
  'paragraph',
  'presentation',
  'none',
  'document',
  'Section', // Sometimes appears as Section
]);

// Roles that are always interactive and should be preserved
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'menu',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'tabpanel',
  'treeitem',
]);

// Roles that represent collapsible containers (for listLimit)
const COLLAPSIBLE_ROLES = new Set([
  'list',
  'listbox',
  'combobox',
  'menu',
  'menubar',
  'tablist',
  'tree',
  'grid',
  'rowgroup',
]);

/**
 * Check if a node has any interactive descendants
 * @param {Object} node - Tree node
 * @returns {boolean}
 */
function hasInteractiveDescendants(node) {
  if (!node.children || node.children.length === 0) {
    return false;
  }
  for (const child of node.children) {
    if (INTERACTIVE_ROLES.has(child.role)) {
      return true;
    }
    if (hasInteractiveDescendants(child)) {
      return true;
    }
  }
  return false;
}

/**
 * Filter noise roles from the tree, preserving structure for interactive elements
 * @param {Object} node - Tree node
 * @returns {Object|null} - Filtered node or null if should be removed
 */
function filterNoiseNode(node) {
  // Always keep root
  if (node.role === 'root') {
    const filteredChildren = [];
    for (const child of node.children || []) {
      const filtered = filterNoiseNode(child);
      if (filtered) {
        filteredChildren.push(filtered);
      }
    }
    return { ...node, children: filteredChildren };
  }

  // Keep non-noise roles
  if (!NOISE_ROLES.has(node.role)) {
    const filteredChildren = [];
    for (const child of node.children || []) {
      const filtered = filterNoiseNode(child);
      if (filtered) {
        filteredChildren.push(filtered);
      }
    }
    return { ...node, children: filteredChildren };
  }

  // For noise roles: preserve if has meaningful name or interactive descendants
  const hasMeaningfulName = node.name && node.name.trim().length > 0;
  const hasInteractive = hasInteractiveDescendants(node);

  if (hasMeaningfulName || hasInteractive) {
    const filteredChildren = [];
    for (const child of node.children || []) {
      const filtered = filterNoiseNode(child);
      if (filtered) {
        filteredChildren.push(filtered);
      }
    }
    return { ...node, children: filteredChildren };
  }

  // For noise without meaning: collapse children up to parent
  // This returns null but the children should be handled by parent
  return null;
}

/**
 * Filter tree by maximum depth
 * @param {Object} node - Tree node
 * @param {number} maxDepth - Maximum depth (null for no limit)
 * @param {number} currentDepth - Current depth
 * @returns {Object} - Filtered node
 */
function filterByDepthNode(node, maxDepth, currentDepth = 0) {
  // No limit
  if (maxDepth === null || maxDepth === undefined) {
    return node;
  }

  // Root doesn't count toward depth
  if (node.role === 'root') {
    return {
      ...node,
      children: (node.children || []).map(child =>
        filterByDepthNode(child, maxDepth, 0)
      ),
    };
  }

  // At max depth, truncate children
  if (currentDepth >= maxDepth) {
    if (node.children && node.children.length > 0) {
      return {
        ...node,
        children: [
          {
            role: 'truncated',
            name: '▶ deeper content',
            ref: null,
            flags: [],
            text: null,
            children: [],
          },
        ],
      };
    }
    return { ...node, children: [] };
  }

  // Recurse into children
  return {
    ...node,
    children: (node.children || []).map(child =>
      filterByDepthNode(child, maxDepth, currentDepth + 1)
    ),
  };
}

/**
 * Filter tree by list item limit
 * @param {Object} node - Tree node
 * @param {number} listLimit - Maximum items per list (null for no limit)
 * @returns {Object} - Filtered node
 */
function filterByListLimitNode(node, listLimit) {
  // No limit
  if (listLimit === null || listLimit === undefined) {
    return node;
  }

  // Check if this node is a collapsible container
  if (COLLAPSIBLE_ROLES.has(node.role) && node.children && node.children.length > listLimit) {
    const truncatedCount = node.children.length - listLimit;
    const keptChildren = node.children.slice(0, listLimit).map(child =>
      filterByListLimitNode(child, listLimit)
    );
    keptChildren.push({
      role: 'truncated',
      name: `▶ ${truncatedCount} more items`,
      ref: null,
      flags: [],
      text: null,
      children: [],
    });
    return { ...node, children: keptChildren };
  }

  // Recurse into children
  return {
    ...node,
    children: (node.children || []).map(child =>
      filterByListLimitNode(child, listLimit)
    ),
  };
}

/**
 * Find a node by ref in the tree
 * @param {Object} node - Tree node to search
 * @param {string} ref - Ref to find
 * @returns {Object|null} - Found node or null
 */
function findNodeByRef(node, ref) {
  if (node.ref === ref) {
    return node;
  }
  for (const child of node.children || []) {
    const found = findNodeByRef(child, ref);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Filter a snapshot applying all filters
 * @param {string} yaml - YAML accessibility snapshot
 * @param {Object} options - Filter options
 * @param {number|null} options.maxDepth - Maximum tree depth (null for no limit)
 * @param {number|null} options.listLimit - Maximum items per list (null for no limit)
 * @param {boolean} options.removeNoise - Whether to remove noise roles (default: true)
 * @returns {string} - Filtered YAML string
 */
export function filterSnapshot(yaml, options = {}) {
  const { maxDepth = 5, listLimit = 10, removeNoise = true } = options;

  try {
    // Parse the YAML
    let tree = parseSnapshot(yaml);

    // Apply filters in order
    if (removeNoise) {
      tree = filterNoiseNode(tree);
    }

    tree = filterByDepthNode(tree, maxDepth);
    tree = filterByListLimitNode(tree, listLimit);

    // Serialize back
    return serializeSnapshot(tree);
  } catch (error) {
    // Fail open - return original YAML if filtering fails
    console.error('Snapshot filtering failed, returning original:', error);
    return yaml;
  }
}

/**
 * Extract a subtree by ref
 * @param {string} yaml - YAML accessibility snapshot
 * @param {string} ref - Ref of the element to use as root
 * @returns {string|null} - Subtree YAML or null if not found
 */
export function extractSubtree(yaml, ref) {
  try {
    const tree = parseSnapshot(yaml);
    const subtree = findNodeByRef(tree, ref);

    if (!subtree) {
      return null;
    }

    // Create a new root with the subtree as the only child
    const newRoot = {
      role: 'root',
      name: null,
      ref: null,
      flags: [],
      children: [subtree],
    };

    return serializeSnapshot(newRoot);
  } catch (error) {
    console.error('Subtree extraction failed:', error);
    return null;
  }
}

/**
 * Calculate token estimate for a string
 * Rough estimate: 1 token ≈ 4 characters
 * @param {string} text - Text to estimate
 * @returns {number} - Estimated token count
 */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Count elements in a tree
 * @param {Object} node - Tree node
 * @returns {number} - Element count
 */
export function countElements(node) {
  let count = node.role !== 'root' ? 1 : 0;
  for (const child of node.children || []) {
    count += countElements(child);
  }
  return count;
}
