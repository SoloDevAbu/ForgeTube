import React from "react";
import type { CompiledScene } from "../../core/schemas/renderManifest";
import { ImageScene } from "./ImageScene";
import { TransitionRenderer } from "../transitions/TransitionRenderer";

export const SceneRenderer: React.FC<{ scene: CompiledScene; projectId: string }> = ({ scene, projectId }) => {
  return (
    <TransitionRenderer
      type={scene.transition.type}
      durationFrames={scene.transition.durationFrames}
      sceneDurationFrames={scene.durationFrames}
      fadeOutFrames={scene.transition.fadeOutFrames}
      fadeOutColor={scene.transition.fadeOutColor}
    >
      <ImageScene
        projectId={projectId}
        imagePath={scene.imagePath}
        fit={scene.fit}
        crop={scene.crop}
        camera={scene.camera}
        durationFrames={scene.durationFrames}
      />
    </TransitionRenderer>
  );
};
