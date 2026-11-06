import React from "react";
import type { CompiledScene } from "../../core/schemas/renderManifest.js";
import { ImageScene } from "./ImageScene";
import { TransitionRenderer } from "../transitions/TransitionRenderer";

export interface SceneRendererProps {
  scene: CompiledScene;
}

export const SceneRenderer: React.FC<SceneRendererProps> = ({ scene }) => {
  return (
    <TransitionRenderer
      type={scene.transition.type}
      overlapFrames={scene.transition.overlapFrames}
      durationFrames={scene.durationFrames}
    >
      <ImageScene
        imagePath={scene.imagePath}
        fit={scene.fit}
        crop={scene.crop}
        camera={scene.camera}
        durationFrames={scene.durationFrames}
      />
    </TransitionRenderer>
  );
};
