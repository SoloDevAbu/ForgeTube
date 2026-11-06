import React from "react";
import { Sequence, AbsoluteFill } from "remotion";
import type { RenderManifest } from "../../core/schemas/renderManifest";
import { SceneRenderer } from "../scenes/SceneRenderer";

/**
 * Picture only. Audio is mixed by FFmpeg into editing/mix.wav and muxed after
 * the render, so a mix change never re-renders any video.
 */
export const DocumentaryComposition: React.FC<RenderManifest> = ({ scenes, projectId }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {scenes.map((scene) => (
        <Sequence
          key={scene.sceneId}
          from={scene.startFrame}
          durationInFrames={scene.durationFrames}
          name={scene.title}
        >
          <SceneRenderer scene={scene} projectId={projectId} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
