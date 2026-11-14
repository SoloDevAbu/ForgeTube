import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import { ScriptManager } from "../script/scriptManager.js";
import { StageGraph, fingerprint } from "../pipeline/stageGraph.js";
import { AudioManager } from "./audioManager.js";
import { atomicWriteJson } from "../../shared/atomic.js";
import { AssetError, ValidationError } from "../../shared/errors.js";
import { computeFileChecksum, inspectMedia } from "../assets/mediaInspector.js";
import { endsSentence, splitSpeechParts, splitWords } from "../script/scriptFormat.js";
import { decodeMono, SAMPLE_RATE, writeWavMono } from "./pcm.js";
import { speak } from "./tts/providers.js";
import { takeSidecarPath, type VoiceTake, type VoiceWord } from "./tts/voiceTake.js";
import type { VoiceSettings } from "../schemas/project.js";

const EDGE_PAD_SECONDS = 0.05;
const PARALLEL_SEGMENTS = 4;

export interface VoiceRunResult {
  generated: string[];
  reused: string[];
  failed: { segmentId: string; message: string }[];
  totalSeconds: number;
}

/** Cuts the silence TTS pads each clip with, keeping word times correct. */
function trimToWords(samples: Float32Array, words: VoiceWord[]): { samples: Float32Array; words: VoiceWord[] } {
  if (words.length === 0) return { samples, words };
  const start = Math.max(0, words[0]!.start - EDGE_PAD_SECONDS);
  const end = Math.min(samples.length / SAMPLE_RATE, words.at(-1)!.end + EDGE_PAD_SECONDS * 3);
  return {
    samples: samples.subarray(Math.round(start * SAMPLE_RATE), Math.round(end * SAMPLE_RATE)),
    words: words.map((w) => ({ ...w, start: w.start - start, end: w.end - start })),
  };
}

/**
 * Adds a held beat after each sentence. Word events carry no punctuation, so
 * sentence ends come from the script, and only when the word counts agree.
 */
function holdSentences(
  samples: Float32Array,
  words: VoiceWord[],
  scriptWords: string[],
  gapSeconds: number
): { samples: Float32Array; words: VoiceWord[] } {
  if (gapSeconds <= 0 || words.length !== scriptWords.length) return { samples, words };

  const cuts: number[] = [];
  for (let i = 0; i + 1 < words.length; i++) {
    if (endsSentence(scriptWords[i]!)) cuts.push(i);
  }
  if (cuts.length === 0) return { samples, words };

  const gap = Math.round(gapSeconds * SAMPLE_RATE);
  const output = new Float32Array(samples.length + cuts.length * gap);
  const shifted = words.map((w) => ({ ...w }));
  let from = 0;
  let to = 0;

  cuts.forEach((wordIndex, n) => {
    const at = Math.round(((words[wordIndex]!.end + words[wordIndex + 1]!.start) / 2) * SAMPLE_RATE);
    output.set(samples.subarray(from, at), to);
    to += at - from + gap;
    from = at;
    for (let i = wordIndex + 1; i < shifted.length; i++) {
      shifted[i]!.start = words[i]!.start + ((n + 1) * gap) / SAMPLE_RATE;
      shifted[i]!.end = words[i]!.end + ((n + 1) * gap) / SAMPLE_RATE;
    }
  });
  output.set(samples.subarray(from), to);
  return { samples: output, words: shifted };
}

export class VoiceManager {
  private pm: ProjectManager;
  private sm: ScriptManager;
  private audio: AudioManager;
  private stages: StageGraph;

  constructor(pm?: ProjectManager, sm?: ScriptManager, audio?: AudioManager) {
    this.pm = pm ?? new ProjectManager();
    this.sm = sm ?? new ScriptManager(this.pm);
    this.audio = audio ?? new AudioManager(this.pm);
    this.stages = new StageGraph(this.pm);
  }

  private voiceDir(projectId: string): string {
    return path.join(this.pm.getProjectRoot(projectId), "assets", "voice");
  }

  private async synthesize(
    text: string,
    settings: VoiceSettings,
    sentenceGapSeconds: number
  ): Promise<{ samples: Float32Array; words: VoiceWord[] }> {
    const pieces: Float32Array[] = [];
    const allWords: VoiceWord[] = [];
    let offset = 0;

    for (const part of splitSpeechParts(text)) {
      if (part.kind === "pause") {
        const silence = new Float32Array(Math.round(part.seconds * SAMPLE_RATE));
        pieces.push(silence);
        offset += silence.length / SAMPLE_RATE;
        continue;
      }
      const spoken = await speak(part.text, settings);
      const trimmed = trimToWords(spoken.samples, spoken.words);
      const held = holdSentences(trimmed.samples, trimmed.words, splitWords(part.text), sentenceGapSeconds);
      pieces.push(held.samples);
      allWords.push(...held.words.map((w) => ({ ...w, start: w.start + offset, end: w.end + offset })));
      offset += held.samples.length / SAMPLE_RATE;
    }

    const samples = new Float32Array(pieces.reduce((sum, p) => sum + p.length, 0));
    let at = 0;
    for (const piece of pieces) {
      samples.set(piece, at);
      at += piece.length;
    }
    return { samples, words: allWords };
  }

