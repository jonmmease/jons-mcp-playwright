/**
 * Vision Tree YAML Converter
 *
 * Converts Gemini's JSON accessibility tree to YAML format
 * matching the browser_snapshot output style.
 *
 * @module vision-yaml
 */

/**
 * Convert vision elements to YAML format.
 *
 * Output format matches browser_snapshot style:
 * ```
 * - img "Chart Title" [ref=v1]
 *   - heading "Sales Report" [ref=v2]
 *   - group "X Axis" [ref=v3]
 *     - label "Q1" [ref=v4]
 * ```
 *
 * @param {Array} elements - Array of elements with refs assigned
 * @param {number} [indent=0] - Current indentation level
 * @returns {string} YAML-formatted string
 */
export function elementsToYaml(elements, indent = 0) {
  const lines = [];
  const prefix = '  '.repeat(indent);

  for (const el of elements) {
    // Quote the name to handle special characters
    const quotedName = quoteYamlString(el.name || '');

    // Format: - role "name" [ref=vN]
    lines.push(`${prefix}- ${el.role} ${quotedName} [ref=${el.ref}]`);

    // Recursively process children
    if (el.children?.length > 0) {
      lines.push(elementsToYaml(el.children, indent + 1));
    }
  }

  return lines.join('\n');
}

/**
 * Quote a string for YAML output.
 * Handles embedded quotes and special characters.
 *
 * @param {string} str - String to quote
 * @returns {string} Quoted string
 */
function quoteYamlString(str) {
  // Escape embedded double quotes
  const escaped = str.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Format metadata header for vision snapshot response.
 *
 * @param {object} options
 * @param {number} options.width - Image width in pixels
 * @param {number} options.height - Image height in pixels
 * @param {number} options.deviceScaleFactor - Device pixel ratio
 * @param {number} options.ttlMs - TTL in milliseconds
 * @param {string[]} [options.warnings] - Validation warnings
 * @returns {string} Formatted metadata line
 */
export function formatMetadata({ width, height, deviceScaleFactor, ttlMs, warnings }) {
  const parts = [
    `Image: ${width}x${height}px`,
    `Scale: ${deviceScaleFactor}x`,
    `Refs valid for: ${ttlMs / 1000}s`,
  ];

  if (warnings?.length > 0) {
    parts.push(`Warnings: ${warnings.length}`);
  }

  return parts.join(' | ');
}

/**
 * Format a complete vision snapshot response.
 *
 * @param {object} options
 * @param {Array} options.elements - Elements with refs assigned
 * @param {number} options.width - Image width in pixels
 * @param {number} options.height - Image height in pixels
 * @param {number} options.deviceScaleFactor - Device pixel ratio
 * @param {number} options.ttlMs - TTL in milliseconds
 * @param {string[]} [options.warnings] - Validation warnings
 * @returns {string} Complete formatted response
 */
export function formatVisionResponse({ elements, width, height, deviceScaleFactor, ttlMs, warnings }) {
  const metadata = formatMetadata({ width, height, deviceScaleFactor, ttlMs, warnings });
  const yaml = elementsToYaml(elements);

  return `${metadata}\n\n${yaml}`;
}
