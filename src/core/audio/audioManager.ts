import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import {
  AudioMixManifestSchema,
  type AudioMixManifest,
  type VoiceTrackEvent,
  type SoundEffectTrackEvent,
  type MusicBed,
} from "../schemas/audio.js";
import { atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { AssetError, ValidationError } from "../../shared/errors.js";
import { Logger } from "../../shared/logger.js";
import { inspectMedia } from "../assets/mediaInspector.js";
import { secondsToFrames } from "../timeline/timeMath.js";
import type { SceneRecord } from "../schemas/storyboard.js";

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".aac", ".m4a", ".ogg", ".flac"]);

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
    const raw = await readJsonFile(p);
    return AudioMixManifestSchema.parse(raw);
  }

  async saveAudioMix(projectId: string, mix: AudioMixManifest): Promise<void> {
    mix.updatedAt = new Date().toISOString();
    const validated = AudioMixManifestSchema.parse(mix);
    await atomicWriteJson(this.getAudioMixPath(projectId), validated);
  }

  /**
   * Imports narration audio files (single file or directory), measures actual durations via FFprobe,
   * copies to assets/voice/, and links to scene records and audio-mix.
   */
  async importVoiceAudio(
    projectId: string,
    options: { inputPath: string; sceneId?: string }
  ): Promise<{ importedCount: number; importedTracks: VoiceTrackEvent[] }> {
    const root = this.pm.getProjectRoot(projectId);
    const project = await this.pm.loadProject(projectId);
    const logger = new Logger(path.join(root, "logs", "project.log"));
    const voiceDir = path.join(root, "assets", "voice");
    await fs.mkdir(voiceDir, { recursive: true });

    if (!existsSync(options.inputPath)) {
      throw new ValidationError(`Input path not found: "${options.inputPath}"`);
    }

    const filesToProcess: string[] = [];
    const stat = await fs.stat(options.inputPath);

    if (stat.isDirectory()) {
      const entries = await fs.readdir(options.inputPath, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (AUDIO_EXTENSIONS.has(ext)) {
            const fullPath = (entry as any).parentPath
              ? path.join((entry as any).parentPath, entry.name)
              : path.join(options.inputPath, entry.name);
            filesToProcess.push(fullPath);
          }
        }
      }
    } else {
      const ext = path.extname(options.inputPath).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(ext)) {
        throw new ValidationError(`Unsupported audio format: ${options.inputPath}`);
      }
      filesToProcess.push(options.inputPath);
    }

    if (filesToProcess.length === 0) {
      throw new ValidationError(`No valid audio files found in: ${options.inputPath}`);
    }

    const scenesPath = path.join(root, "storyboard", "scenes.json");
    let scenesData: { scenes: SceneRecord[] } | null = null;
    if (existsSync(scenesPath)) {
      scenesData = await readJsonFile(scenesPath);
    }

    const audioMix = await this.getAudioMix(projectId);
    const importedTracks: VoiceTrackEvent[] = [];

    for (const file of filesToProcess) {
      const filename = path.basename(file);
      let targetSceneId = options.sceneId;

      if (!targetSceneId) {
        const match = filename.match(/scene_(\d+)/i);
        if (match) {
          targetSceneId = `scene_${match[1]?.padStart(3, "0")}`;
        }
      }

      if (!targetSceneId) {
        throw new ValidationError(
          `Could not determine scene ID from filename "${filename}". Specify --scene <sceneId>`
        );
      }

      // Inspect audio with FFprobe
      logger.info(`Measuring audio duration via ffprobe: ${filename}`, { projectId, stage: "AUDIO" });
      const meta = await inspectMedia(file);

      if (!meta.durationSeconds || meta.durationSeconds <= 0) {
        throw new AssetError(`Unable to measure duration for audio file: ${file}`);
      }

      const targetFilename = `${targetSceneId}.wav`;
      const targetPath = path.join(voiceDir, targetFilename);
      await fs.copyFile(file, targetPath);

      const relativePath = `assets/voice/${targetFilename}`;
      const voiceDurationFrames = secondsToFrames(meta.durationSeconds, project.settings.fps);

      const trackEvent: VoiceTrackEvent = {
        eventId: `voice_${targetSceneId}`,
        sceneId: targetSceneId,
        file: relativePath,
        startSeconds: 0, // Resolved dynamically during timeline compilation
        durationSeconds: meta.durationSeconds,
        volume: 1.0,
        fadeInSeconds: 0.05,
        fadeOutSeconds: 0.05,
      };

      // Update audio mix
      const existingIdx = audioMix.voiceTracks.findIndex((t) => t.sceneId === targetSceneId);
      if (existingIdx >= 0) {
        audioMix.voiceTracks[existingIdx] = trackEvent;
      } else {
        audioMix.voiceTracks.push(trackEvent);
      }
      importedTracks.push(trackEvent);

      // Update scene record with actual measured voice duration
      if (scenesData) {
        const sc = scenesData.scenes.find((s) => s.sceneId === targetSceneId);
        if (sc) {
          sc.audio.voice = relativePath;
          sc.actualVoiceDurationFrames = voiceDurationFrames;
          sc.status.audio = "ready";
        }
      }
    }

    await this.saveAudioMix(projectId, audioMix);

    if (scenesData) {
      await atomicWriteJson(scenesPath, scenesData);
    }

    return {
      importedCount: importedTracks.length,
      importedTracks,
    };
  }

  /**
   * Imports a sound effect asset.
   */
  async importSoundEffect(
    projectId: string,
    options: {
      inputPath: string;
      sceneId?: string;
      offsetSeconds?: number;
      volume?: number;
      fadeInSeconds?: number;
      fadeOutSeconds?: number;
      loop?: boolean;
    }
  ): Promise<SoundEffectTrackEvent> {
    const root = this.pm.getProjectRoot(projectId);
    const sfxDir = path.join(root, "assets", "sound-effects");
    await fs.mkdir(sfxDir, { recursive: true });

    if (!existsSync(options.inputPath)) {
      throw new ValidationError(`SFX file not found: ${options.inputPath}`);
    }

    const meta = await inspectMedia(options.inputPath);
    const filename = path.basename(options.inputPath);
    const targetPath = path.join(sfxDir, filename);
    await fs.copyFile(options.inputPath, targetPath);

    const relativePath = `assets/sound-effects/${filename}`;
    const sfxEvent: SoundEffectTrackEvent = {
      eventId: `sfx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sceneId: options.sceneId ?? null,
      file: relativePath,
      startSeconds: options.offsetSeconds ?? 0,
      durationSeconds: meta.durationSeconds ?? null,
      volume: options.volume ?? 0.5,
      fadeInSeconds: options.fadeInSeconds ?? 0.2,
      fadeOutSeconds: options.fadeOutSeconds ?? 0.3,
      loop: options.loop ?? false,
    };

    const mix = await this.getAudioMix(projectId);
    mix.soundEffects.push(sfxEvent);
    await this.saveAudioMix(projectId, mix);

    return sfxEvent;
  }

  /**
   * Imports background music bed.
   */
  async importMusicBed(
    projectId: string,
    options: {
      inputPath: string;
      startSeconds?: number;
      volume?: number;
      fadeInSeconds?: number;
      fadeOutSeconds?: number;
      loop?: boolean;
      ducking?: boolean;
    }
  ): Promise<MusicBed> {
    const root = this.pm.getProjectRoot(projectId);
    const musicDir = path.join(root, "assets", "music");
    await fs.mkdir(musicDir, { recursive: true });

    if (!existsSync(options.inputPath)) {
      throw new ValidationError(`Music file not found: ${options.inputPath}`);
    }

    const meta = await inspectMedia(options.inputPath);
    const filename = path.basename(options.inputPath);
    const targetPath = path.join(musicDir, filename);
    await fs.copyFile(options.inputPath, targetPath);

    const relativePath = `assets/music/${filename}`;
    const musicBed: MusicBed = {
      trackId: `music_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      file: relativePath,
      startSeconds: options.startSeconds ?? 0,
      endSeconds: null, // Covers composition duration
      volume: options.volume ?? 0.2,
      fadeInSeconds: options.fadeInSeconds ?? 1.5,
      fadeOutSeconds: options.fadeOutSeconds ?? 2.0,
      loop: options.loop ?? true,
      ducking: {
        enabled: options.ducking ?? true,
        duckedVolume: 0.08,
        duckFadeSeconds: 0.5,
      },
      volumeEnvelope: [],
    };

    const mix = await this.getAudioMix(projectId);
    mix.musicBeds.push(musicBed);
    await this.saveAudioMix(projectId, mix);

    return musicBed;
  }
}

