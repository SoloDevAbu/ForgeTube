import { z } from "zod";

export const VolumeKeyframeSchema = z.object({
  timeSeconds: z.number().nonnegative(),
  volume: z.number().min(0).max(1),
});
export type VolumeKeyframe = z.infer<typeof VolumeKeyframeSchema>;

export const MusicBedSchema = z.object({
  trackId: z.string().min(1),
  file: z.string().min(1), // relative path
  startSeconds: z.number().nonnegative().default(0),
  endSeconds: z.number().positive().nullable().default(null),
  volume: z.number().min(0).max(1).default(0.2),
  fadeInSeconds: z.number().nonnegative().default(1.5),
  fadeOutSeconds: z.number().nonnegative().default(2.0),
  loop: z.boolean().default(true),
  ducking: z.object({
    enabled: z.boolean().default(true),
    duckedVolume: z.number().min(0).max(1).default(0.08),
    duckFadeSeconds: z.number().nonnegative().default(0.5),
  }).default({}),
  volumeEnvelope: z.array(VolumeKeyframeSchema).default([]),
});
export type MusicBed = z.infer<typeof MusicBedSchema>;

export const SoundEffectTrackEventSchema = z.object({
  eventId: z.string().min(1),
  sceneId: z.string().nullable().default(null),
  file: z.string().min(1), // relative path
  startSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive().nullable().default(null),
  volume: z.number().min(0).max(1).default(0.5),
  fadeInSeconds: z.number().nonnegative().default(0.2),
  fadeOutSeconds: z.number().nonnegative().default(0.3),
  loop: z.boolean().default(false),
});
export type SoundEffectTrackEvent = z.infer<typeof SoundEffectTrackEventSchema>;

export const VoiceTrackEventSchema = z.object({
  eventId: z.string().min(1),
  sceneId: z.string().min(1),
  file: z.string().min(1), // relative path
  startSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  volume: z.number().min(0).max(1).default(1.0),
  fadeInSeconds: z.number().nonnegative().default(0.05),
  fadeOutSeconds: z.number().nonnegative().default(0.05),
});
export type VoiceTrackEvent = z.infer<typeof VoiceTrackEventSchema>;

export const AudioMixManifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  masterVolume: z.number().min(0).max(1).default(1.0),
  voiceTracks: z.array(VoiceTrackEventSchema).default([]),
  soundEffects: z.array(SoundEffectTrackEventSchema).default([]),
  musicBeds: z.array(MusicBedSchema).default([]),
  updatedAt: z.string(),
});
export type AudioMixManifest = z.infer<typeof AudioMixManifestSchema>;

