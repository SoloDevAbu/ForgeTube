import { ValidationError } from "../../shared/errors.js";
import type { ScriptChapter } from "../schemas/script.js";

export interface ParsedSegment {
  segmentId: string;
  claimIds: string[];
  text: string;
}

export interface ParsedChapter {
  chapterId: string;
  title: string;
  timePeriod: string;
  segments: ParsedSegment[];
}

const PAUSE_MARKER = /\[pause(?:\s+[\d.]+)?\]/g;

/** Narration text as spoken, without pause markers. */
export function spokenText(text: string): string {
  return text.replace(PAUSE_MARKER, " ").replace(/\s+/g, " ").trim();
}

export function splitWords(text: string): string[] {
  const spoken = spokenText(text);
  return spoken ? spoken.split(" ") : [];
}

export function countWords(text: string): number {
  return splitWords(text).length;
}

/** Normalized word for matching anchors: no case, no surrounding punctuation. */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export type SpeechPart = { kind: "text"; text: string } | { kind: "pause"; seconds: number };

const DEFAULT_PAUSE_SECONDS = 0.8;

/** Splits narration at pause markers for the voice stage. */
export function splitSpeechParts(text: string): SpeechPart[] {
  const parts: SpeechPart[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[pause(?:\s+([\d.]+))?\]/g)) {
    const before = text.slice(last, match.index).trim();
    if (before) parts.push({ kind: "text", text: before });
    parts.push({ kind: "pause", seconds: match[1] ? parseFloat(match[1]) : DEFAULT_PAUSE_SECONDS });
    last = match.index + match[0].length;
  }
  const rest = text.slice(last).trim();
  if (rest) parts.push({ kind: "text", text: rest });
  return parts;
}

/**
 * Parses the compact script format:
 *
 *   # Chapter chapter_01: Title | 753-509 BC
 *   ## narration_001 [clm_a,clm_b]
 *   Narration text.
 */
export function parseScriptMarkdown(markdown: string): ParsedChapter[] {
  const chapters: ParsedChapter[] = [];
  let chapter: ParsedChapter | null = null;
  let segment: ParsedSegment | null = null;

  markdown.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    const lineNumber = index + 1;
    if (!line) return;

    const chapterMatch = line.match(/^#\s+Chapter\s+(\S+?):\s*(.+?)\s*\|\s*(.+)$/i);
    if (chapterMatch) {
      chapter = {
        chapterId: chapterMatch[1]!,
        title: chapterMatch[2]!,
        timePeriod: chapterMatch[3]!,
        segments: [],
      };
      chapters.push(chapter);
      segment = null;
      return;
    }

    const segmentMatch = line.match(/^##\s+(\S+)\s*\[([^\]]*)\]\s*$/);
    if (segmentMatch) {
      if (!chapter) throw new ValidationError(`Line ${lineNumber}: segment appears before any chapter heading.`);
      segment = {
        segmentId: segmentMatch[1]!,
        claimIds: segmentMatch[2]!.split(",").map((c) => c.trim()).filter(Boolean),
        text: "",
      };
      chapter.segments.push(segment);
      return;
    }

    if (line.startsWith("#")) {
      throw new ValidationError(
        `Line ${lineNumber}: unrecognised heading. Use "# Chapter <id>: <title> | <period>" or "## <segment_id> [claims]".`
      );
    }
    if (!segment) throw new ValidationError(`Line ${lineNumber}: text appears before any segment heading.`);
    segment.text = segment.text ? `${segment.text} ${line}` : line;
  });

  if (chapters.length === 0) throw new ValidationError("No chapters found in the script file.");
  return chapters;
}

export function renderScriptMarkdown(chapters: ScriptChapter[]): string {
  const lines: string[] = [];
  for (const ch of chapters) {
    lines.push(`# Chapter ${ch.chapter_id}: ${ch.title} | ${ch.time_period}`, "");
    for (const seg of ch.segments) {
      lines.push(`## ${seg.segment_id} [${seg.source_claim_ids.join(",")}]`, seg.text, "");
    }
  }
  return lines.join("\n");
}

const ATTRIBUTION = /\b(tradition|traditionally|legend|legendary|myth|according to|said to|told|tells|claimed?|believed|reportedly|ancient writers|story goes|supposedly|perhaps|may have)\b/i;

export interface ClaimLookup {
  claim: string;
  kind: string;
  time_period?: string;
}

/** Checks one narration segment against the claims it cites. */
export function checkSegmentAgainstClaims(
  segmentId: string,
  text: string,
  claimIds: string[],
  claims: Map<string, ClaimLookup>
): string[] {
  const errors: string[] = [];
  if (claimIds.length === 0) errors.push(`${segmentId}: cites no claim.`);

  const cited: ClaimLookup[] = [];
  for (const id of claimIds) {
    const claim = claims.get(id);
    if (claim) cited.push(claim);
    else errors.push(`${segmentId}: unknown claim "${id}".`);
  }

  if (cited.some((c) => c.kind === "tradition") && !ATTRIBUTION.test(spokenText(text))) {
    errors.push(`${segmentId}: cites a tradition, so the text must say so (for example "according to tradition").`);
  }

  const evidence = cited.map((c) => `${c.claim} ${c.time_period ?? ""}`).join(" ");
  for (const number of spokenText(text).match(/\d[\d,]*/g) ?? []) {
    const plain = number.replace(/,/g, "");
    if (!evidence.replace(/,/g, "").includes(plain)) {
      errors.push(`${segmentId}: says "${number}", which no cited claim contains.`);
    }
  }
  return errors;
}
