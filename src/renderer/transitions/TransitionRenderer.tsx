import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import type { TransitionType } from "../../shared/types";

export interface TransitionRendererProps {
  type: TransitionType;
  /** Frames of the incoming transition. */
  durationFrames: number;
  sceneDurationFrames: number;
  /** Frames at the end of this scene that fade out to `fadeOutColor`. */
  fadeOutFrames: number;
  fadeOutColor: string;
  children: React.ReactNode;
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const TransitionRenderer: React.FC<TransitionRendererProps> = ({
  type,
  durationFrames,
  sceneDurationFrames,
  fadeOutFrames,
  fadeOutColor,
  children,
}) => {
  const frame = useCurrentFrame();
  const fadesIn = durationFrames > 0 && (type === "fade_black" || type === "fade_white");

  // The incoming scene dissolves over the previous one, which keeps playing underneath.
  const opacity =
    type === "cross_dissolve" && durationFrames > 0
      ? interpolate(frame, [0, durationFrames], [0, 1], clamp)
      : 1;

  const fadeInOverlay = fadesIn ? interpolate(frame, [0, durationFrames], [1, 0], clamp) : 0;
  const fadeOutOverlay =
    fadeOutFrames > 0
      ? interpolate(frame, [sceneDurationFrames - fadeOutFrames, sceneDurationFrames - 1], [0, 1], clamp)
      : 0;

  const overlay = (color: string, overlayOpacity: number) =>
    overlayOpacity > 0 ? (
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: color,
          opacity: overlayOpacity,
          pointerEvents: "none",
        }}
      />
    ) : null;

  return (
    <div style={{ width: "100%", height: "100%", opacity, position: "relative" }}>
      {children}
      {overlay(type === "fade_white" ? "#ffffff" : "#000000", fadeInOverlay)}
      {overlay(fadeOutColor, fadeOutOverlay)}
    </div>
  );
};
