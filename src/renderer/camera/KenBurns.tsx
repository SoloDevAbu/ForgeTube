import React from "react";
import { useCurrentFrame } from "remotion";
import type { CameraEffect } from "../../shared/types";
import { getCameraTransform } from "./cameraEffects";

export interface KenBurnsProps {
  effect: CameraEffect;
  intensity: number;
  origin: string;
  durationFrames: number;
  children: React.ReactNode;
}

export const KenBurns: React.FC<KenBurnsProps> = ({
  effect,
  intensity,
  origin,
  durationFrames,
  children,
}) => {
  const frame = useCurrentFrame();
  const { scale, translateXPercent, translateYPercent, transformOrigin } = getCameraTransform(
    effect,
    intensity,
    frame,
    durationFrames,
    origin
  );

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          transform: `scale(${scale}) translate(${translateXPercent}%, ${translateYPercent}%)`,
          transformOrigin,
        }}
      >
        {children}
      </div>
    </div>
  );
};
