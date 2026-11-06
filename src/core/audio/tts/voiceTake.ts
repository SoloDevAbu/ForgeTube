import path from "node:path";
import { existsSync } from "node:fs";
import { readJsonFile } from "../../../shared/atomic.js";

export interface VoiceWord {
  word: string;
  start: number;
  end: number;
}

/** Saved beside each voice WAV. */
export interface VoiceTake {
  segmentId: string;
  cacheKey: string;
  provider: string;
  voice: string;
  durationSeconds: number;
  words: VoiceWord[];
}

export function takeSidecarPath(wavPath: string): string {
  return wavPath.replace(/\.wav$/i, ".json");
}

export async function readVoiceTake(projectRoot: string, relativeWav: string): Promise<VoiceTake | null> {
  const p = takeSidecarPath(path.join(projectRoot, relativeWav));
  return existsSync(p) ? readJsonFile<VoiceTake>(p) : null;
}

/**
 * Word starts for the script's words. TTS can split a word differently from
 * the script, for example reading "509" as three words, so when counts differ
 * positions map proportionally.
 */
export function alignWordStarts(words: VoiceWord[], expectedCount: number): number[] | null {
  if (words.length === 0 || expectedCount === 0) return null;
  if (words.length === expectedCount) return words.map((w) => w.start);
  return Array.from({ length: expectedCount }, (_, i) => {
    const at = Math.floor((i * words.length) / expectedCount);
    return words[at]!.start;
  });
}
