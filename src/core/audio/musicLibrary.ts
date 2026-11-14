import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import { atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { ValidationError } from "../../shared/errors.js";
import { REPO_ROOT } from "../../shared/paths.js";
import { computeFileChecksum, inspectMedia } from "../assets/mediaInspector.js";
import { loadToolConfig, runCliCommand } from "../providers/cliAdapter.js";
import { measureLoudness } from "./mixer.js";
import type { StoryboardManifest } from "../schemas/storyboard.js";

const MUSIC_EXTENSIONS = new Set([".wav", ".mp3", ".aac", ".m4a", ".ogg", ".flac"]);
const AMBIENCE_NAMES = /\b(ambien[ct]e?|atmos|atmosphere|room.?tone|wind|rain|crowd|nature|fire|battle.?bed)\b/i;

export interface MusicTrack {
  /** Path inside the music folder. */
  file: string;
  checksum: string;
  kind: "music" | "ambience";
  durationSeconds: number;
  lufs: number;
  tempoBpm: number | null;
  key: string | null;
}

export interface MusicIndex {
  tracks: MusicTrack[];
  updatedAt: string;
}

export interface MusicPlanEntry {
  chapterId: string;
  mood: string;
  file: string;
  kind: "music" | "ambience";
  lufs: number;
  durationSeconds: number;
  /** Set when a person chose this track, so re-planning keeps it. */
  locked: boolean;
}

export interface MusicPlan {
  entries: MusicPlanEntry[];
  updatedAt: string;
}

export interface BedRunResult {
  generated: string[];
  kept: string[];
  failed: { preset: string; message: string }[];
}

const BED_SCRIPT = path.join(REPO_ROOT, "tools", "earshot_bed.py");
const BED_FOLDER = "earshot";
const BED_TIMEOUT_MS = 15 * 60_000;
const PARALLEL_BEDS = 3;

/** A Python that can import earshot: its own launcher first, then the configured Python. */
async function bedPython(): Promise<string> {
  const { earshot, python } = await loadToolConfig();
  if (earshot) {
    const names = process.platform === "win32" ? ["earshot-py.cmd", "earshot-py"] : ["earshot-py"];
    for (const name of names) {
      const launcher = path.join(path.dirname(earshot), name);
      if (existsSync(launcher)) return launcher;
    }
  }
  if (python) return python;
  throw new ValidationError("earshot not found. Set earshot in forgetube.config.json. Run: video-studio doctor");
}

export function getMusicDir(): string {
  return process.env.FORGETUBE_MUSIC_DIR ?? path.join(REPO_ROOT, "music");
}

function classify(file: string): "music" | "ambience" {
  return AMBIENCE_NAMES.test(file.replace(/[\\/_-]/g, " ")) ? "ambience" : "music";
}

/**
 * Picks one track per chapter from rankings, best first, never repeating a
 * track back to back. When every option repeats, the next-best is used anyway.
 */
export function assignTracks(
  chapters: { chapterId: string; mood: string; ranked: string[]; locked?: string }[]
): { chapterId: string; mood: string; file: string | null }[] {
  const picks: { chapterId: string; mood: string; file: string | null }[] = [];
  const used = new Map<string, number>();

  for (const chapter of chapters) {
    const previous = picks.at(-1)?.file ?? null;
    const options = chapter.ranked.filter((f) => f !== previous);
    const pool = options.length > 0 ? options : chapter.ranked;
    // Prefer tracks used least, keeping rank order among equals.
    const file =
      chapter.locked ??
      [...pool].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0) || pool.indexOf(a) - pool.indexOf(b))[0] ??
      null;
    if (file) used.set(file, (used.get(file) ?? 0) + 1);
    picks.push({ chapterId: chapter.chapterId, mood: chapter.mood, file });
  }
  return picks;
}

export class MusicLibrary {
  private pm: ProjectManager;

  constructor(pm?: ProjectManager) {
    this.pm = pm ?? new ProjectManager();
  }

  private indexPath(): string {
    return path.join(getMusicDir(), "index.json");
  }

  planPath(projectId: string): string {
    return path.join(this.pm.getProjectRoot(projectId), "editing", "music-plan.json");
  }

  async getIndex(): Promise<MusicIndex> {
    const p = this.indexPath();
    return existsSync(p) ? readJsonFile<MusicIndex>(p) : { tracks: [], updatedAt: "" };
  }

