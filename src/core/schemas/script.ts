import { z } from "zod";

export const NarrationSegmentSchema = z.object({
  segment_id: z.string().min(1),
  chapter_id: z.string().min(1),
  segment_number: z.number().int().positive(),
  text: z.string().min(1),
  source_claim_ids: z.array(z.string()).min(1),
  estimated_duration_seconds: z.number().positive(),
  voice_asset: z.string().nullable().default(null),
});
export type NarrationSegment = z.infer<typeof NarrationSegmentSchema>;

export const ScriptChapterSchema = z.object({
  chapter_id: z.string().min(1),
  chapter_number: z.number().int().positive(),
  title: z.string().min(1),
  time_period: z.string().min(1),
  segments: z.array(NarrationSegmentSchema),
});
export type ScriptChapter = z.infer<typeof ScriptChapterSchema>;

export const ScriptManifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  totalWordCount: z.number().int().nonnegative(),
  estimatedTotalDurationSeconds: z.number().nonnegative(),
  targetMinutes: z.number().positive(),
  chapters: z.array(ScriptChapterSchema),
  status: z.enum(["draft", "approved"]).default("draft"),
  updatedAt: z.string(),
});
export type ScriptManifest = z.infer<typeof ScriptManifestSchema>;

