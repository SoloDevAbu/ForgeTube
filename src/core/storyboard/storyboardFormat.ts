import { ValidationError } from "../../shared/errors.js";
import type { VisualStyleGuide } from "../schemas/storyboard.js";
import { CameraEffectValues, type CameraEffect, type TransitionType } from "../../shared/types.js";
import { normalizeWord, splitWords } from "../script/scriptFormat.js";

export interface ParsedShot {
  segmentId: string;
  chapterId: string;
  wordStart: number;
  wordEnd: number;
  prompt: string;
  camera: CameraEffect | null;
  intensity: number | null;
  transition: TransitionType | null;
  sfx: string[];
  allowShort: boolean;
}

export interface ParsedStoryboard {
  style: VisualStyleGuide;
  chapterMoods: Record<string, string>;
  shots: ParsedShot[];
}

const TRANSITIONS: Record<string, TransitionType> = {
  cut: "cut",
  dissolve: "cross_dissolve",
  fade_black: "fade_black",
  fade_white: "fade_white",
};

const STYLE_FIELDS: Record<string, keyof VisualStyleGuide> = {
  direction: "artisticDirection",
  wardrobe: "clothingAndArmor",
  environment: "architectureAndEnvironment",
  palette: "colorPaletteAndLighting",
  composition: "cameraAndComposition",
};

function parseOptions(raw: string | undefined, where: string) {
  const options = {
    camera: null as CameraEffect | null,
    intensity: null as number | null,
    transition: null as TransitionType | null,
    sfx: [] as string[],
    allowShort: false,
  };
  for (const token of raw?.trim().split(/\s+/).filter(Boolean) ?? []) {
    if (token === "short") {
      options.allowShort = true;
      continue;
    }
    const [key, value] = token.split("=") as [string, string | undefined];
    if (!value) throw new ValidationError(`${where}: bad option "${token}".`);
    if (key === "cam") {
      if (!CameraEffectValues.includes(value as CameraEffect)) {
        throw new ValidationError(`${where}: unknown camera "${value}". Use one of ${CameraEffectValues.join(", ")}.`);
      }
      options.camera = value as CameraEffect;
    } else if (key === "int") {
      options.intensity = parseFloat(value);
    } else if (key === "tr") {
      const transition = TRANSITIONS[value];
      if (!transition) throw new ValidationError(`${where}: unknown transition "${value}".`);
      options.transition = transition;
    } else if (key === "sfx") {
      options.sfx = value.split(",").filter(Boolean);
    } else {
      throw new ValidationError(`${where}: unknown option "${key}".`);
    }
  }
  return options;
}

/** Finds the end of a shot: the first place at or after `from` where the anchor words appear. */
function findAnchorEnd(words: string[], anchor: string[], from: number): number {
  for (let i = from; i + anchor.length <= words.length; i++) {
    if (anchor.every((w, j) => words[i + j] === w)) return i + anchor.length;
  }
  return -1;
}

/**
 * Parses the compact storyboard:
 *
 *   # style
 *   direction: ...
 *   character Name: ...
 *
 *   # chapter chapter_01 | mood: tense, low strings
 *   narration_001 | closing words of the shot | image prompt | cam=pan_left tr=dissolve sfx=impact/deep
 *   narration_001 | * | image prompt
 *
 * The second field names the last words the shot covers. "*" means through the
 * end of the segment. IDs, filenames, timing and defaults come from code.
 */
