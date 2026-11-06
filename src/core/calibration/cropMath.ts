import type { NormalizedCrop } from "../schemas/storyboard.js";
import type { FitMode } from "../../shared/types.js";
import { ValidationError } from "../../shared/errors.js";

export interface ResolvedCropParams {
  normalizedCrop: NormalizedCrop;
  pixelCrop: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
}

/**
 * Validates normalized crop coordinates.
 */
export function validateNormalizedCrop(crop: NormalizedCrop): void {
  if (crop.x < 0 || crop.x > 1) {
    throw new ValidationError(`Crop x coordinate must be between 0 and 1, got ${crop.x}`);
  }
  if (crop.y < 0 || crop.y > 1) {
    throw new ValidationError(`Crop y coordinate must be between 0 and 1, got ${crop.y}`);
  }
  if (crop.width <= 0 || crop.width > 1) {
    throw new ValidationError(`Crop width must be between 0 and 1, got ${crop.width}`);
  }
  if (crop.height <= 0 || crop.height > 1) {
    throw new ValidationError(`Crop height must be between 0 and 1, got ${crop.height}`);
  }
  if (crop.x + crop.width > 1.0001) {
    throw new ValidationError(`Crop x + width (${crop.x + crop.width}) exceeds 1.0`);
  }
  if (crop.y + crop.height > 1.0001) {
    throw new ValidationError(`Crop y + height (${crop.y + crop.height}) exceeds 1.0`);
  }
}

/**
 * Computes exact normalized and pixel crop values for an image given target frame dimensions and fit mode.
 * Used identically by both CLI preview still generator and Remotion composition renderer.
 */
export function computeCropParameters(opts: {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  fit: FitMode;
  manualCrop?: NormalizedCrop | null;
  position?: { x: number; y: number };
  scale?: number;
}): ResolvedCropParams {
  const { sourceWidth, sourceHeight, targetWidth, targetHeight, fit, manualCrop } = opts;
  const targetAspect = targetWidth / targetHeight;
  const sourceAspect = sourceWidth / sourceHeight;

  let finalNormalizedCrop: NormalizedCrop;

  if (fit === "manual" && manualCrop) {
    validateNormalizedCrop(manualCrop);
    finalNormalizedCrop = { ...manualCrop };
  } else if (fit === "contain") {
    // Preserve entire source image
    finalNormalizedCrop = { x: 0, y: 0, width: 1.0, height: 1.0 };
  } else {
    // Default: 'cover' (center-cropped to 16:9 target aspect ratio without distortion)
    if (sourceAspect > targetAspect) {
      // Source is wider than target aspect ratio -> crop left/right edges
      const targetSourceWidth = sourceHeight * targetAspect;
      const normalizedWidth = Math.min(1.0, targetSourceWidth / sourceWidth);
      const posX = opts.position?.x ?? 0.5;
      const x = Math.max(0, Math.min(1.0 - normalizedWidth, (1.0 - normalizedWidth) * posX));
      finalNormalizedCrop = {
        x: Math.round(x * 10000) / 10000,
        y: 0,
        width: Math.round(normalizedWidth * 10000) / 10000,
        height: 1.0,
      };
    } else {
      // Source is taller than target aspect ratio -> crop top/bottom edges
      const targetSourceHeight = sourceWidth / targetAspect;
      const normalizedHeight = Math.min(1.0, targetSourceHeight / sourceHeight);
      const posY = opts.position?.y ?? 0.5;
      const y = Math.max(0, Math.min(1.0 - normalizedHeight, (1.0 - normalizedHeight) * posY));
      finalNormalizedCrop = {
        x: 0,
        y: Math.round(y * 10000) / 10000,
        width: 1.0,
        height: Math.round(normalizedHeight * 10000) / 10000,
      };
    }
  }

  // Calculate pixel bounds
  const pxX = Math.round(finalNormalizedCrop.x * sourceWidth);
  const pxY = Math.round(finalNormalizedCrop.y * sourceHeight);
  const pxWidth = Math.min(sourceWidth - pxX, Math.round(finalNormalizedCrop.width * sourceWidth));
  const pxHeight = Math.min(sourceHeight - pxY, Math.round(finalNormalizedCrop.height * sourceHeight));

  return {
    normalizedCrop: finalNormalizedCrop,
    pixelCrop: {
      x: pxX,
      y: pxY,
      width: pxWidth,
      height: pxHeight,
    },
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
  };
}

