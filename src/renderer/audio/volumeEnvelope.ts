import { interpolate } from "remotion";
import type { CompiledVoiceTrack, CompiledMusicBed } from "../../core/schemas/renderManifest";

/**
 * Computes volume multiplier for a track at a specific local frame given fade-in and fade-out frames.
 */
export function calculateFadeVolume(
  localFrame: number,
  durationFrames: number,
  fadeInFrames: number,
  fadeOutFrames: number,
  baseVolume: number
): number {
  let vol = baseVolume;

  if (fadeInFrames > 0 && localFrame < fadeInFrames) {
    vol = interpolate(localFrame, [0, fadeInFrames], [0, baseVolume], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }

  if (fadeOutFrames > 0 && localFrame > durationFrames - fadeOutFrames) {
    vol = interpolate(
      localFrame,
      [durationFrames - fadeOutFrames, durationFrames],
      [vol, 0],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }
    );
  }

  return Math.max(0, Math.min(1, vol));
}

/**
 * Computes ducked music volume at a global composition frame.
 */
export function calculateMusicDucking(
  globalFrame: number,
  musicBed: CompiledMusicBed,
  voiceTracks: CompiledVoiceTrack[]
): number {
  if (!musicBed.ducking.enabled || voiceTracks.length === 0) {
    return 1.0;
  }

  const duckFadeFrames = musicBed.ducking.duckFadeFrames;
  let isDucked = false;
  let minDistanceToVoice = Infinity;

  for (const vt of voiceTracks) {
    const start = vt.startFrame;
    const end = vt.startFrame + vt.durationFrames;

    if (globalFrame >= start && globalFrame <= end) {
      isDucked = true;
      break;
    }

    if (globalFrame < start) {
      const dist = start - globalFrame;
      if (dist < minDistanceToVoice) minDistanceToVoice = dist;
    } else if (globalFrame > end) {
      const dist = globalFrame - end;
      if (dist < minDistanceToVoice) minDistanceToVoice = dist;
    }
  }

  if (isDucked) {
    return musicBed.ducking.duckedVolume / musicBed.volume;
  }

  if (minDistanceToVoice < duckFadeFrames) {
    const duckRatio = musicBed.ducking.duckedVolume / musicBed.volume;
    return interpolate(minDistanceToVoice, [0, duckFadeFrames], [duckRatio, 1.0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }

  return 1.0;
}
