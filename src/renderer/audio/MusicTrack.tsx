import React from "react";
import { Sequence, Audio, staticFile, useCurrentFrame } from "remotion";
import type { CompiledMusicBed, CompiledVoiceTrack } from "../../core/schemas/renderManifest.js";
import { calculateFadeVolume, calculateMusicDucking } from "./volumeEnvelope";

const MusicBedPlayer: React.FC<{
  bed: CompiledMusicBed;
  voiceTracks: CompiledVoiceTrack[];
  masterVolume: number;
}> = ({ bed, voiceTracks, masterVolume }) => {
  const frame = useCurrentFrame();

  const fadeVol = calculateFadeVolume(
    frame,
    bed.durationFrames,
    bed.fadeInFrames,
    bed.fadeOutFrames,
    bed.volume
  );

  const globalFrame = bed.startFrame + frame;
  const duckMultiplier = calculateMusicDucking(globalFrame, bed, voiceTracks);
  const finalVolume = fadeVol * duckMultiplier * masterVolume;

  return <Audio src={staticFile(bed.file)} volume={finalVolume} loop={bed.loop} />;
};

export const MusicTrack: React.FC<{
  musicBeds: CompiledMusicBed[];
  voiceTracks: CompiledVoiceTrack[];
  masterVolume: number;
}> = ({ musicBeds, voiceTracks, masterVolume }) => {
  return (
    <>
      {musicBeds.map((bed) => (
        <Sequence
          key={bed.trackId}
          from={bed.startFrame}
          durationInFrames={bed.durationFrames}
        >
          <MusicBedPlayer
            bed={bed}
            voiceTracks={voiceTracks}
            masterVolume={masterVolume}
          />
        </Sequence>
      ))}
    </>
  );
};