  async getPlan(projectId: string): Promise<MusicPlan> {
    const p = this.planPath(projectId);
    return existsSync(p) ? readJsonFile<MusicPlan>(p) : { entries: [], updatedAt: "" };
  }

  /** Reads each file once. Files already scanned are skipped by checksum. */
  async scan(): Promise<{ scanned: string[]; skipped: number; removed: number; tracks: MusicTrack[] }> {
    const dir = getMusicDir();
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && !e.name.startsWith(".") && MUSIC_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
      .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"));

    const index = await this.getIndex();
    const known = new Map(index.tracks.map((t) => [t.checksum, t]));
    const { earshot } = await loadToolConfig();
    const scanned: string[] = [];
    const tracks: MusicTrack[] = [];

    for (const file of files) {
      const full = path.join(dir, file);
      const checksum = await computeFileChecksum(full);
      const existing = known.get(checksum);
      if (existing) {
        tracks.push({ ...existing, file });
        continue;
      }

      const meta = await inspectMedia(full);
      if (!meta.durationSeconds) continue;
      const { lufs } = await measureLoudness(full);

      let tempoBpm: number | null = null;
      let key: string | null = null;
      if (earshot) {
        const measured = await runCliCommand(earshot, ["measure", full, "--music", "--json"], { timeoutMs: 180_000 });
        if (measured.exitCode === 0) {
          try {
            const data = JSON.parse(measured.stdout.slice(measured.stdout.indexOf("{")));
            tempoBpm = data.tempo_bpm ?? data.bpm ?? null;
            key = data.key ?? null;
          } catch {
            // Tempo and key are only informative.
          }
        }
      }

      tracks.push({ file, checksum, kind: classify(file), durationSeconds: meta.durationSeconds, lufs, tempoBpm, key });
      scanned.push(file);
    }

    const removed = index.tracks.filter((t) => !tracks.some((n) => n.checksum === t.checksum)).length;
    await atomicWriteJson(this.indexPath(), { tracks, updatedAt: new Date().toISOString() } satisfies MusicIndex);
    return { scanned, skipped: tracks.length - scanned.length, removed, tracks };
  }

