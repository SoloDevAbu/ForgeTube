import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import {
  AudioMixManifestSchema,
  type AudioMixManifest,
  type SoundEffectTrackEvent,
} from "../schemas/audio.js";
import { atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { ValidationError } from "../../shared/errors.js";
import { computeFileChecksum, inspectMedia } from "../assets/mediaInspector.js";
import { loadToolConfig, runCliCommand } from "../providers/cliAdapter.js";
import type { SceneRecord } from "../schemas/storyboard.js";

export interface SfxPlanResult {
  planned: number;
  rendered: string[];
  reused: string[];
  failed: { soundId: string; message: string }[];
}

export class AudioManager {
  private pm: ProjectManager;

  constructor(pm?: ProjectManager) {
    this.pm = pm ?? new ProjectManager();
  }

  getAudioMixPath(projectId: string): string {
    return path.join(this.pm.getProjectRoot(projectId), "editing", "audio-mix.json");
  }

  async getAudioMix(projectId: string): Promise<AudioMixManifest> {
    const p = this.getAudioMixPath(projectId);
    if (!existsSync(p)) {
      return {
        schemaVersion: 1,
        masterVolume: 1.0,
        voiceTracks: [],
        soundEffects: [],
        musicBeds: [],
        updatedAt: new Date().toISOString(),
      };
    }
    const mix = AudioMixManifestSchema.parse(await readJsonFile(p));

    // Older projects keyed voice by scene.
    if (mix.voiceTracks.some((t) => !t.segmentId)) {
      const scenesPath = path.join(this.pm.getProjectRoot(projectId), "storyboard", "scenes.json");
      if (existsSync(scenesPath)) {
        const { scenes } = await readJsonFile<{ scenes: SceneRecord[] }>(scenesPath);
        for (const track of mix.voiceTracks) {
          track.segmentId ??= scenes.find((s) => s.sceneId === track.sceneId)?.narrationSegmentIds[0] ?? null;
        }
      }
    }
    return mix;
  }

  async saveAudioMix(projectId: string, mix: AudioMixManifest): Promise<void> {
    mix.updatedAt = new Date().toISOString();
    const validated = AudioMixManifestSchema.parse(mix);
    await atomicWriteJson(this.getAudioMixPath(projectId), validated);
  }

  upsertVoiceTrack(mix: AudioMixManifest, segmentId: string, file: string, durationSeconds: number): void {
    const track = {
      eventId: `voice_${segmentId}`,
      segmentId,
      sceneId: null,
      file,
      startSeconds: 0,
      durationSeconds,
      volume: 1.0,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
    };
    const index = mix.voiceTracks.findIndex((t) => t.segmentId === segmentId);
    if (index >= 0) mix.voiceTracks[index] = track;
    else mix.voiceTracks.push(track);
  }

  /**
   * Adds a sound effect file. The event ID comes from the file's content and
   * placement, so running the same command twice changes nothing.
   */
  async addSoundEffect(
    projectId: string,
    options: { inputPath: string; sceneId?: string; offsetSeconds?: number; volume?: number; loop?: boolean }
  ): Promise<SoundEffectTrackEvent> {
    if (!existsSync(options.inputPath)) throw new ValidationError(`SFX file not found: ${options.inputPath}`);

    const root = this.pm.getProjectRoot(projectId);
    const checksum = await computeFileChecksum(options.inputPath);
    const meta = await inspectMedia(options.inputPath);
    const filename = `${checksum.slice(0, 12)}_${path.basename(options.inputPath)}`;
    const target = path.join(root, "assets", "sound-effects", filename);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(options.inputPath, target);

    const event: SoundEffectTrackEvent = {
      eventId: `sfx_${options.sceneId ?? "film"}_${checksum.slice(0, 8)}_${options.offsetSeconds ?? 0}`,
      sceneId: options.sceneId ?? null,
      file: `assets/sound-effects/${filename}`,
      startSeconds: options.offsetSeconds ?? 0,
      durationSeconds: meta.durationSeconds ?? null,
      volume: options.volume ?? 0.5,
      fadeInSeconds: 0,
      fadeOutSeconds: 0.05,
      loop: options.loop ?? false,
    };

    const mix = await this.getAudioMix(projectId);
    const index = mix.soundEffects.findIndex((e) => e.eventId === event.eventId);
    if (index >= 0) mix.soundEffects[index] = event;
    else mix.soundEffects.push(event);
    await this.saveAudioMix(projectId, mix);
    return event;
  }

  /**
   * Renders the storyboard's sfx= suggestions with earshot. Each sound renders
   * once per project and takes are reused. Hand-added effects are left alone.
   */
  async renderPlannedSfx(projectId: string): Promise<SfxPlanResult> {
    const root = this.pm.getProjectRoot(projectId);
    const { earshot } = await loadToolConfig();
    if (!earshot) throw new ValidationError("earshot not found. Set earshot in forgetube.config.json.");

    const { scenes } = await readJsonFile<{ scenes: SceneRecord[] }>(path.join(root, "storyboard", "scenes.json"));
    const planned = scenes.flatMap((s) => s.sfxSuggestions.map((soundId) => ({ sceneId: s.sceneId, soundId })));

    const sfxDir = path.join(root, "assets", "sound-effects", "earshot");
    await fs.mkdir(sfxDir, { recursive: true });

    const result: SfxPlanResult = { planned: planned.length, rendered: [], reused: [], failed: [] };
    const durations = new Map<string, number>();

    for (const soundId of new Set(planned.map((p) => p.soundId))) {
      const file = path.join(sfxDir, `${soundId.replace(/[^a-z0-9_-]/gi, "_")}.wav`);
      if (existsSync(file)) {
        result.reused.push(soundId);
      } else {
        const render = await runCliCommand(earshot, ["sfx", "render", soundId, "-o", file]);
        if (render.exitCode !== 0) {
          result.failed.push({ soundId, message: render.stderr.slice(-300) });
          continue;
        }
        result.rendered.push(soundId);
      }
      durations.set(soundId, (await inspectMedia(file)).durationSeconds ?? 2);
    }

    const mix = await this.getAudioMix(projectId);
    mix.soundEffects = mix.soundEffects.filter((e) => !e.eventId.startsWith("sfxplan_"));
    for (const { sceneId, soundId } of planned) {
      if (!durations.has(soundId)) continue;
      const name = soundId.replace(/[^a-z0-9_-]/gi, "_");
      mix.soundEffects.push({
        eventId: `sfxplan_${sceneId}_${name}`,
        sceneId,
        file: `assets/sound-effects/earshot/${name}.wav`,
        startSeconds: 0,
        durationSeconds: durations.get(soundId)!,
        volume: 0.7,
        fadeInSeconds: 0,
        fadeOutSeconds: 0.05,
        loop: false,
      });
    }
    await this.saveAudioMix(projectId, mix);
    return result;
  }
}
