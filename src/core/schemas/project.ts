import { z } from "zod";
import { ProjectStateValues, CameraEffectValues, TransitionTypeValues } from "../../shared/types.js";

export const VoiceSettingsSchema = z.object({
  provider: z.enum(["edge", "kokoro"]).default("edge"),
  voice: z.string().default("en-US-AndrewMultilingualNeural"),
  /** Natural 1.0x documentary narration. */
  rate: z.string().default("+0%"),
  pitch: z.string().default("+0Hz"),
});
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;

export const MixSettingsSchema = z.object({
  voiceLufs: z.number().default(-16),
  /** Bed level before ducking. Far under the voice: felt, not listened to. */
  musicLufs: z.number().default(-34),
  /** Effects sit under the narration too. They colour a beat, they never hit. */
  sfxGainDb: z.number().default(-20),
  finalLufs: z.number().default(-14),
  truePeakDb: z.number().default(-1.5),
  crossfadeSeconds: z.number().nonnegative().default(3),
  duckRatio: z.number().min(1).default(2),
});
export type MixSettings = z.infer<typeof MixSettingsSchema>;

export const ProjectSettingsSchema = z.object({
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  fps: z.number().int().positive().default(30),
  defaultTransition: z.enum(TransitionTypeValues).default("cut"),
  defaultTransitionDurationSeconds: z.number().positive().default(0.25),
  defaultCameraEffect: z.enum(CameraEffectValues).default("slow_zoom_in"),
  draftScale: z.number().positive().max(1).default(0.5), // 960x540 for draft
  speakingRateWpm: z.number().int().positive().default(130),
  renderConcurrency: z.number().int().positive().default(4),
  maxShotSeconds: z.number().positive().default(5),
  minShotSeconds: z.number().positive().default(0.75),
  sentenceGapSeconds: z.number().nonnegative().default(0.25),
  segmentGapSeconds: z.number().nonnegative().default(0.6),
  chapterGapSeconds: z.number().nonnegative().default(2),
  voice: VoiceSettingsSchema.prefault({}),
  mix: MixSettingsSchema.prefault({}),
});

export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const ProjectCheckpointsSchema = z.object({
  researchApproved: z.boolean().default(false),
  scriptApproved: z.boolean().default(false),
  storyboardApproved: z.boolean().default(false),
  promptsExported: z.boolean().default(false),
  assetsImported: z.boolean().default(false),
  calibrationApproved: z.boolean().default(false),
  audioApproved: z.boolean().default(false),
  timelineCompiled: z.boolean().default(false),
});

export type ProjectCheckpoints = z.infer<typeof ProjectCheckpointsSchema>;

export const ProjectManifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  name: z.string().min(1),
  topic: z.string().min(1),
  targetMinutes: z.number().positive().default(12),
  /** Narration language. Image prompts stay in English. */
  language: z.string().default("en"),
  status: z.enum(ProjectStateValues).default("NEW"),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: ProjectSettingsSchema.prefault({}),
  checkpoints: ProjectCheckpointsSchema.prefault({}),
});

export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

