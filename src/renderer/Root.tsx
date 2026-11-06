import React from "react";
import { Composition } from "remotion";
import { DocumentaryComposition } from "./compositions/DocumentaryComposition";
import type { RenderManifest } from "../core/schemas/renderManifest";

const defaultProps: RenderManifest = {
  schemaVersion: 1,
  projectId: "preview",
  title: "Documentary Preview",
  width: 1920,
  height: 1080,
  fps: 30,
  totalDurationFrames: 300,
  totalDurationSeconds: 10,
  scenes: [],
  chapters: [],
  audio: {
    masterVolume: 1.0,
    voiceTracks: [],
    soundEffects: [],
    musicBeds: [],
  },
  metadata: {
    compiledAt: new Date().toISOString(),
    usesEstimatedTiming: false,
  },
};

export const Root: React.FC = () => {
  return (
    <Composition
      id="Documentary"
      component={DocumentaryComposition}
      durationInFrames={300}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => {
        return {
          durationInFrames: props.totalDurationFrames || 300,
          fps: props.fps || 30,
          width: props.width || 1920,
          height: props.height || 1080,
          props,
        };
      }}
    />
  );
};
