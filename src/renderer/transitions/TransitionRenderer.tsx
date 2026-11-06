import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import type { TransitionType } from "../../shared/types";

export interface TransitionRendererProps {
  type: TransitionType;
  overlapFrames: number;
  durationFrames: number;
  children: React.ReactNode;
}

export const TransitionRenderer: React.FC<TransitionRendererProps> = ({
  type,
  overlapFrames,
  durationFrames,
  children,
}) => {
  const frame = useCurrentFrame();

  if (overlapFrames <= 0 || type === "cut") {
    return <>{children}</>;
  }

  // Cross dissolve: incoming scene fades from opacity 0 to 1 over overlapFrames
  if (type === "cross_dissolve") {
    const opacity = interpolate(frame, [0, overlapFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

    return (
      <div style={{ width: "100%", height: "100%", opacity, position: "relative" }}>
        {children}
      </div>
    );
  }

  // Fade black / white: overlay that fades out
  if (type === "fade_black" || type === "fade_white") {
    const overlayColor = type === "fade_black" ? "#000000" : "#ffffff";
    const overlayOpacity = interpolate(frame, [0, overlapFrames], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

    return (
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        {children}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundColor: overlayColor,
            opacity: overlayOpacity,
            pointerEvents: "none",
          }}
        />
      </div>
    );
  }

  return <>{children}</>;
};
