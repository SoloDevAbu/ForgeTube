import { z } from "zod";

export const SourceTypeSchema = z.enum([
  "academic_book_or_article",
  "museum_or_archive",
  "scholarly_publisher",
  "primary_source",
  "reference_work",
  "other",
]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const SourceSchema = z.object({
  source_id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  author: z.string().nullable().default(null),
  url: z.string().url(),
  source_type: SourceTypeSchema.default("academic_book_or_article"),
  published_at: z.string().nullable().default(null),
  accessed_at: z.string(),
  /** True only when the page or document was actually read for this project. */
  opened: z.boolean().default(false),
  notes: z.string().default(""),
});
export type Source = z.infer<typeof SourceSchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low", "contested", "unknown"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ClaimStatusSchema = z.enum(["verified", "unverified"]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const ClaimKindSchema = z.enum(["fact", "tradition", "estimate", "debated"]);
export type ClaimKind = z.infer<typeof ClaimKindSchema>;

export const ClaimSchema = z.object({
  claim_id: z.string().min(1),
  claim: z.string().min(1),
  kind: ClaimKindSchema.default("fact"),
  time_period: z.string().min(1),
  confidence: ConfidenceSchema.default("high"),
  evidence_source_ids: z.array(z.string()).min(1),
  caveat: z.string().nullable().default(null),
  status: ClaimStatusSchema.default("verified"),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const DateTypeSchema = z.enum(["exact", "approximate", "disputed"]);
export type DateType = z.infer<typeof DateTypeSchema>;

export const ChronologyEventSchema = z.object({
  event_id: z.string().min(1),
  date: z.string().min(1),
  date_type: DateTypeSchema.default("exact"),
  description: z.string().min(1),
  relevant_people: z.array(z.string()).default([]),
  relevant_locations: z.array(z.string()).default([]),
  supporting_claim_ids: z.array(z.string()).default([]),
  source_ids: z.array(z.string()).default([]),
  importance: z.enum(["core", "supporting", "context"]).default("core"),
});
export type ChronologyEvent = z.infer<typeof ChronologyEventSchema>;

export const ChapterOutlineSchema = z.object({
  chapter_id: z.string().min(1),
  chapter_number: z.number().int().positive(),
  title: z.string().min(1),
  time_period: z.string().min(1),
  summary: z.string().min(1),
  estimated_duration_seconds: z.number().positive(),
  claim_ids: z.array(z.string()).default([]),
});
export type ChapterOutline = z.infer<typeof ChapterOutlineSchema>;

export const ResearchDossierSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  topic: z.string().min(1),
  scope_statement: z.string().min(1),
  sources: z.array(SourceSchema).default([]),
  claims: z.array(ClaimSchema).default([]),
  chronology: z.array(ChronologyEventSchema).default([]),
  chapters: z.array(ChapterOutlineSchema).default([]),
  disagreements_and_debates: z.array(z.string()).default([]),
  status: z.enum(["draft", "approved"]).default("draft"),
  updatedAt: z.string(),
});
export type ResearchDossier = z.infer<typeof ResearchDossierSchema>;

