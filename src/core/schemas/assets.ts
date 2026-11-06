import { z } from "zod";

export const AssetTypeSchema = z.enum([
  "image",
  "voice",
  "sound_effect",
  "music",
  "reference",
  "thumbnail",
]);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const AssetRecordSchema = z.object({
  assetId: z.string().min(1),
  relativePath: z.string().min(1),
  assetType: AssetTypeSchema,
  originalFilename: z.string().min(1),
  importedFilename: z.string().min(1),
  format: z.string().default("unknown"),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  durationSeconds: z.number().positive().nullable().default(null),
  fileSizeBytes: z.number().int().nonnegative().default(0),
  checksum: z.string().nullable().default(null),
  importedAt: z.string(),
  sceneAssociations: z.array(z.string()).default([]),
  status: z.enum(["valid", "invalid", "missing", "unused"]).default("valid"),
  validationError: z.string().nullable().default(null),
});
export type AssetRecord = z.infer<typeof AssetRecordSchema>;

export const AssetManifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  assets: z.array(AssetRecordSchema).default([]),
  updatedAt: z.string(),
});
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

