import {
  ThumbnailLayoutValues,
  ThumbnailLookValues,
  type ThumbnailLayout,
  type ThumbnailLook,
  type ThumbnailRun,
} from "../schemas/publish.js";

export const THUMBNAIL_WIDTH = 1280;
export const THUMBNAIL_HEIGHT = 720;
export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
export const VARIANT_IDS = ["A", "B", "C"] as const;
export const TEXT_MAX_WORDS = 5;

/** Colours that hold against a dark image at phone size. */
export const ACCENTS: Record<string, string> = {
  yellow: "#FFD400",
  red: "#FF2D2D",
  orange: "#FF8A00",
  white: "#FFFFFF",
  cyan: "#3DE0FF",
  green: "#5CFF5C",
  gold: "#F2B632",
};

export interface ParsedVariant {
  id: string;
  sceneId: string | null;
  file: string | null;
  text: string;
  layout: ThumbnailLayout;
  accent: string;
  look: ThumbnailLook;
  focus: { x: number; y: number } | null;
  zoom: number | null;
}

export interface ThumbnailParse {
  variants: ParsedVariant[];
  errors: string[];
  warnings: string[];
}

/** Words of the text, without line-break and accent marks. */
export function textWords(text: string): string[] {
  return text.replace(/[*/]/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * Parses the thumbnail plan, one variant per line:
 *
 *   A | img=scene_012 | THE *LAST* EMPEROR | layout=left | accent=yellow | focus=0.7,0.4 | zoom=1.3
 *   C | file=C:\images\statue.png | - | layout=center
 */
export function parseThumbnailPlan(input: string): ThumbnailParse {
  const variants: ParsedVariant[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const raw of input.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const id = (cells[0] ?? "").toUpperCase();
    const label = `Variant ${id || "?"}`;
    if (!(VARIANT_IDS as readonly string[]).includes(id)) {
      errors.push(`"${line.slice(0, 40)}": a line starts with A, B or C.`);
      continue;
    }
    if (variants.some((v) => v.id === id)) {
      errors.push(`${label} is written twice.`);
      continue;
    }

    const image = cells[1] ?? "";
    const variant: ParsedVariant = {
      id,
      sceneId: image.startsWith("img=") ? image.slice(4).trim() : null,
      file: image.startsWith("file=") ? image.slice(5).trim() : null,
      text: cells[2] === "-" ? "" : (cells[2] ?? ""),
      layout: "left",
      accent: ACCENTS.yellow!,
      look: "dark",
      focus: null,
      zoom: null,
    };
    if (!variant.sceneId && !variant.file) errors.push(`${label}: the second cell is img=<scene> or file=<path>.`);

    for (const option of cells.slice(3).filter(Boolean)) {
      const [key, value = ""] = option.split("=").map((s) => s.trim());
      if (key === "layout" && (ThumbnailLayoutValues as readonly string[]).includes(value)) {
        variant.layout = value as ThumbnailLayout;
      } else if (key === "look" && (ThumbnailLookValues as readonly string[]).includes(value)) {
        variant.look = value as ThumbnailLook;
      } else if (key === "accent" && (ACCENTS[value.toLowerCase()] || /^#[0-9a-f]{6}$/i.test(value))) {
        variant.accent = ACCENTS[value.toLowerCase()] ?? value;
      } else if (key === "focus" && /^[\d.]+\s*,\s*[\d.]+$/.test(value)) {
        const [x, y] = value.split(",").map(Number) as [number, number];
        if (x > 1 || y > 1) errors.push(`${label}: focus is two numbers from 0 to 1.`);
        else variant.focus = { x, y };
      } else if (key === "zoom" && Number(value) >= 1 && Number(value) <= 3) {
        variant.zoom = Number(value);
      } else {
        errors.push(`${label}: "${option}" is not a known option.`);
      }
    }

    const words = textWords(variant.text);
    if (words.length > TEXT_MAX_WORDS) {
      errors.push(`${label}: ${words.length} words of text. Use ${TEXT_MAX_WORDS} at most, better 2 to 4.`);
    }
    if ((variant.text.match(/\*/g) ?? []).length % 2 === 1) errors.push(`${label}: an accent mark "*" is not closed.`);
    if (variant.layout === "bottom" && words.length > 4) {
      warnings.push(`${label}: long text on a bottom layout gets small. Use 4 words at most.`);
    }
    variants.push(variant);
  }

  for (const id of VARIANT_IDS) {
    if (!variants.some((v) => v.id === id)) errors.push(`Variant ${id} is missing. Write three: A, B and C.`);
  }
  for (const [i, a] of variants.entries()) {
    for (const b of variants.slice(i + 1)) {
      const sameImage = a.sceneId === b.sceneId && a.file === b.file;
      if (sameImage && a.text === b.text && a.layout === b.layout) {
        errors.push(`Variants ${a.id} and ${b.id} are the same. Each one tests a different idea.`);
      }
    }
  }
  const images = new Set(variants.map((v) => v.sceneId ?? v.file));
  const texts = new Set(variants.map((v) => textWords(v.text).join(" ").toLowerCase()));
  if (variants.length === 3 && images.size === 1 && texts.size === 1) {
    warnings.push("All three share one image and one text. A test between them will show little.");
  }

  variants.sort((a, b) => a.id.localeCompare(b.id));
  return { variants, errors, warnings };
}

interface TextBox {
  width: number;
  height: number;
  maxLines: number;
}

/** Room for text in each layout, in pixels of the 1280x720 frame. */
const BOXES: Record<ThumbnailLayout, TextBox> = {
  left: { width: 600, height: 600, maxLines: 3 },
  right: { width: 600, height: 600, maxLines: 3 },
  // Stops short of the bottom-right corner, where YouTube draws the duration.
  bottom: { width: 940, height: 280, maxLines: 2 },
  center: { width: 1120, height: 440, maxLines: 2 },
};

export interface TextStyle {
  fontFamily: string;
  fontWeight: number;
  uppercase: boolean;
  /** Average glyph width as a fraction of the font size. */
  glyphWidth: number;
  lineHeight: number;
}

/** Heavy system faces: a condensed one for Latin, Nirmala for Devanagari. */
export function textStyleFor(text: string): TextStyle {
  if (/[\u0900-\u097F]/.test(text)) {
    return {
      fontFamily: '"Nirmala UI", "Mangal", "Noto Sans Devanagari", sans-serif',
      fontWeight: 700,
      uppercase: false,
      glyphWidth: 0.62,
      lineHeight: 1.3,
    };
  }
  return {
    fontFamily: 'Impact, "Haettenschweiler", "Arial Narrow", "Arial Black", sans-serif',
    fontWeight: 400,
    uppercase: true,
    glyphWidth: 0.52,
    lineHeight: 1.04,
  };
}

const MAX_FONT = 230;

function glyphCount(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length;
}

function partitions<T>(items: T[], maxParts: number): T[][][] {
  if (items.length === 0) return [[]];
  const out: T[][][] = [];
  for (let take = 1; take <= items.length; take++) {
    if (maxParts === 1 && take < items.length) continue;
    for (const rest of partitions(items.slice(take), maxParts - 1)) {
      if (rest.length > 0 || take === items.length) out.push([items.slice(0, take), ...rest]);
    }
  }
  return out;
}

export interface TextLayout {
  lines: ThumbnailRun[][];
  fontSize: number;
}

/**
 * Breaks the text into the lines that let it be largest in its layout's box.
 * "/" in the text fixes the breaks. "*word*" marks the accent colour.
 */
export function layoutText(text: string, layout: ThumbnailLayout, style: TextStyle): TextLayout {
  const words: ThumbnailRun[] = [];
  const breaks = new Set<number>();
  let accent = false;
  for (const token of text.split(/\s+/).filter(Boolean)) {
    for (const piece of token.split(/(\/)/).filter(Boolean)) {
      if (piece === "/") {
        breaks.add(words.length);
        continue;
      }
      const opens = piece.startsWith("*");
      const closes = piece.endsWith("*") && piece.length > 1;
      const word = piece.replace(/\*/g, "");
      if (opens) accent = true;
      if (word) words.push({ text: word, accent });
      if (closes) accent = false;
    }
  }
  if (words.length === 0) return { lines: [], fontSize: 0 };

  const box = BOXES[layout];
  const explicit = breaks.size > 0;
  const candidates = explicit
    ? [
        words.reduce<ThumbnailRun[][]>((lines, word, i) => {
          if (i === 0 || breaks.has(i)) lines.push([]);
          lines.at(-1)!.push(word);
          return lines;
        }, []),
      ]
    : partitions(words, box.maxLines);

  let best: TextLayout = { lines: [], fontSize: 0 };
  for (const lines of candidates) {
    const longest = Math.max(...lines.map((l) => glyphCount(l.map((w) => w.text).join(" "))));
    const fontSize = Math.floor(
      Math.min(MAX_FONT, box.width / (longest * style.glyphWidth), box.height / (lines.length * style.lineHeight))
    );
    if (fontSize > best.fontSize) best = { lines, fontSize };
  }
  return best;
}

/** Where the subject should sit so the text has room, as a fraction of the frame. */
const SUBJECT_ANCHOR: Record<ThumbnailLayout, { x: number; y: number }> = {
  left: { x: 0.72, y: 0.46 },
  right: { x: 0.28, y: 0.46 },
  bottom: { x: 0.5, y: 0.38 },
  center: { x: 0.5, y: 0.5 },
};

/** Zoom used when a focus is given without one: enough room to move the subject aside. */
export const FOCUS_ZOOM = 1.25;

/**
 * Scale and shift that bring the focus point to the layout's subject spot,
 * without showing anything outside the image.
 */
export function placeSubject(
  layout: ThumbnailLayout,
  focus: { x: number; y: number } | null,
  scale: number
): { scale: number; translate: { x: number; y: number } } {
  if (!focus) return { scale, translate: { x: (1 - scale) / 2, y: (1 - scale) / 2 } };
  const anchor = SUBJECT_ANCHOR[layout];
  const clamp = (v: number) => Math.min(0, Math.max(1 - scale, v));
  return { scale, translate: { x: clamp(anchor.x - scale * focus.x), y: clamp(anchor.y - scale * focus.y) } };
}