  /** Keeps the previous take instead of overwriting it. */
  private async archiveTake(wavPath: string): Promise<void> {
    if (!existsSync(wavPath)) return;
    const takesDir = path.join(path.dirname(wavPath), "takes");
    await fs.mkdir(takesDir, { recursive: true });
    const base = path.basename(wavPath, ".wav");
    const version = (await fs.readdir(takesDir)).filter((f) => f.startsWith(`${base}_v`) && f.endsWith(".wav")).length + 1;
    const target = path.join(takesDir, `${base}_v${String(version).padStart(2, "0")}`);
    await fs.rename(wavPath, `${target}.wav`);
    const sidecar = takeSidecarPath(wavPath);
    if (existsSync(sidecar)) await fs.rename(sidecar, `${target}.json`);
  }

  /** Voices narration by segment. Only changed text costs a new take. */
  async generate(
    projectId: string,
    options?: { segmentId?: string; force?: boolean; regenerate?: boolean; onProgress?: (done: number, total: number) => void }
  ): Promise<VoiceRunResult> {
    await this.stages.requireApproved(projectId, "script", options?.force);

    const project = await this.pm.loadProject(projectId);
    const script = await this.sm.getScriptManifest(projectId);
    const settings = project.settings.voice;
    const gap = project.settings.sentenceGapSeconds;
    const voiceDir = this.voiceDir(projectId);
    await fs.mkdir(voiceDir, { recursive: true });

    let segments = script.chapters.flatMap((c) => c.segments);
    if (options?.segmentId) {
      segments = segments.filter((s) => s.segment_id === options.segmentId);
      if (segments.length === 0) throw new ValidationError(`Narration segment "${options.segmentId}" not found.`);
    }

    const result: VoiceRunResult = { generated: [], reused: [], failed: [], totalSeconds: 0 };
    const mix = await this.audio.getAudioMix(projectId);
    const queue = [...segments];
    let done = 0;

    const worker = async () => {
      for (let segment = queue.shift(); segment; segment = queue.shift()) {
        const id = segment.segment_id;
        const wavPath = path.join(voiceDir, `${id}.wav`);
        const cacheKey = fingerprint({ text: segment.text, ...settings, gap });
        const sidecar = takeSidecarPath(wavPath);

        try {
          let take: VoiceTake | null = existsSync(sidecar) ? JSON.parse(await fs.readFile(sidecar, "utf-8")) : null;
          const ownRecording = take?.provider === "imported";
          const reusable =
            !options?.regenerate && existsSync(wavPath) && take && (take.cacheKey === cacheKey || ownRecording);

          if (reusable) {
            result.reused.push(id);
          } else {
            const speech = await this.synthesize(segment.text, settings, gap);
            await this.archiveTake(wavPath);
            await writeWavMono(wavPath, speech.samples);
            take = {
              segmentId: id,
              cacheKey,
              provider: settings.provider,
              voice: settings.voice,
              durationSeconds: speech.samples.length / SAMPLE_RATE,
              words: speech.words,
            };
            await atomicWriteJson(sidecar, take);
            result.generated.push(id);
          }

          this.audio.upsertVoiceTrack(mix, id, `assets/voice/${id}.wav`, take!.durationSeconds);
          result.totalSeconds += take!.durationSeconds;
        } catch (err: any) {
          result.failed.push({ segmentId: id, message: err.message });
        }
        options?.onProgress?.(++done, segments.length);
      }
    };

    await Promise.all(Array.from({ length: PARALLEL_SEGMENTS }, worker));

    await this.audio.saveAudioMix(projectId, mix);
    await this.stages.markBuilt(projectId, "voice");
    return result;
  }

  /** Brings in a recording of one segment. The original file is kept as supplied. */
  async importRecording(
    projectId: string,
    inputFile: string,
    segmentId: string
  ): Promise<{ segmentId: string; durationSeconds: number }> {
    if (!existsSync(inputFile)) throw new ValidationError(`Input path not found: "${inputFile}"`);
    const script = await this.sm.getScriptManifest(projectId);
    if (!script.chapters.some((c) => c.segments.some((s) => s.segment_id === segmentId))) {
      throw new ValidationError(`Narration segment "${segmentId}" not found.`);
    }
    const meta = await inspectMedia(inputFile);
    if (!meta.durationSeconds) throw new AssetError(`Unable to measure duration for audio file: ${inputFile}`);

    const voiceDir = this.voiceDir(projectId);
    const originals = path.join(voiceDir, "originals");
    await fs.mkdir(originals, { recursive: true });
    const version = (await fs.readdir(originals)).filter((f) => f.startsWith(segmentId)).length + 1;
    await fs.copyFile(
      inputFile,
      path.join(originals, `${segmentId}_v${String(version).padStart(2, "0")}${path.extname(inputFile)}`)
    );

    const wavPath = path.join(voiceDir, `${segmentId}.wav`);
    const samples = await decodeMono(inputFile);
    await this.archiveTake(wavPath);
    await writeWavMono(wavPath, samples);

    const durationSeconds = samples.length / SAMPLE_RATE;
    const take: VoiceTake = {
      segmentId,
      cacheKey: `imported:${await computeFileChecksum(inputFile)}`,
      provider: "imported",
      voice: "recording",
      durationSeconds,
      words: [],
    };
    await atomicWriteJson(takeSidecarPath(wavPath), take);

    const mix = await this.audio.getAudioMix(projectId);
    this.audio.upsertVoiceTrack(mix, segmentId, `assets/voice/${segmentId}.wav`, durationSeconds);
    await this.audio.saveAudioMix(projectId, mix);
    await this.stages.markBuilt(projectId, "voice");
    return { segmentId, durationSeconds };
  }
}
