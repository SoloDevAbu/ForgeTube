import { z } from "zod";
import { FitModeValues } from "../../shared/types.js";
import { NormalizedCropSchema } from "./storyboard.js";

export const SceneCalibrationSchema = z.object({
  sceneId: z.string().min(1),
  sourceImage: z.string().min(1), // relative path, e.g. "assets/generated/scene_001.png"
  fit: z.enum(FitModeValues).default("cover"),
  crop: NormalizedCropSchema.nullable().default(null),
  position: z.object({
    x: z.number().min(0).max(1).default(0.5),
    y: z.number().min(0).max(1).default(0.5),
  }).default({ x: 0.5, y: 0.5 }),
  scale: z.number().min(0.1).max(5).default(1.0),
  previewStillPath: z.string().nullable().default(null),
  status: z.enum(["default", "calibrated", "approved"]).default("default"),
  updatedAt: z.string(),
});
export type SceneCalibration = z.infer<typeof SceneCalibrationSchema>;

export const CalibrationManifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  scenes: z.record(z.string(), SceneCalibrationSchema).default({}),
  updatedAt: z.string(),
});
export type CalibrationManifest = z.infer<typeof CalibrationManifestSchema>;