  /**
   * Makes background beds in code with earshot's synthesis toolkit and adds
   * them to the library. Existing files are kept; a new seed makes new takes.
   */
  async generateBeds(options?: {
    seed?: number;
    seconds?: number;
    onProgress?: (done: number, total: number) => void;
  }): Promise<BedRunResult> {
    const runner = await bedPython();
    const listed = await runCliCommand(runner, [BED_SCRIPT, "--list"]);
    if (listed.exitCode !== 0) {
      throw new ValidationError(`earshot could not be loaded for synthesis: ${listed.stderr.slice(-300)}`);
    }
    const presets = JSON.parse(listed.stdout.slice(listed.stdout.lastIndexOf("["))) as string[];

    const dir = path.join(getMusicDir(), BED_FOLDER);
    await fs.mkdir(dir, { recursive: true });
    const seed = options?.seed ?? 1;
    const result: BedRunResult = { generated: [], kept: [], failed: [] };
    const queue = [...presets];
    let done = 0;

    const worker = async () => {
      for (let preset = queue.shift(); preset; preset = queue.shift()) {
        const name = seed === 1 ? `${preset}.flac` : `${preset}_take${seed}.flac`;
        const file = path.join(dir, name);
        if (existsSync(file)) {
          result.kept.push(name);
        } else {
          const temp = path.join(dir, `.${name}.part.flac`);
          const args = [BED_SCRIPT, preset, temp, "--seed", String(seed)];
          if (options?.seconds) args.push("--seconds", String(options.seconds));
          try {
            const run = await runCliCommand(runner, args, { timeoutMs: BED_TIMEOUT_MS });
            if (run.exitCode !== 0) throw new Error(run.stderr.slice(-300));
            await fs.rename(temp, file);
            result.generated.push(name);
          } catch (err: any) {
            await fs.rm(temp, { force: true });
            result.failed.push({ preset, message: err.message });
          }
        }
        options?.onProgress?.(++done, presets.length);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_BEDS }, worker));
    return result;
  }

  /** Orders candidates for a mood with earshot, or by file name without it. */
  private async rankForMood(mood: string, tracks: MusicTrack[], earshot: string | null): Promise<string[]> {
    const dir = getMusicDir();
    const byPath = new Map(tracks.map((t) => [path.join(dir, t.file).split(path.sep).join("/").toLowerCase(), t.file]));

    if (earshot && mood && tracks.length > 1) {
      const paths = tracks.map((t) => path.join(dir, t.file));
      const ranked = await runCliCommand(earshot, ["rank", mood, ...paths, "--json"], { timeoutMs: 300_000 });
      if (ranked.exitCode === 0) {
        const data = JSON.parse(ranked.stdout.slice(ranked.stdout.search(/[{[]/)));
        const rows: any[] = Array.isArray(data) ? data : (data.results ?? data.ranked ?? data.files ?? []);
        const order = rows
          .map((r) => byPath.get(String(r.path ?? r.file).split("\\").join("/").toLowerCase()))
          .filter((f): f is string => Boolean(f));
        if (order.length > 0) return [...new Set([...order, ...tracks.map((t) => t.file)])];
      }
    }

    const words = mood.toLowerCase().split(/\W+/).filter(Boolean);
    const score = (t: MusicTrack) => words.filter((w) => t.file.toLowerCase().includes(w)).length;
    return [...tracks].sort((a, b) => score(b) - score(a)).map((t) => t.file);
  }

  /** One main track per chapter, and one ambience layer where the library has one. */
  async plan(projectId: string, storyboard: StoryboardManifest): Promise<MusicPlan> {
    const index = await this.getIndex();
    const music = index.tracks.filter((t) => t.kind === "music");
    if (music.length === 0) {
      throw new ValidationError(`No music found. Add tracks to ${getMusicDir()}, then run "audio music scan".`);
    }

    const chapterIds = [...new Set(storyboard.scenes.map((s) => s.chapterId))];
    const previous = await this.getPlan(projectId);
    const { earshot } = await loadToolConfig();
    const ambience = index.tracks.filter((t) => t.kind === "ambience");

    const buildLayer = async (tracks: MusicTrack[], kind: "music" | "ambience") => {
      const requests: { chapterId: string; mood: string; ranked: string[]; locked?: string }[] = [];
      for (const chapterId of chapterIds) {
        const mood = storyboard.chapterMoods[chapterId] ?? "";
        const locked = previous.entries.find((e) => e.chapterId === chapterId && e.kind === kind && e.locked);
        requests.push({
          chapterId,
          mood,
          ranked: await this.rankForMood(mood, tracks, earshot),
          locked: locked?.file,
        });
      }
      return assignTracks(requests).flatMap((pick) => {
        const track = tracks.find((t) => t.file === pick.file);
        if (!track) return [];
        const entry: MusicPlanEntry = {
          chapterId: pick.chapterId,
          mood: pick.mood,
          file: track.file,
          kind,
          lufs: track.lufs,
          durationSeconds: track.durationSeconds,
          locked: requests.find((r) => r.chapterId === pick.chapterId)?.locked === track.file,
        };
        return [entry];
      });
    };

    const entries = await buildLayer(music, "music");
    if (ambience.length > 0) entries.push(...(await buildLayer(ambience, "ambience")));

    const plan: MusicPlan = { entries, updatedAt: new Date().toISOString() };
    await atomicWriteJson(this.planPath(projectId), plan);
    return plan;
  }

  /** Overrides one chapter by hand. Re-planning keeps the choice. */
  async setTrack(projectId: string, chapterId: string, file: string): Promise<MusicPlan> {
    const index = await this.getIndex();
    const track = index.tracks.find((t) => t.file === file);
    if (!track) throw new ValidationError(`"${file}" is not in the music index. Run "audio music scan" first.`);

    const plan = await this.getPlan(projectId);
    const entry: MusicPlanEntry = {
      chapterId,
      mood: plan.entries.find((e) => e.chapterId === chapterId)?.mood ?? "",
      file: track.file,
      kind: track.kind,
      lufs: track.lufs,
      durationSeconds: track.durationSeconds,
      locked: true,
    };
    const at = plan.entries.findIndex((e) => e.chapterId === chapterId && e.kind === track.kind);
    if (at >= 0) plan.entries[at] = entry;
    else plan.entries.push(entry);
    plan.updatedAt = new Date().toISOString();
    await atomicWriteJson(this.planPath(projectId), plan);
    return plan;
  }
}
