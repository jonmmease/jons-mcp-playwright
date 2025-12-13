#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "google-genai>=1.0.0",
#     "pillow>=10.0.0",
# ]
# ///
"""
Screenshot Snapshot: Generate accessibility tree from screenshots using Gemini vision AI.

Outputs JSON to stdout with element hierarchy including bounding boxes.
Used by browser_screenshot_snapshot tool in jons-mcp-playwright.
"""

import argparse
import base64
import json
import os
import sys
from pathlib import Path

from PIL import Image

# Default model - can be overridden via --model
MODEL = "gemini-2.0-flash-exp"

# Standard ARIA roles (51 roles for canvas GUI support)
ARIA_ROLES = [
    # Interactive/Widget
    'button', 'link', 'checkbox', 'radio', 'switch', 'slider',
    'textbox', 'combobox', 'listbox', 'option', 'menu', 'menuitem',
    'menubar', 'tab', 'tablist', 'tabpanel', 'progressbar', 'scrollbar',
    'spinbutton', 'tree', 'treeitem',
    # Structure
    'img', 'heading', 'label', 'paragraph', 'code', 'list', 'listitem',
    'table', 'row', 'cell', 'columnheader', 'rowheader', 'grid', 'gridcell',
    'separator', 'figure', 'group', 'generic',
    # Containers/Landmarks
    'dialog', 'alertdialog', 'toolbar', 'navigation', 'form', 'region',
    'banner', 'main', 'search',
    # Status
    'alert', 'status', 'tooltip',
]

SYSTEM_PROMPT = """You are an accessibility tree generator. Analyze screenshots and produce structured accessibility trees that enable automation and screen reader access.

## Coordinate System
- Origin: (0, 0) is the TOP-LEFT corner of the image
- Format: [y_min, x_min, y_max, x_max] in PIXELS
- y_min: Top edge (smaller y value)
- y_max: Bottom edge (larger y value)
- x_min: Left edge (smaller x value)
- x_max: Right edge (larger x value)
- All values are integers

## Role Selection
Use ONLY roles from the provided schema enum. Common roles:
- `img`: Root element of charts, diagrams, visual components
- `group`: Containers (axes, legends, sections)
- `label`, `paragraph`, `heading`: Text elements (include verbatim text in name)
- `button`: Interactive buttons
- `link`: Clickable links
- `generic`: Data points, grid lines, decorative elements

## Hierarchical Analysis
1. Identify the root element encompassing the visual
2. Break down into major components (L1)
3. Decompose into sub-components (L2)
4. Identify fine-grained elements (L3)
5. Include atomic elements where meaningful (L4)

## Text Content
For text elements (paragraph, label, heading, code):
- Include the COMPLETE text verbatim in the name field
- Do not summarize or truncate

## Example
For a bar chart at coordinates [50, 100, 400, 600]:
```json
{
  "elements": [{
    "role": "img",
    "name": "Q1-Q4 Sales Chart",
    "bounding_box": [50, 100, 400, 600],
    "children": [{
      "role": "heading",
      "name": "Quarterly Revenue Report 2024",
      "bounding_box": [60, 250, 90, 450],
      "children": []
    }, {
      "role": "group",
      "name": "X Axis",
      "bounding_box": [360, 100, 390, 600],
      "children": []
    }]
  }]
}
```

## Requirements
- Bounding boxes must be pixel-accurate
- Names must be descriptive for screen readers
- Hierarchy reflects visual containment
- Include all meaningful interactive elements"""


def build_schema(depth=4):
    """Generate nested schema without $ref (Gemini constraint)."""

    def element(d):
        base = {
            'type': 'object',
            'properties': {
                'role': {'type': 'string', 'enum': ARIA_ROLES},
                'name': {'type': 'string'},
                'bounding_box': {
                    'type': 'array',
                    'items': {'type': 'integer'}
                }
            },
            'required': ['role', 'name', 'bounding_box']
        }
        if d > 0:
            base['properties']['children'] = {
                'type': 'array',
                'items': element(d - 1)
            }
        return base

    return {
        'type': 'object',
        'properties': {
            'elements': {
                'type': 'array',
                'items': element(depth)
            }
        },
        'required': ['elements']
    }


