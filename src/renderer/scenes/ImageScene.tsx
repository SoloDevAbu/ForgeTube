import React from "react";
import { staticFile } from "remotion";
import type { NormalizedCrop } from "../../core/schemas/storyboard.js";
import type { FitMode, CameraEffect } from "../../shared/types.js";
import { KenBurns } from "../camera/KenBurns";

export interface ImageSceneProps {
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

export const ImageScene: React.FC<ImageSceneProps> = ({
  imagePath,
  fit,
  crop,
  camera,
  durationFrames,
}) => {
  const src = staticFile(imagePath);

  const renderImageContent = () => {
    if (fit === "manual" && crop) {
      const containerStyle: React.CSSProperties = {
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      };

      const imgStyle: React.CSSProperties = {
        position: "absolute",
        width: `${(1 / crop.width) * 100}%`,
        height: `${(1 / crop.height) * 100}%`,
        left: `-${(crop.x / crop.width) * 100}%`,
        top: `-${(crop.y / crop.height) * 100}%`,
        maxWidth: "none",
      };

      return (
        <div style={containerStyle}>
          <img src={src} alt="" style={imgStyle} />
        </div>
      );
    }

    if (fit === "contain") {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: "#000000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src={src}
            alt=""
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
          />
        </div>
      );
    }

    // Default 'cover'
    return (
      <img
        src={src}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    );
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "#000000",
        position: "absolute",
        top: 0,
        left: 0,
      }}
    >
      <KenBurns
        effect={camera.effect}
        intensity={camera.intensity}
        durationFrames={durationFrames}
      >
        {renderImageContent()}
      </KenBurns>
    </div>
  );
};