export function parseStoryboardFile(
  content: string,
  segments: Map<string, { chapterId: string; text: string }>
): ParsedStoryboard {
  const style: VisualStyleGuide = {
    schemaVersion: 1,
    artisticDirection: "",
    clothingAndArmor: "",
    architectureAndEnvironment: "",
    colorPaletteAndLighting: "",
    cameraAndComposition: "",
    negativePromptRules: [],
    continuityRules: [],
    characters: {},
    locations: {},
  };
  const chapterMoods: Record<string, string> = {};
  const shots: ParsedShot[] = [];
  const cursors = new Map<string, number>();
  const errors: string[] = [];

  let section: "none" | "style" | "shots" = "none";
  let chapterId = "";

  content.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    const where = `Line ${index + 1}`;
    if (!line) return;

    if (/^#\s*style\b/i.test(line)) {
      section = "style";
      return;
    }
    const chapterMatch = line.match(/^#\s*chapter\s+(\S+)\s*(?:\|\s*mood:\s*(.+))?$/i);
    if (chapterMatch) {
      section = "shots";
      chapterId = chapterMatch[1]!;
      chapterMoods[chapterId] = chapterMatch[2]?.trim() ?? "";
      return;
    }

    if (section === "style") {
      const separator = line.indexOf(":");
      if (separator < 0) {
        errors.push(`${where}: style lines need "key: value".`);
        return;
      }
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      const field = STYLE_FIELDS[key];
      if (field) (style as any)[field] = value;
      else if (key === "negative") style.negativePromptRules = value.split(",").map((v) => v.trim()).filter(Boolean);
      else if (key === "continuity") style.continuityRules = value.split(";").map((v) => v.trim()).filter(Boolean);
      else if (key.startsWith("character ")) style.characters[line.slice(10, separator).trim()] = value;
      else if (key.startsWith("location ")) style.locations[line.slice(9, separator).trim()] = value;
      else errors.push(`${where}: unknown style key "${key}".`);
      return;
    }

    if (section !== "shots") {
      errors.push(`${where}: expected "# style" or "# chapter <id>".`);
      return;
    }

    const fields = line.split(/\s+\|\s+/);
    if (fields.length < 3 || fields.length > 4) {
      errors.push(`${where}: shot lines need "segment | end words | prompt | options".`);
      return;
    }
    const [segmentId, anchorText, prompt, optionText] = fields as [string, string, string, string?];
    const segment = segments.get(segmentId);
    if (!segment) {
      errors.push(`${where}: unknown segment "${segmentId}".`);
      return;
    }
    if (segment.chapterId !== chapterId) {
      errors.push(`${where}: "${segmentId}" belongs to ${segment.chapterId}, not ${chapterId}.`);
      return;
    }

    const words = splitWords(segment.text).map(normalizeWord);
    const wordStart = cursors.get(segmentId) ?? 0;
    if (wordStart >= words.length) {
      errors.push(`${where}: "${segmentId}" has no words left for this shot.`);
      return;
    }

    let wordEnd = words.length;
    if (anchorText !== "*") {
      const anchor = splitWords(anchorText).map(normalizeWord).filter(Boolean);
      wordEnd = findAnchorEnd(words, anchor, wordStart);
      if (wordEnd < 0) {
        errors.push(`${where}: "${anchorText}" was not found in ${segmentId} after word ${wordStart}.`);
        return;
      }
    }
    cursors.set(segmentId, wordEnd);

    try {
      shots.push({ segmentId, chapterId, wordStart, wordEnd, prompt, ...parseOptions(optionText, where) });
    } catch (err: any) {
      errors.push(err.message);
    }
  });

  for (const [segmentId, segment] of segments) {
    const total = splitWords(segment.text).length;
    const covered = cursors.get(segmentId);
    if (covered !== undefined && covered < total) {
      errors.push(`${segmentId}: the last ${total - covered} word(s) have no shot. End the last shot with "*".`);
    }
  }

  if (errors.length > 0) throw new ValidationError(`Storyboard rejected:\n${errors.join("\n")}`);
  return { style, chapterMoods, shots };
}


/** Stills-only camera plan: gentle moves, no repeats side by side. */
const CAMERA_CYCLE: CameraEffect[] = ["slow_zoom_in", "pan_right", "slow_zoom_out", "pan_left", "cinematic_drift"];
const STATIC_BELOW_SECONDS = 1.5;

export function defaultCamera(shotIndex: number, seconds: number, previous: CameraEffect | null): CameraEffect {
  if (seconds < STATIC_BELOW_SECONDS) return "static";
  const candidate = CAMERA_CYCLE[shotIndex % CAMERA_CYCLE.length]!;
  return candidate === previous ? CAMERA_CYCLE[(shotIndex + 1) % CAMERA_CYCLE.length]! : candidate;
}

/** Motion scales with shot length, so 1 s and 5 s shots move at the same pace. */
export function autoCameraIntensity(seconds: number): number {
  return Math.round(Math.min(0.08, Math.max(0.02, seconds * 0.012)) * 1000) / 1000;
}