def validate_element(el, width, height, errors, path="root"):
    """Validate and clamp bounding boxes."""
    bbox = el.get('bounding_box', [])
    if len(bbox) != 4:
        errors.append(f"{path}: invalid bounding_box length")
        return

    y_min, x_min, y_max, x_max = bbox

    # Validate ordering
    if y_min > y_max or x_min > x_max:
        errors.append(f"{path}: invalid bbox dimensions (y_min={y_min}, y_max={y_max}, x_min={x_min}, x_max={x_max})")

    # Clamp to image bounds
    el['bounding_box'] = [
        max(0, min(height, y_min)),
        max(0, min(width, x_min)),
        max(0, min(height, y_max)),
        max(0, min(width, x_max))
    ]

    # Validate role
    if el.get('role') not in ARIA_ROLES:
        errors.append(f"{path}: invalid role '{el.get('role')}'")

    # Recurse
    for i, child in enumerate(el.get('children', [])):
        validate_element(child, width, height, errors, f"{path}.children[{i}]")


def main():
    parser = argparse.ArgumentParser(
        description="Generate accessibility tree from screenshot using Gemini vision AI"
    )
    parser.add_argument("image_path", help="Path to screenshot image")
    parser.add_argument("--hint", help="Optional content hint (e.g., 'This is a bar chart')")
    parser.add_argument("--model", default=MODEL, help=f"Gemini model to use (default: {MODEL})")
    args = parser.parse_args()

    # Check for API key
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print(json.dumps({
            "error": "GEMINI_API_KEY environment variable not set",
            "error_code": "auth_missing"
        }))
        sys.exit(1)

    # Verify image exists
    if not Path(args.image_path).exists():
        print(json.dumps({
            "error": f"Image not found: {args.image_path}",
            "error_code": "file_not_found"
        }))
        sys.exit(1)

    try:
        from google import genai
        from google.genai import types

        # Load image and get dimensions
        image = Image.open(args.image_path)
        width, height = image.size

        # Read image bytes for API
        with open(args.image_path, "rb") as f:
            image_bytes = f.read()

        # Build user prompt
        prompt = f"""Analyze this {width}x{height} pixel screenshot and generate an accessibility tree.

{args.hint if args.hint else ''}

For each element:
1. Assign an appropriate ARIA role from the schema's enum
2. Provide a descriptive name:
   - For text elements (paragraph, label, heading, code): include the complete text verbatim
   - For other elements: a concise description for screen reader announcement
3. Specify bounding box as [y_min, x_min, y_max, x_max] in pixels

Structure hierarchically (up to 5 levels) based on visual containment.
Focus on elements useful for automation and data extraction."""

        # Call Gemini API with structured output
        client = genai.Client(api_key=api_key)

        # Determine mime type from file extension
        ext = Path(args.image_path).suffix.lower()
        mime_type = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
        }.get(ext, 'image/png')

        response = client.models.generate_content(
            model=args.model,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_text(text=prompt),
                        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    ]
                )
            ],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_schema=build_schema(),
            )
        )

        # Parse response
        tree = json.loads(response.text)

        # Validate and clamp bounding boxes
        errors = []
        for i, el in enumerate(tree.get('elements', [])):
            validate_element(el, width, height, errors, f"elements[{i}]")

        # Build result
        result = {
            "width": width,
            "height": height,
            "model": args.model,
            "elements": tree.get('elements', []),
        }

        if errors:
            result["validation_warnings"] = errors

        print(json.dumps(result))
        sys.exit(0)

    except json.JSONDecodeError as e:
        print(json.dumps({
            "error": f"Invalid JSON from Gemini: {e}",
            "error_code": "schema_error"
        }))
        sys.exit(1)

    except Exception as e:
        error_str = str(e).lower()
        error_code = "unknown"

        if "quota" in error_str:
            error_code = "quota_exceeded"
        elif "rate" in error_str:
            error_code = "rate_limited"
        elif "auth" in error_str or "api key" in error_str:
            error_code = "auth_error"
        elif "timeout" in error_str:
            error_code = "timeout"

        print(json.dumps({
            "error": str(e),
            "error_code": error_code
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
