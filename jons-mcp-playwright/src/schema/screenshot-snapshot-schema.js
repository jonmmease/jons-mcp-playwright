/**
 * Screenshot Snapshot JSON Schema
 *
 * Single source of truth for the Gemini response schema.
 * Used by both Python (screenshot_snapshot.py) and JavaScript handlers.
 *
 * @module screenshot-snapshot-schema
 */

/**
 * Standard ARIA roles supported for vision-detected elements.
 * 51 roles covering interactive, structure, container, and status categories.
 */
export const ARIA_ROLES = [
  // Interactive/Widget
  'button', 'link', 'checkbox', 'radio', 'switch', 'slider',
  'textbox', 'combobox', 'listbox', 'option', 'menu', 'menuitem',
  'menubar', 'tab', 'tablist', 'tabpanel', 'progressbar', 'scrollbar',
  'spinbutton', 'tree', 'treeitem',
  // Structure
  'img', 'heading', 'label', 'paragraph', 'code', 'list', 'listitem',
  'table', 'row', 'cell', 'columnheader', 'rowheader', 'grid', 'gridcell',
  'separator', 'figure', 'group', 'generic',
  // Containers/Landmarks
  'dialog', 'alertdialog', 'toolbar', 'navigation', 'form', 'region',
  'banner', 'main', 'search',
  // Status
  'alert', 'status', 'tooltip',
];

/**
 * Build a nested element schema with explicit depth levels.
 * Gemini does not support recursive $ref, so we must use fixed-depth nesting.
 *
 * @param {number} depth - Remaining nesting depth (0 = leaf element)
 * @returns {object} JSON Schema for an element at this depth
 */
export function buildElementSchema(depth) {
  const base = {
    type: 'object',
    properties: {
      role: {
        type: 'string',
        enum: ARIA_ROLES,
      },
      name: {
        type: 'string',
      },
      bounding_box: {
        type: 'array',
        items: { type: 'integer' },
        // Format: [y_min, x_min, y_max, x_max] in pixels
      },
    },
    required: ['role', 'name', 'bounding_box'],
  };

  if (depth > 0) {
    base.properties.children = {
      type: 'array',
      items: buildElementSchema(depth - 1),
    };
  }

  return base;
}

/**
 * Complete schema for Gemini's structured output response.
 * Uses 5 levels of nesting (depth 4 = 5 total levels: L0 through L4).
 */
export const SCREENSHOT_SNAPSHOT_SCHEMA = {
  type: 'object',
  properties: {
    elements: {
      type: 'array',
      items: buildElementSchema(4), // 5 levels total
    },
  },
  required: ['elements'],
};

/**
 * Assign vision refs (v1, v2, ...) to elements post-hoc.
 * Modifies elements in place.
 *
 * @param {Array} elements - Array of elements from Gemini response
 * @param {object} counter - Counter object with 'value' property
 * @returns {Array} Same elements array with refs assigned
 */
export function assignRefs(elements, counter = { value: 1 }) {
  for (const el of elements) {
    el.ref = `v${counter.value++}`;
    if (el.children?.length > 0) {
      assignRefs(el.children, counter);
    }
  }
  return elements;
}

/**
 * Validate an element's role against ARIA_ROLES enum.
 *
 * @param {string} role - Role to validate
 * @returns {boolean} True if role is valid
 */
export function isValidRole(role) {
  return ARIA_ROLES.includes(role);
}
