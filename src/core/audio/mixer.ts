import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import { TimelineCompiler } from "../timeline/timelineCompiler.js";
import { StageGraph, fingerprint } from "../pipeline/stageGraph.js";
import { atomicWriteFile, atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { RenderError, ValidationError } from "../../shared/errors.js";
import { computeFileChecksum } from "../assets/mediaInspector.js";
import { dbToGain, decodeMono, mixInto, SAMPLE_RATE, writeWavMono } from "./pcm.js";
import { getMusicDir, MusicLibrary, type MusicPlanEntry } from "./musicLibrary.js";
import type { MixSettings } from "../schemas/project.js";
import type { RenderManifest } from "../schemas/renderManifest.js";

const VOICE_CHAIN = "highpass=f=70,acompressor=threshold=-20dB:ratio=2.5:attack=5:release=90:makeup=2";
const AMBIENCE_TRIM_DB = -6;
const LUFS_FLOOR = -70;

export interface MixRecord {
  inputHash: string;
  lufs: number;
  truePeakDb: number;
  durationSeconds: number;
  hasMusic: boolean;
  soundEffects: number;
  mixedAt: string;
}

function ffmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-nostats", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf-8")));
    child.on("error", (err) => reject(new RenderError(`Failed to spawn ffmpeg: ${err.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve(stderr) : reject(new RenderError(`FFmpeg failed: ${stderr.slice(-800)}`))
    );
  });
}

function parseLoudnorm(stderr: string): Record<string, string> {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) throw new RenderError("FFmpeg did not report loudness.");
  return JSON.parse(stderr.slice(start, end + 1));
}

/** Integrated loudness and true peak of a file. */
export async function measureLoudness(file: string, preFilter = ""): Promise<{ lufs: number; truePeakDb: number; raw: Record<string, string> }> {
  const filter = `${preFilter ? `${preFilter},` : ""}loudnorm=print_format=json`;
  const raw = parseLoudnorm(await ffmpeg(["-i", file, "-af", filter, "-f", "null", "-"]));
  const lufs = parseFloat(raw.input_i!);
  return {
    lufs: Number.isFinite(lufs) ? lufs : LUFS_FLOOR,
    truePeakDb: parseFloat(raw.input_tp!),
    raw,
  };
}

/** Two-pass loudness normalization, keeping dynamics through a linear gain. */
async function normalize(
  input: string,
  output: string,
  target: { lufs: number; truePeakDb: number },
  options?: { preFilter?: string; postFilter?: string; lra?: number }
): Promise<void> {
  const lra = options?.lra ?? 11;
  const pre = options?.preFilter ? `${options.preFilter},` : "";
  const base = `loudnorm=I=${target.lufs}:TP=${target.truePeakDb}:LRA=${lra}`;
  const first = parseLoudnorm(
    await ffmpeg(["-i", input, "-af", `${pre}${base}:print_format=json`, "-f", "null", "-"])
  );
  const measured =
    `:measured_I=${first.input_i}:measured_TP=${first.input_tp}:measured_LRA=${first.input_lra}` +
    `:measured_thresh=${first.input_thresh}:offset=${first.target_offset}:linear=true`;
  const post = options?.postFilter ? `,${options.postFilter}` : "";
  await ffmpeg([
    "-i",
    input,
    "-af",
    `${pre}${base}${measured},aresample=${SAMPLE_RATE}${post}`,
    "-c:a",
    "pcm_s24le",
    output,
  ]);
}

export interface MusicPiece {
  file: string;
  startSeconds: number;
  lengthSeconds: number;
  gainDb: number;
}

/**
 * Lays out a chapter's bed. A track longer than its chapter fades out early; a
 * shorter one repeats with crossfades, never a hard seam.
 */
export function layoutMusic(
  entries: { chapterStart: number; chapterEnd: number; entry: MusicPlanEntry }[],
  settings: Pick<MixSettings, "musicLufs" | "crossfadeSeconds">
): MusicPiece[] {
  const pieces: MusicPiece[] = [];
  const fade = settings.crossfadeSeconds;

  for (const { chapterStart, chapterEnd, entry } of entries) {
    const trim = entry.kind === "ambience" ? AMBIENCE_TRIM_DB : 0;
    const gainDb = settings.musicLufs + trim - entry.lufs;
    const start = Math.max(0, chapterStart - fade / 2);
    const end = chapterEnd + fade / 2;
    const step = Math.max(fade + 0.5, entry.durationSeconds - fade);

    for (let at = start; at < end - fade / 2; at += step) {
      pieces.push({
        file: entry.file,
        startSeconds: at,
        lengthSeconds: Math.min(entry.durationSeconds, end - at),
        gainDb,
      });
    }
  }
  return pieces;
}

export class AudioMixer {
  private pm: ProjectManager;
  private tc: TimelineCompiler;
  private library: MusicLibrary;
  private stages: StageGraph;

  constructor(pm?: ProjectManager, tc?: TimelineCompiler, library?: MusicLibrary) {
    this.pm = pm ?? new ProjectManager();
    this.tc = tc ?? new TimelineCompiler(this.pm);
    this.library = library ?? new MusicLibrary(this.pm);
    this.stages = new StageGraph(this.pm);
  }

  private editingDir(projectId: string): string {
    return path.join(this.pm.getProjectRoot(projectId), "editing");
  }

  getMixPath(projectId: string): string {
    return path.join(this.editingDir(projectId), "mix.wav");
  }

  getRecordPath(projectId: string): string {
    return path.join(this.editingDir(projectId), "mix.json");
  }

  async getRecord(projectId: string): Promise<MixRecord | null> {
    const p = this.getRecordPath(projectId);
    return existsSync(p) ? readJsonFile<MixRecord>(p) : null;
  }

  private async inputHash(projectId: string, manifest: RenderManifest): Promise<string> {
    const root = this.pm.getProjectRoot(projectId);
    const project = await this.pm.loadProject(projectId);
    const plan = await this.library.getPlan(projectId);

    const sums = new Map<string, string>();
    for (const rel of new Set([...manifest.audio.voiceTracks, ...manifest.audio.soundEffects].map((t) => t.file))) {
      sums.set(rel, await computeFileChecksum(path.join(root, rel)));
    }
    return fingerprint({
      settings: project.settings.mix,
      frames: manifest.totalDurationFrames,
      fps: manifest.fps,
      chapters: manifest.chapters,
      voice: manifest.audio.voiceTracks.map((t) => [t.startFrame, sums.get(t.file)]),
      sfx: manifest.audio.soundEffects.map((t) => [t.startFrame, t.volume, sums.get(t.file)]),
      music: plan.entries.map((e) => [e.chapterId, e.file, e.kind, e.lufs]),
    });
  }

  private async buildStem(
    root: string,
    fps: number,
    totalSamples: number,
    events: { file: string; startFrame: number; volume: number }[]
  ): Promise<Float32Array> {
    const stem = new Float32Array(totalSamples);
    const decoded = new Map<string, Float32Array>();
    for (const event of events) {
      const samples = decoded.get(event.file) ?? (await decodeMono(path.join(root, event.file)));
      decoded.set(event.file, samples);
      mixInto(stem, samples, Math.round((event.startFrame / fps) * SAMPLE_RATE), event.volume);
    }
    return stem;
  }

  private async buildMusicStem(
    projectId: string,
    manifest: RenderManifest,
    settings: MixSettings,
    stemsDir: string,
    totalSeconds: number
  ): Promise<string | null> {
    const plan = await this.library.getPlan(projectId);
    if (plan.entries.length === 0) return null;

    const fps = manifest.fps;
    const placed = plan.entries.flatMap((entry) => {
      const chapter = manifest.chapters.find((c) => c.chapterId === entry.chapterId);
      if (!chapter) return [];
      return [{ chapterStart: chapter.startFrame / fps, chapterEnd: chapter.endFrame / fps, entry }];
    });
    const pieces = layoutMusic(placed, settings);
    if (pieces.length === 0) return null;

    const dir = getMusicDir();
    const fade = settings.crossfadeSeconds;
    const inputs: string[] = [];
    const filters: string[] = [];
    const labels: string[] = [];

    pieces.forEach((piece, i) => {
      inputs.push("-i", path.join(dir, piece.file));
      const delay = Math.round(piece.startSeconds * 1000);
      const length = piece.lengthSeconds.toFixed(3);
      const outAt = Math.max(0, piece.lengthSeconds - fade).toFixed(3);
      filters.push(
        `[${i}:a]aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,` +
          `atrim=0:${length},asetpts=PTS-STARTPTS,volume=${piece.gainDb.toFixed(2)}dB,` +
          `afade=t=in:st=0:d=${fade}:curve=qsin,afade=t=out:st=${outAt}:d=${fade}:curve=qsin,` +
          `adelay=${delay}|${delay}[m${i}]`
      );
      labels.push(`[m${i}]`);
    });
    filters.push(
      `${labels.join("")}amix=inputs=${pieces.length}:normalize=0:duration=longest,` +
        `apad=whole_dur=${totalSeconds.toFixed(3)},atrim=0:${totalSeconds.toFixed(3)}[out]`
    );

    const scriptPath = path.join(stemsDir, "music.filter.txt");
    await atomicWriteFile(scriptPath, filters.join(";\n"));
    const output = path.join(stemsDir, "music.wav");
    await ffmpeg([...inputs, "-/filter_complex", scriptPath, "-map", "[out]", "-c:a", "pcm_f32le", output]);
    return output;
  }

  /**
   * Mixes voice, music and effects into editing/mix.wav. The video is rendered
   * silent, so a change here only needs a new mux.
   */
  async mix(projectId: string, options?: { force?: boolean; allowMissingVoice?: boolean }): Promise<MixRecord & { reused: boolean }> {
    const project = await this.pm.loadProject(projectId);
    // Compile here so sound effects added since the last compile are heard.
    const manifest = await this.tc.compileTimeline(projectId);
    const { mix: settings } = project.settings;
    const root = this.pm.getProjectRoot(projectId);

    if (manifest.metadata.usesEstimatedTiming && !options?.allowMissingVoice) {
      throw new ValidationError('Some narration has no voice. Run "audio voice", then "timeline compile".');
    }
    if (manifest.audio.voiceTracks.length === 0) throw new ValidationError("There is no voice to mix.");

    const inputHash = await this.inputHash(projectId, manifest);
    const existing = await this.getRecord(projectId);
    const mixPath = this.getMixPath(projectId);
    if (!options?.force && existing?.inputHash === inputHash && existsSync(mixPath)) {
      return { ...existing, reused: true };
    }

    const stemsDir = path.join(this.editingDir(projectId), "stems");
    await fs.mkdir(stemsDir, { recursive: true });
    const totalSeconds = manifest.totalDurationFrames / manifest.fps;
    const totalSamples = Math.round(totalSeconds * SAMPLE_RATE);

    const voiceRaw = path.join(stemsDir, "voice_raw.wav");
    const voiceNorm = path.join(stemsDir, "voice.wav");
    await writeWavMono(
      voiceRaw,
      await this.buildStem(root, manifest.fps, totalSamples, manifest.audio.voiceTracks)
    );
    await normalize(voiceRaw, voiceNorm, { lufs: settings.voiceLufs, truePeakDb: -1.5 }, { preFilter: VOICE_CHAIN });

    const sfxPath = path.join(stemsDir, "sfx.wav");
    const sfxGain = dbToGain(settings.sfxGainDb);
    await writeWavMono(
      sfxPath,
      await this.buildStem(
        root,
        manifest.fps,
        totalSamples,
        manifest.audio.soundEffects.map((e) => ({ ...e, volume: e.volume * sfxGain }))
      )
    );

    const musicPath = await this.buildMusicStem(projectId, manifest, settings, stemsDir, totalSeconds);

    const premaster = path.join(stemsDir, "premaster.wav");
    const format = `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`;
    const inputs = ["-i", voiceNorm, "-i", sfxPath, ...(musicPath ? ["-i", musicPath] : [])];
    const graph = musicPath
      ? `[0:a]${format},asplit=2[voice][key];` +
        `[2:a]${format}[bed];` +
        `[bed][key]sidechaincompress=threshold=0.04:ratio=${settings.duckRatio}:attack=15:release=350:makeup=1[ducked];` +
        `[1:a]${format}[fx];` +
        `[voice][ducked][fx]amix=inputs=3:normalize=0:duration=longest,alimiter=limit=0.95:level=false[out]`
      : `[0:a]${format}[voice];[1:a]${format}[fx];` +
        `[voice][fx]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.95:level=false[out]`;
    await ffmpeg([...inputs, "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_f32le", premaster]);

    const temp = `${mixPath}.part.wav`;
    await normalize(
      premaster,
      temp,
      { lufs: settings.finalLufs, truePeakDb: settings.truePeakDb },
      { postFilter: `apad=whole_len=${totalSamples},atrim=end_sample=${totalSamples}`, lra: 18 }
    );
    await fs.rename(temp, mixPath);

    const measured = await measureLoudness(mixPath);
    const record: MixRecord = {
      inputHash,
      lufs: measured.lufs,
      truePeakDb: measured.truePeakDb,
      durationSeconds: totalSamples / SAMPLE_RATE,
      hasMusic: Boolean(musicPath),
      soundEffects: manifest.audio.soundEffects.length,
      mixedAt: new Date().toISOString(),
    };
    await atomicWriteJson(this.getRecordPath(projectId), record);
    await this.stages.markBuilt(projectId, "mix");
    return { ...record, reused: false };
  }

  async approve(projectId: string): Promise<MixRecord> {
    const manifest = await this.tc.getRenderManifest(projectId);
    const record = await this.getRecord(projectId);
    if (!record || !existsSync(this.getMixPath(projectId))) {
      throw new ValidationError('No mix yet. Run "audio mix" first.');
    }
    if (manifest.metadata.usesEstimatedTiming) {
      throw new ValidationError("Cannot approve audio: some narration has no voice.");
    }
    if (record.inputHash !== (await this.inputHash(projectId, manifest))) {
      throw new ValidationError('The mix is out of date. Run "audio mix" again.');
    }

    const project = await this.pm.loadProject(projectId);
    project.checkpoints.audioApproved = true;
    project.status = "AUDIO_READY";
    await this.pm.saveProject(project);
    await this.stages.markApproved(projectId, "mix");
    return record;
  }

  async isCurrent(projectId: string): Promise<boolean> {
    const manifest = await this.tc.getRenderManifest(projectId);
    const record = await this.getRecord(projectId);
    if (!record || !existsSync(this.getMixPath(projectId))) return false;
    return record.inputHash === (await this.inputHash(projectId, manifest));
  }
}
