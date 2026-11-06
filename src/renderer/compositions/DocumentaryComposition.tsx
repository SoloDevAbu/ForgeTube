import React from "react";
import { Sequence, AbsoluteFill } from "remotion";
import type { RenderManifest } from "../../core/schemas/renderManifest.js";
import { SceneRenderer } from "../scenes/SceneRenderer";
import { NarrationTrack } from "../audio/NarrationTrack";
import { SoundEffectsTrack } from "../audio/SoundEffectsTrack";
import { MusicTrack } from "../audio/MusicTrack";

export const DocumentaryComposition: React.FC<RenderManifest> = (manifest) => {
  const { scenes, audio } = manifest;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {/* Visual Scenes Layer */}
      {scenes.map((scene) => (
        <Sequence
          key={scene.sceneId}
          from={scene.startFrame}
          durationInFrames={scene.durationFrames}
          name={scene.title}
        >
          <SceneRenderer scene={scene} />
        </Sequence>
      ))}

      {/* Global Audio Tracks Layer */}
      {audio.voiceTracks && audio.voiceTracks.length > 0 && (
        <NarrationTrack tracks={audio.voiceTracks} masterVolume={audio.masterVolume} />
      )}
      {audio.soundEffects && audio.soundEffects.length > 0 && (
        <SoundEffectsTrack effects={audio.soundEffects} masterVolume={audio.masterVolume} />
      )}
      {audio.musicBeds && audio.musicBeds.length > 0 && (
        <MusicTrack
          musicBeds={audio.musicBeds}
          voiceTracks={audio.voiceTracks || []}
          masterVolume={audio.masterVolume}
        />
      )}
    </AbsoluteFill>
  );
};
