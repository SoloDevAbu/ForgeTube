import React from "react";
import { Composition } from "remotion";
import { Thumbnails } from "./Thumbnail";
import type { ThumbnailRenderProps } from "../core/schemas/publish";

const defaultProps: ThumbnailRenderProps = { width: 1280, height: 720, variants: [] };

/** Kept apart from the film renderer, so thumbnail work never invalidates rendered video chunks. */
export const Root: React.FC = () => {
  return (
    <Composition
      id="Thumbnails"
      component={Thumbnails}
      durationInFrames={1}
      fps={30}
      width={1280}
      height={720}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({
        // One frame per variant: frame 0 is A, frame 1 is B, frame 2 is C.
        durationInFrames: Math.max(1, props.variants.length),
        width: props.width,
        height: props.height,
        props,
      })}
    />
  );
};
