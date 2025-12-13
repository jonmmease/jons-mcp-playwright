#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "google-genai==1.52.0",
#     "opencv-python==4.10.0.84",
#     "numpy==1.26.4",
#     "pillow==10.4.0",
# ]
# ///
"""
Screenshot Locator: Find UI elements by description
Returns pixel coordinates in the input image's coordinate system
"""

import argparse
import json
import os
import sys
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# HSV range for AI-generated magenta (validated with real API)
LOWER_MAGENTA = np.array([130, 50, 100])
UPPER_MAGENTA = np.array([175, 255, 255])

# Gemini model with image generation capability
MODEL = "gemini-3-pro-image-preview"

PROMPT_TEMPLATE = """Add a bright magenta (#FF00FF) filled circle marker at the location of: {description}

The circle should be approximately 15 pixels in diameter.

CRITICAL INSTRUCTIONS:
- Preserve the entire original image content exactly
- Do not modify or remove any existing content
- Maintain original image quality and resolution
- Do not crop, resize, or significantly alter the image dimensions
- Add the marker as an overlay only
- The marker should be clearly visible and not blend with the background
- Place the marker at the CENTER of the described element/location"""


def locate(image_path: str, description: str, debug: bool = False) -> dict:
    """Full pipeline: API annotation → detection → pixel coordinates."""

    # Load input and record dimensions
    input_image = Image.open(image_path)
    input_width, input_height = input_image.size

    # Call Gemini API
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    prompt = PROMPT_TEMPLATE.format(description=description)

    response = client.models.generate_content(
        model=MODEL,
        contents=[prompt, input_image],
        config=types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"]
        )
    )

    # Extract output image
    output_image = None
    for part in response.candidates[0].content.parts:
        if hasattr(part, 'inline_data') and part.inline_data is not None:
            output_image = Image.open(BytesIO(part.inline_data.data))

    if output_image is None:
        return {"detected": False, "error": "No image in API response"}

    # Save annotated image
    output_path = Path(image_path)
    annotated_path = str(output_path.parent / f"{output_path.stem}_annotated.png")
    output_image.save(annotated_path)

    # Detect marker with OpenCV
    image_cv = cv2.cvtColor(np.array(output_image), cv2.COLOR_RGB2BGR)
    output_height, output_width = image_cv.shape[:2]

    hsv = cv2.cvtColor(image_cv, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, LOWER_MAGENTA, UPPER_MAGENTA)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

    if debug:
        cv2.imwrite("/tmp/screenshot_locator_debug_mask.png", mask)

    # Find centroid
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return {"detected": False, "error": "No marker detected", "annotated_image": annotated_path}

    largest = max(contours, key=cv2.contourArea)
    M = cv2.moments(largest)

    if M["m00"] == 0:
        return {"detected": False, "error": "Invalid marker shape", "annotated_image": annotated_path}

    # Get centroid in output image coordinates
    cx_output = M["m10"] / M["m00"]
    cy_output = M["m01"] / M["m00"]

    # Convert to normalized coordinates (0-1)
    norm_x = cx_output / output_width
    norm_y = cy_output / output_height

    # Scale to input image coordinates
    x = round(norm_x * input_width)
    y = round(norm_y * input_height)

    return {
        "detected": True,
        "x": x,
        "y": y,
        "input_width": input_width,
        "input_height": input_height,
        "annotated_image": annotated_path
    }


def main():
    parser = argparse.ArgumentParser(description="Locate UI elements by description")
    parser.add_argument("image_path", help="Path to input image")
    parser.add_argument("description", help="Description of element to locate")
    parser.add_argument("--debug", action="store_true", help="Save debug mask")
    args = parser.parse_args()

    if not os.getenv("GEMINI_API_KEY"):
        print("Error: GEMINI_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    result = locate(args.image_path, args.description, args.debug)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["detected"] else 1)


if __name__ == "__main__":
    main()
