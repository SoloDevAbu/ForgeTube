import { endsSentence, splitWords } from "../script/scriptFormat.js";
import type { VoiceWord } from "../audio/tts/voiceTake.js";

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface Cue {
  start: number;
  end: number;
  lines: string[];
}

export const CAPTION_LINE_CHARS = 42;
/** A silence this long between words starts a new cue. */
const PAUSE_SECONDS = 0.7;
const MIN_CUE_SECONDS = 1;
const HOLD_SECONDS = 0.3;

/**
 * Script words with the times they are spoken at in the film. The words come
 * from the script, so spelling and punctuation are right; the times come from
 * the measured take. When the voice split a word differently, for example a
 * year read as three words, positions map proportionally.
 */
export function timeSegmentWords(
  text: string,
  takeWords: VoiceWord[] | null,
  trackStart: number,
  trackSeconds: number
): TimedWord[] {
  const words = splitWords(text);
  if (words.length === 0) return [];

  if (takeWords && takeWords.length === words.length) {
    return words.map((w, i) => ({
      text: w,
      start: trackStart + takeWords[i]!.start,
      end: trackStart + takeWords[i]!.end,
    }));
  }

  if (takeWords && takeWords.length > 0) {
    const at = (i: number) => takeWords[Math.min(takeWords.length - 1, Math.floor((i * takeWords.length) / words.length))]!;
    return words.map((w, i) => ({
      text: w,
      start: trackStart + at(i).start,
      end: trackStart + (i + 1 < words.length ? Math.max(at(i).end, at(i + 1).start) : takeWords.at(-1)!.end),
    }));
  }

  // No word times for this take: spread the words over its measured length.
  const total = words.reduce((sum, w) => sum + w.length + 1, 0);
  let seen = 0;
  return words.map((w) => {
    const start = trackStart + (seen / total) * trackSeconds;
    seen += w.length + 1;
    return { text: w, start, end: trackStart + (seen / total) * trackSeconds };
  });
}

/** One or two lines, split at the word boundary nearest the middle. */
export function splitCueLines(words: string[]): string[] {
  const text = words.join(" ");
  if (text.length <= CAPTION_LINE_CHARS || words.length < 2) return [text];

  let best = 1;
  let bestDistance = Infinity;
  let length = 0;
  for (let i = 0; i + 1 < words.length; i++) {
    length += words[i]!.length + (i > 0 ? 1 : 0);
    const distance = Math.abs(length - text.length / 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i + 1;
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

/**
 * Halves a run of words until each part fits a cue. The cut goes near the
 * middle, and at a comma when one is close, so no cue is left with a stray word.
 */
function splitToFit(words: TimedWord[]): TimedWord[][] {
  const fits = splitCueLines(words.map((w) => w.text)).every((l) => l.length <= CAPTION_LINE_CHARS);
  if (fits || words.length < 2) return [words];

  const total = words.reduce((sum, w) => sum + w.text.length + 1, 0);
  let best = 1;
  let bestCost = Infinity;
  let length = 0;
  for (let i = 0; i + 1 < words.length; i++) {
    length += words[i]!.text.length + 1;
    const offCentre = Math.abs(length - total / 2) / total;
    const cost = offCentre - (/[,;:—–]$/.test(words[i]!.text) ? 0.15 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = i + 1;
    }
  }
  return [...splitToFit(words.slice(0, best)), ...splitToFit(words.slice(best))];
}

/** Groups words into cues of at most two 42-character lines, cut at sentences and pauses. */
export function buildCues(words: TimedWord[]): Cue[] {
  // Sentences and spoken pauses always start a new cue.
  const groups: TimedWord[][] = [];
  let current: TimedWord[] = [];
  for (const [i, word] of words.entries()) {
    current.push(word);
    const next = words[i + 1];
    if (!next || endsSentence(word.text) || next.start - word.end > PAUSE_SECONDS) {
      groups.push(...splitToFit(current));
      current = [];
    }
  }

  return groups.map((group, i) => {
    const start = group[0]!.start;
    const nextStart = groups[i + 1]?.[0]!.start ?? Infinity;
    const wanted = Math.max(group.at(-1)!.end + HOLD_SECONDS, start + MIN_CUE_SECONDS);
    return { start, end: Math.min(wanted, nextStart - 0.04), lines: splitCueLines(group.map((w) => w.text)) };
  });
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n: number, size = 2) => String(n).padStart(size, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function formatSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.lines.join("\n")}\n`).join("\n");
}

/** A chapter timestamp the way YouTube reads it: 0:00, 12:05 or 1:02:05. */
export function chapterTime(seconds: number): string {
  const s = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
    : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
