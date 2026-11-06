import { z } from "zod";
import { ProjectStateValues, CameraEffectValues, TransitionTypeValues } from "../../shared/types.js";

export const ProjectSettingsSchema = z.object({
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  fps: z.number().int().positive().default(30),
  defaultTransition: z.enum(TransitionTypeValues).default("cross_dissolve"),
  defaultTransitionDurationSeconds: z.number().positive().default(0.5),
  defaultCameraEffect: z.enum(CameraEffectValues).default("slow_zoom_in"),
  draftScale: z.number().positive().max(1).default(0.5), // 960x540 for draft
  speakingRateWpm: z.number().int().positive().default(140),
  renderConcurrency: z.number().int().positive().default(1),
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
  status: z.enum(ProjectStateValues).default("NEW"),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: ProjectSettingsSchema.default({}),
  checkpoints: ProjectCheckpointsSchema.default({}),
});

export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

