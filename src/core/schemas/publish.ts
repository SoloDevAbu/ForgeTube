import { z } from "zod";

export const ThumbnailLayoutValues = ["left", "right", "bottom", "center"] as const;
export type ThumbnailLayout = (typeof ThumbnailLayoutValues)[number];

export const ThumbnailLookValues = ["dark", "warm", "cold", "none"] as const;
export type ThumbnailLook = (typeof ThumbnailLookValues)[number];

export const ThumbnailVariantSchema = z.object({
  /** "A", "B" or "C". */
  id: z.string().min(1),
  /** Scene whose image and crop are used, or null for an image file. */
  sceneId: z.string().nullable().default(null),
  /** Image path inside the project. */
  image: z.string().min(1),
  /** Text as written, with "/" line breaks and "*accent*" marks. Empty for no text. */
  text: z.string().default(""),
  layout: z.enum(ThumbnailLayoutValues).default("left"),
  accent: z.string().default("#FFD400"),
  look: z.enum(ThumbnailLookValues).default("dark"),
  /** Where the subject is in the image, 0 to 1. */
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable().default(null),
  zoom: z.number().min(1).max(3).default(1),
});
export type ThumbnailVariant = z.infer<typeof ThumbnailVariantSchema>;

export const PublishMetadataSchema = z.object({
  titles: z.array(z.string().min(1)),
  /** The written part. Chapters, sources and hashtags are added by the CLI. */
  description: z.string().min(1),
  hashtags: z.array(z.string().min(1)),
  tags: z.array(z.string().min(1)),
});
export type PublishMetadata = z.infer<typeof PublishMetadataSchema>;

export const PublishManifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  metadata: PublishMetadataSchema.nullable().default(null),
  thumbnails: z.array(ThumbnailVariantSchema).default([]),
  updatedAt: z.string(),
});
export type PublishManifest = z.infer<typeof PublishManifestSchema>;

/** One run of text in a thumbnail line. */
export interface ThumbnailRun {
  text: string;
  accent: boolean;
}

/** Everything the thumbnail composition needs, already resolved. */
export interface ThumbnailRenderVariant {
  /** Path under the bundle's public folder. */
  src: string;
  crop: { x: number; y: number; width: number; height: number } | null;
  scale: number;
  /** Shift of the scaled image, as a fraction of the frame. */
  translate: { x: number; y: number };
  look: ThumbnailLook;
  layout: ThumbnailLayout;
  lines: ThumbnailRun[][];
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  fontWeight: number;
  uppercase: boolean;
  accent: string;
}

export type ThumbnailRenderProps = {
  width: number;
  height: number;
  variants: ThumbnailRenderVariant[];
}
