import { interpolate } from "remotion";
import type { CameraEffect } from "../../shared/types";

export interface CameraTransform {
  scale: number;
  translateXPercent: number;
  translateYPercent: number;
}

/**
 * Computes deterministic camera transform at a given frame within a scene.
 * Guaranteed to keep edges covered and start/end states predictable.
 */
export function getCameraTransform(
  effect: CameraEffect,
  intensity: number,
  localFrame: number,
  durationFrames: number
): CameraTransform {
  const safeIntensity = Math.min(0.25, Math.max(0, intensity));
  const progress = interpolate(localFrame, [0, Math.max(1, durationFrames)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  switch (effect) {
    case "slow_zoom_in":
      return {
        scale: 1.0 + progress * safeIntensity,
        translateXPercent: 0,
        translateYPercent: 0,
      };

    case "slow_zoom_out":
      return {
        scale: 1.0 + safeIntensity - progress * safeIntensity,
        translateXPercent: 0,
        translateYPercent: 0,
      };

    case "pan_left":
      return {
        scale: 1.0 + safeIntensity,
        translateXPercent: (0.5 - progress) * (safeIntensity * 100),
        translateYPercent: 0,
      };

    case "pan_right":
      return {
        scale: 1.0 + safeIntensity,
        translateXPercent: (progress - 0.5) * (safeIntensity * 100),
        translateYPercent: 0,
      };

    case "pan_up":
      return {
        scale: 1.0 + safeIntensity,
        translateXPercent: 0,
        translateYPercent: (0.5 - progress) * (safeIntensity * 100),
      };

    case "pan_down":
      return {
        scale: 1.0 + safeIntensity,
        translateXPercent: 0,
        translateYPercent: (progress - 0.5) * (safeIntensity * 100),
      };

    case "cinematic_drift":
      return {
        scale: 1.0 + progress * (safeIntensity * 0.7),
        translateXPercent: (progress - 0.5) * (safeIntensity * 50),
        translateYPercent: (0.5 - progress) * (safeIntensity * 30),
      };

    case "static":
    default:
      return {
        scale: 1.0,
        translateXPercent: 0,
        translateYPercent: 0,
      };
  }
}
