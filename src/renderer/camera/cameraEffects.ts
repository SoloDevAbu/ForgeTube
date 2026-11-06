import { interpolate } from "remotion";
import type { CameraEffect } from "../../shared/types";

export interface CameraTransform {
  scale: number;
  translateXPercent: number;
  translateYPercent: number;
  transformOrigin: string;
}

const ORIGINS: Record<string, string> = {
  center: "50% 50%",
  top: "50% 0%",
  bottom: "50% 100%",
  left: "0% 50%",
  right: "100% 50%",
  top_left: "0% 0%",
  top_right: "100% 0%",
  bottom_left: "0% 100%",
  bottom_right: "100% 100%",
};

/**
 * Largest translate, as a percentage of the unscaled element, that keeps the
 * frame covered. In `scale(s) translate(t)` the translate is multiplied by s,
 * so the limit is (s - 1) / (2s), not (s - 1) / 2.
 */
export function maxCoverTranslatePercent(scale: number): number {
  return ((scale - 1) / (2 * scale)) * 100;
}

/**
 * Computes the camera transform at a frame within a scene. Every effect keeps
 * the image covering the frame at every frame.
 */
export function getCameraTransform(
  effect: CameraEffect,
  intensity: number,
  localFrame: number,
  durationFrames: number,
  origin = "center"
): CameraTransform {
  const safeIntensity = Math.min(0.25, Math.max(0, intensity));
  const progress = interpolate(localFrame, [0, Math.max(1, durationFrames)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const centered = { translateXPercent: 0, translateYPercent: 0, transformOrigin: "50% 50%" };
  const panScale = 1.0 + safeIntensity;
  const panReach = maxCoverTranslatePercent(panScale) * 0.98;

  switch (effect) {
    case "slow_zoom_in":
      return {
        ...centered,
        scale: 1.0 + progress * safeIntensity,
        transformOrigin: ORIGINS[origin] ?? ORIGINS.center!,
      };

    case "slow_zoom_out":
      return {
        ...centered,
        scale: 1.0 + safeIntensity - progress * safeIntensity,
        transformOrigin: ORIGINS[origin] ?? ORIGINS.center!,
      };

    case "pan_left":
      return { ...centered, scale: panScale, translateXPercent: (1 - 2 * progress) * panReach };

    case "pan_right":
      return { ...centered, scale: panScale, translateXPercent: (2 * progress - 1) * panReach };

    case "pan_up":
      return { ...centered, scale: panScale, translateYPercent: (1 - 2 * progress) * panReach };

    case "pan_down":
      return { ...centered, scale: panScale, translateYPercent: (2 * progress - 1) * panReach };

    case "cinematic_drift": {
      // Starts already zoomed so the sideways movement never exposes an edge.
      const scale = 1.0 + safeIntensity * (0.6 + 0.4 * progress);
      const reach = maxCoverTranslatePercent(1.0 + safeIntensity * 0.6) * 0.9;
      return {
        ...centered,
        scale,
        translateXPercent: (2 * progress - 1) * reach * 0.7,
        translateYPercent: (1 - 2 * progress) * reach * 0.4,
      };
    }

    case "static":
    default:
      return { ...centered, scale: 1.0 };
  }
}
