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

from PIL import Image, ImageDraw, ImageFont

# Default model - can be overridden via --model
MODEL = "gemini-2.0-flash-exp"

# Okabe-Ito colorblind-friendly palette (RGB tuples, excluding black)
OKABE_ITO_COLORS = [
    (230, 159, 0),    # Orange
    (86, 180, 233),   # Sky Blue
    (0, 158, 115),    # Bluish Green
    (240, 228, 66),   # Yellow
    (0, 114, 178),    # Blue
    (213, 94, 0),     # Vermillion
    (204, 121, 167),  # Reddish Purple
]

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


def assign_refs(elements, counter=None):
    """Assign v-prefixed refs to elements (v1, v2, ...) in tree order."""
    if counter is None:
        counter = {'value': 1}

    for el in elements:
        el['ref'] = f"v{counter['value']}"
        counter['value'] += 1
        if 'children' in el:
            assign_refs(el['children'], counter)


def draw_annotations(image_path, elements, output_path):
    """Draw bounding boxes and ref labels on image.

    Args:
        image_path: Path to original image
        elements: List of elements with ref and bounding_box
        output_path: Path to save annotated image
    """
    # Open image and convert to RGBA for transparency support
    img = Image.open(image_path).convert('RGBA')

    # Create overlay for semi-transparent fills
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw_overlay = ImageDraw.Draw(overlay)

    # Create draw context for borders and labels
    draw = ImageDraw.Draw(img)

    # Try to load a font, fall back to default
    try:
        # Try common system fonts
        font = None
        font_paths = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/SFNSMono.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ]
        for fp in font_paths:
            if Path(fp).exists():
                font = ImageFont.truetype(fp, 14)
                break
        if font is None:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    # Flatten elements to list with refs
    def flatten(els, result=None):
        if result is None:
            result = []
        for el in els:
            result.append(el)
            if 'children' in el:
                flatten(el['children'], result)
        return result

    flat_elements = flatten(elements)

    # Draw each element
    for i, el in enumerate(flat_elements):
        bbox = el.get('bounding_box', [])
        ref = el.get('ref', f'v{i+1}')

        if len(bbox) != 4:
            continue

        y_min, x_min, y_max, x_max = bbox
        color = OKABE_ITO_COLORS[i % len(OKABE_ITO_COLORS)]

        # Draw semi-transparent fill on overlay
        fill_color = (*color, 40)  # ~15% opacity
        draw_overlay.rectangle([x_min, y_min, x_max, y_max], fill=fill_color)

        # Draw solid border (2px width)
        draw.rectangle([x_min, y_min, x_max, y_max], outline=color, width=2)

        # Draw ref label background and text
        label = ref
        # Get text bounding box
        text_bbox = draw.textbbox((0, 0), label, font=font)
        text_width = text_bbox[2] - text_bbox[0]
        text_height = text_bbox[3] - text_bbox[1]

        # Position label at top-left of bounding box
        label_x = x_min + 2
        label_y = y_min + 2

        # Ensure label stays within image bounds
        if label_x + text_width + 4 > img.width:
            label_x = img.width - text_width - 4
        if label_y + text_height + 4 > img.height:
            label_y = img.height - text_height - 4

        # Draw label background
        padding = 2
        draw.rectangle(
            [label_x - padding, label_y - padding,
             label_x + text_width + padding, label_y + text_height + padding],
            fill=color
        )

        # Draw label text (white for dark colors, black for light)
        # Simple luminance check
        luminance = 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]
        text_color = (0, 0, 0) if luminance > 128 else (255, 255, 255)
        draw.text((label_x, label_y), label, fill=text_color, font=font)

    # Composite overlay onto image
    img = Image.alpha_composite(img, overlay)

    # Convert back to RGB for saving as PNG (or keep RGBA)
    img.save(output_path, 'PNG')

    return output_path


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
    parser.add_argument("--annotate", action="store_true",
                       help="Generate annotated image with bounding box overlays")
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

        # Assign refs to elements
        elements = tree.get('elements', [])
        assign_refs(elements)

        # Build result
        result = {
            "width": width,
            "height": height,
            "model": args.model,
            "elements": elements,
        }

        if errors:
            result["validation_warnings"] = errors

        # Generate annotated image if requested
        if args.annotate:
            input_path = Path(args.image_path)
            annotated_path = input_path.parent / f"{input_path.stem}_annotated.png"
            draw_annotations(args.image_path, elements, str(annotated_path))
            result["annotated_image"] = str(annotated_path)

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
