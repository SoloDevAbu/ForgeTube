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

/** Rejects a crop that would stretch the picture, measured in source pixels. */
export function validateCropAspect(
  crop: NormalizedCrop,
  sourceWidth: number,
  sourceHeight: number,
  targetAspect: number
): void {
  const aspect = (crop.width * sourceWidth) / (crop.height * sourceHeight);
  if (Math.abs(aspect - targetAspect) / targetAspect > 0.01) {
    throw new ValidationError(
      `Crop aspect ${aspect.toFixed(3)} does not match the frame's ${targetAspect.toFixed(3)}; the picture would stretch.`
    );
  }
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Computes exact normalized and pixel crop values. The compiler passes the
 * result to the renderer, and the calibration preview uses it too, so both
 * show the same framing.
 */
export function computeCropParameters(opts: {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  fit: FitMode;
  manualCrop?: NormalizedCrop | null;
  position?: { x: number; y: number };
  zoom?: number;
}): ResolvedCropParams {
  const { sourceWidth, sourceHeight, targetWidth, targetHeight, fit, manualCrop } = opts;
  const targetAspect = targetWidth / targetHeight;
  const sourceAspect = sourceWidth / sourceHeight;

  let normalized: NormalizedCrop;

  if (fit === "manual" && manualCrop) {
    validateNormalizedCrop(manualCrop);
    normalized = { ...manualCrop };
  } else if (fit === "contain") {
    normalized = { x: 0, y: 0, width: 1.0, height: 1.0 };
  } else {
    const zoom = Math.max(1, opts.zoom ?? 1);
    const baseWidth = sourceAspect > targetAspect ? targetAspect / sourceAspect : 1;
    const baseHeight = sourceAspect > targetAspect ? 1 : sourceAspect / targetAspect;
    const width = Math.min(1, baseWidth / zoom);
    const height = Math.min(1, baseHeight / zoom);
    const posX = opts.position?.x ?? 0.5;
    const posY = opts.position?.y ?? 0.5;
    normalized = {
      x: round4((1 - width) * posX),
      y: round4((1 - height) * posY),
      width: round4(width),
      height: round4(height),
    };
  }

  const pxX = Math.round(normalized.x * sourceWidth);
  const pxY = Math.round(normalized.y * sourceHeight);
  const pxWidth = Math.min(sourceWidth - pxX, Math.round(normalized.width * sourceWidth));
  const pxHeight = Math.min(sourceHeight - pxY, Math.round(normalized.height * sourceHeight));

  return {
    normalizedCrop: normalized,
    pixelCrop: { x: pxX, y: pxY, width: pxWidth, height: pxHeight },
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
  };
}
