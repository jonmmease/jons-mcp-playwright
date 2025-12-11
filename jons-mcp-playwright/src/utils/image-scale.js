/**
 * PNG image scaling utilities
 *
 * Scale screenshots to logical pixel coordinates (viewport dimensions)
 * to account for device pixel ratio differences.
 */

import { PNG } from 'pngjs';

/**
 * Scale a PNG image to target dimensions using nearest-neighbor scaling.
 * Used to convert device-pixel screenshots to logical viewport coordinates.
 * @param {Buffer} buffer - PNG image buffer
 * @param {number} targetWidth - Target width in logical pixels
 * @param {number} targetHeight - Target height in logical pixels
 * @returns {{buffer: Buffer, originalWidth: number, originalHeight: number}}
 */
export function scaleToLogicalPixels(buffer, targetWidth, targetHeight) {
  const png = PNG.sync.read(buffer);
  const { width: srcWidth, height: srcHeight } = png;

  // If already at target size, return as-is
  if (srcWidth === targetWidth && srcHeight === targetHeight) {
    return { buffer, originalWidth: srcWidth, originalHeight: srcHeight };
  }

  const scaled = new PNG({ width: targetWidth, height: targetHeight });

  // Nearest-neighbor scaling
  const scaleX = srcWidth / targetWidth;
  const scaleY = srcHeight / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.floor(x * scaleX);
      const srcY = Math.floor(y * scaleY);

      const srcIdx = (srcY * srcWidth + srcX) * 4;
      const dstIdx = (y * targetWidth + x) * 4;

      scaled.data[dstIdx] = png.data[srcIdx];         // R
      scaled.data[dstIdx + 1] = png.data[srcIdx + 1]; // G
      scaled.data[dstIdx + 2] = png.data[srcIdx + 2]; // B
      scaled.data[dstIdx + 3] = png.data[srcIdx + 3]; // A
    }
  }

  return {
    buffer: PNG.sync.write(scaled),
    originalWidth: srcWidth,
    originalHeight: srcHeight,
  };
}
