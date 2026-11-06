import { z } from "zod";
import { CameraEffectValues, TransitionTypeValues, FitModeValues } from "../../shared/types.js";
import { NormalizedCropSchema } from "./storyboard.js";

export const CompiledSceneCameraSchema = z.object({
  effect: z.enum(CameraEffectValues),
  intensity: z.number().min(0).max(0.5),
  origin: z.string(),
});
export type CompiledSceneCamera = z.infer<typeof CompiledSceneCameraSchema>;

export const CompiledSceneTransitionSchema = z.object({
  type: z.enum(TransitionTypeValues),
  durationFrames: z.number().int().nonnegative(),
  overlapFrames: z.number().int().nonnegative(),
  /** Frames at the end of this scene that fade out, before a fade transition. */
  fadeOutFrames: z.number().int().nonnegative().default(0),
  fadeOutColor: z.string().default("#000000"),
});
export type CompiledSceneTransition = z.infer<typeof CompiledSceneTransitionSchema>;

export const CompiledSceneSchema = z.object({
  sceneId: z.string().min(1),
  sceneNumber: z.number().int().positive(),
  chapterId: z.string().default("chapter_01"),
  title: z.string(),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  durationFrames: z.number().int().positive(),
  imagePath: z.string().min(1), // relative path
  fit: z.enum(FitModeValues).default("cover"),
  crop: NormalizedCropSchema.nullable().default(null),
  camera: CompiledSceneCameraSchema,
  transition: CompiledSceneTransitionSchema,
});
export type CompiledScene = z.infer<typeof CompiledSceneSchema>;

export const CompiledVoiceTrackSchema = z.object({
  eventId: z.string().min(1),
  segmentId: z.string().min(1),
  file: z.string().min(1), // relative path
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
  volume: z.number().min(0).max(1),
  fadeInFrames: z.number().int().nonnegative(),
  fadeOutFrames: z.number().int().nonnegative(),
});
export type CompiledVoiceTrack = z.infer<typeof CompiledVoiceTrackSchema>;

export const CompiledSoundEffectSchema = z.object({
  eventId: z.string().min(1),
  file: z.string().min(1), // relative path
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
  volume: z.number().min(0).max(1),
  fadeInFrames: z.number().int().nonnegative(),
  fadeOutFrames: z.number().int().nonnegative(),
  loop: z.boolean().default(false),
});
export type CompiledSoundEffect = z.infer<typeof CompiledSoundEffectSchema>;

export const CompiledMusicBedSchema = z.object({
  trackId: z.string().min(1),
  file: z.string().min(1), // relative path
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  durationFrames: z.number().int().positive(),
  volume: z.number().min(0).max(1),
  fadeInFrames: z.number().int().nonnegative(),
  fadeOutFrames: z.number().int().nonnegative(),
  loop: z.boolean().default(true),
  ducking: z.object({
    enabled: z.boolean().default(true),
    duckedVolume: z.number().min(0).max(1).default(0.08),
    duckFadeFrames: z.number().int().nonnegative().default(15),
  }),
});
export type CompiledMusicBed = z.infer<typeof CompiledMusicBedSchema>;

export const CompiledChapterSchema = z.object({
  chapterId: z.string().min(1),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
});
export type CompiledChapter = z.infer<typeof CompiledChapterSchema>;

export const CompiledAudioManifestSchema = z.object({
  masterVolume: z.number().min(0).max(1).default(1.0),
  voiceTracks: z.array(CompiledVoiceTrackSchema).default([]),
  soundEffects: z.array(CompiledSoundEffectSchema).default([]),
  musicBeds: z.array(CompiledMusicBedSchema).default([]),
});
export type CompiledAudioManifest = z.infer<typeof CompiledAudioManifestSchema>;

export const RenderManifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  totalDurationFrames: z.number().int().positive(),
  totalDurationSeconds: z.number().positive(),
  scenes: z.array(CompiledSceneSchema),
  chapters: z.array(CompiledChapterSchema).default([]),
  audio: CompiledAudioManifestSchema,
  metadata: z.object({
    compiledAt: z.string(),
    /** True when any narration timing came from a word-count estimate. */
    usesEstimatedTiming: z.boolean().default(false),
  }),
});
export type RenderManifest = z.infer<typeof RenderManifestSchema>;

