import React from "react";
import { Img, staticFile } from "remotion";
import type { NormalizedCrop } from "../../core/schemas/storyboard";
import type { FitMode, CameraEffect } from "../../shared/types";
import { KenBurns } from "../camera/KenBurns";

export interface ImageSceneProps {
  projectId: string;
  imagePath: string;
  fit: FitMode;
  crop: NormalizedCrop | null;
  camera: {
    effect: CameraEffect;
    intensity: number;
    origin: string;
  };
  durationFrames: number;
}

const fullFrame: React.CSSProperties = { width: "100%", height: "100%", position: "relative", overflow: "hidden" };

export const ImageScene: React.FC<ImageSceneProps> = ({ projectId, imagePath, fit, crop, camera, durationFrames }) => {
  // Each project's assets folder is linked into the shared bundle under its ID.
  const src = staticFile(`${projectId}/${imagePath}`);

  const content = () => {
    // The compiler resolves every non-contain scene to a 16:9 crop, so this is the only cover path.
    if (fit !== "contain" && crop) {
      return (
        <div style={fullFrame}>
          <Img
            src={src}
            alt=""
            style={{
              position: "absolute",
              width: `${(1 / crop.width) * 100}%`,
              height: `${(1 / crop.height) * 100}%`,
              left: `-${(crop.x / crop.width) * 100}%`,
              top: `-${(crop.y / crop.height) * 100}%`,
              maxWidth: "none",
            }}
          />
        </div>
      );
    }

    return (
      <Img
        src={src}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: fit === "contain" ? "contain" : "cover" }}
      />
    );
  };

  return (
    <div style={{ width: "100%", height: "100%", backgroundColor: "#000000", position: "absolute", top: 0, left: 0 }}>
      <KenBurns
        effect={camera.effect}
        intensity={camera.intensity}
        origin={camera.origin}
        durationFrames={durationFrames}
      >
        {content()}
      </KenBurns>
    </div>
  );
};
