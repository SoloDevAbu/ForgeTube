import React from "react";
import { useCurrentFrame } from "remotion";
import type { CameraEffect } from "../../shared/types.js";
import { getCameraTransform } from "./cameraEffects";

export interface KenBurnsProps {
  effect: CameraEffect;
  intensity: number;
  durationFrames: number;
  children: React.ReactNode;
}

export const KenBurns: React.FC<KenBurnsProps> = ({
  effect,
  intensity,
  durationFrames,
  children,
}) => {
  const frame = useCurrentFrame();
  const { scale, translateXPercent, translateYPercent } = getCameraTransform(
    effect,
    intensity,
    frame,
    durationFrames
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          transform: `scale(${scale}) translate(${translateXPercent}%, ${translateYPercent}%)`,
          transformOrigin: "center center",
          willChange: "transform",
        }}
      >
        {children}
      </div>
    </div>
  );
};
