import React from "react";
import { Sequence, Audio, staticFile, useCurrentFrame } from "remotion";
import type { CompiledVoiceTrack } from "../../core/schemas/renderManifest.js";
import { calculateFadeVolume } from "./volumeEnvelope";

const VoiceAudioPlayer: React.FC<{ track: CompiledVoiceTrack; masterVolume: number }> = ({
  track,
  masterVolume,
}) => {
  const frame = useCurrentFrame();
  const volume =
    calculateFadeVolume(
      frame,
      track.durationFrames,
      track.fadeInFrames,
      track.fadeOutFrames,
      track.volume
    ) * masterVolume;

  return <Audio src={staticFile(track.file)} volume={volume} />;
};

export const NarrationTrack: React.FC<{
  tracks: CompiledVoiceTrack[];
  masterVolume: number;
}> = ({ tracks, masterVolume }) => {
  return (
    <>
      {tracks.map((track) => (
        <Sequence
          key={track.eventId}
          from={track.startFrame}
          durationInFrames={track.durationFrames}
        >
          <VoiceAudioPlayer track={track} masterVolume={masterVolume} />
        </Sequence>
      ))}
    </>
  );
};
