import React from "react";
import { Sequence, Audio, staticFile, useCurrentFrame } from "remotion";
import type { CompiledSoundEffect } from "../../core/schemas/renderManifest.js";
import { calculateFadeVolume } from "./volumeEnvelope";

const SoundEffectPlayer: React.FC<{
  sfx: CompiledSoundEffect;
  masterVolume: number;
}> = ({ sfx, masterVolume }) => {
  const frame = useCurrentFrame();
  const volume =
    calculateFadeVolume(
      frame,
      sfx.durationFrames,
      sfx.fadeInFrames,
      sfx.fadeOutFrames,
      sfx.volume
    ) * masterVolume;

  return <Audio src={staticFile(sfx.file)} volume={volume} loop={sfx.loop} />;
};

export const SoundEffectsTrack: React.FC<{
  effects: CompiledSoundEffect[];
  masterVolume: number;
}> = ({ effects, masterVolume }) => {
  return (
    <>
      {effects.map((sfx) => (
        <Sequence
          key={sfx.eventId}
          from={sfx.startFrame}
          durationInFrames={sfx.durationFrames}
        >
          <SoundEffectPlayer sfx={sfx} masterVolume={masterVolume} />
        </Sequence>
      ))}
    </>
  );
};
