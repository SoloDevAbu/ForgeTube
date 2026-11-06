import { z } from "zod";
import { CameraEffectValues, TransitionTypeValues, FitModeValues } from "../../shared/types.js";

export const NormalizedCropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.01).max(1),
  height: z.number().min(0.01).max(1),
});
export type NormalizedCrop = z.infer<typeof NormalizedCropSchema>;

export const SceneTimelineSchema = z.object({
  startFrame: z.number().int().nonnegative().nullable().default(null),
  endFrame: z.number().int().nonnegative().nullable().default(null),
  durationFrames: z.number().int().positive().nullable().default(null),
  fps: z.number().int().positive().default(30),
});
export type SceneTimeline = z.infer<typeof SceneTimelineSchema>;

export const SceneVisualSchema = z.object({
  type: z.literal("image").default("image"),
  image: z.string().min(1),
  fit: z.enum(FitModeValues).default("cover"),
  crop: NormalizedCropSchema.nullable().default(null),
  /** Where the 16:9 window sits in the leftover image, 0 to 1 on each axis. */
  position: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).default({ x: 0.5, y: 0.5 }),
  /** Extra zoom into the image, used to crop away watermarks. */
  zoom: z.number().min(1).max(3).default(1),
});
export type SceneVisual = z.infer<typeof SceneVisualSchema>;

export const SceneCameraSchema = z.object({
  effect: z.enum(CameraEffectValues).default("slow_zoom_in"),
  /** Null means automatic: sized to the shot length so short shots don't lurch. */
  intensity: z.number().min(0).max(0.5).nullable().default(null),
  origin: z.enum([
    "center",
    "top",
    "bottom",
    "left",
    "right",
    "top_left",
    "top_right",
    "bottom_left",
    "bottom_right",
  ]).default("center"),
  direction: z.string().nullable().default(null),
});
export type SceneCamera = z.infer<typeof SceneCameraSchema>;

export const SceneTransitionSchema = z.object({
  type: z.enum(TransitionTypeValues).default("cut"),
  durationSeconds: z.number().nonnegative().default(0.25),
});
export type SceneTransition = z.infer<typeof SceneTransitionSchema>;

export const SoundEffectEventSchema = z.object({
  sfxId: z.string().default(() => "sfx_" + Math.random().toString(36).slice(2, 8)),
  file: z.string().min(1),
  offsetSeconds: z.number().nonnegative().default(0),
  durationSeconds: z.number().positive().nullable().default(null),
  volume: z.number().min(0).max(1).default(0.5),
  fadeInSeconds: z.number().nonnegative().default(0.2),
  fadeOutSeconds: z.number().nonnegative().default(0.3),
  loop: z.boolean().default(false),
});
export type SoundEffectEvent = z.infer<typeof SoundEffectEventSchema>;

export const SceneAudioSchema = z.object({
  voice: z.string().nullable().default(null),
  soundEffects: z.array(SoundEffectEventSchema).default([]),
});
export type SceneAudio = z.infer<typeof SceneAudioSchema>;

export const SceneStatusSchema = z.object({
  image: z.enum(["missing", "imported", "verified"]).default("missing"),
  calibration: z.enum(["not_started", "reviewed", "calibrated", "approved"]).default("not_started"),
  audio: z.enum(["missing", "ready"]).default("missing"),
  review: z.enum(["needs_review", "approved"]).default("needs_review"),
});
export type SceneStatus = z.infer<typeof SceneStatusSchema>;

export const SceneRecordSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  sceneId: z.string().min(1),
  sceneNumber: z.number().int().positive(),
  chapterId: z.string().min(1),
  title: z.string().min(1),
  narrationSegmentIds: z.array(z.string()).default([]),
  narration: z.string().default(""),
  /** Word span inside the narration segment. wordEnd is exclusive. */
  wordStart: z.number().int().nonnegative().nullable().default(null),
  wordEnd: z.number().int().positive().nullable().default(null),
  /** Author marked this shot as deliberately under the minimum length. */
  allowShort: z.boolean().default(false),
  shortPrompt: z.string().default(""),
  batchId: z.string().default(""),
  sfxSuggestions: z.array(z.string()).default([]),
  musicMood: z.string().default(""),
  visualPurpose: z.string().min(1),
  suggestedDurationSeconds: z.number().positive(),
  actualVoiceDurationFrames: z.number().int().positive().nullable().default(null),
  timeline: SceneTimelineSchema.prefault({}),
  visual: SceneVisualSchema,
  camera: SceneCameraSchema.prefault({}),
  transition: SceneTransitionSchema.prefault({}),
  audio: SceneAudioSchema.prefault({}),
  imagePromptId: z.string().min(1),
  sourceClaimIds: z.array(z.string()).default([]),
  status: SceneStatusSchema.prefault({}),
});
export type SceneRecord = z.infer<typeof SceneRecordSchema>;

export const VisualStyleGuideSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  artisticDirection: z.string().min(1),
  clothingAndArmor: z.string().min(1),
  architectureAndEnvironment: z.string().min(1),
  colorPaletteAndLighting: z.string().min(1),
  cameraAndComposition: z.string().min(1),
  negativePromptRules: z.array(z.string()).default([]),
  continuityRules: z.array(z.string()).default([]),
  characters: z.record(z.string(), z.string()).default({}),
  locations: z.record(z.string(), z.string()).default({}),
});
export type VisualStyleGuide = z.infer<typeof VisualStyleGuideSchema>;

export const ImagePromptSchema = z.object({
  promptId: z.string().min(1),
  sceneId: z.string().min(1),
  outputFilename: z.string().min(1),
  aspectRatio: z.literal("16:9").default("16:9"),
  prompt: z.string().min(1),
  negativePrompt: z.string().default(""),
  referenceAssets: z.array(z.string()).default([]),
  continuityNotes: z.string().default(""),
  status: z.enum(["ready_for_manual_generation", "generated", "imported"]).default("ready_for_manual_generation"),
});
export type ImagePrompt = z.infer<typeof ImagePromptSchema>;

export const StoryboardManifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  scenes: z.array(SceneRecordSchema),
  visualStyleGuide: VisualStyleGuideSchema,
  prompts: z.array(ImagePromptSchema),
  status: z.enum(["draft", "approved"]).default("draft"),
  chapterMoods: z.record(z.string(), z.string()).default({}),
  updatedAt: z.string(),
});
export type StoryboardManifest = z.infer<typeof StoryboardManifestSchema>;

