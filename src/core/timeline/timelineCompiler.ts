import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import { AudioManager } from "../audio/audioManager.js";
import {
  RenderManifestSchema,
  type RenderManifest,
  type CompiledScene,
  type CompiledVoiceTrack,
  type CompiledSoundEffect,
  type CompiledMusicBed,
} from "../schemas/renderManifest.js";
import { atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { TimelineError, ValidationError } from "../../shared/errors.js";
import { Logger } from "../../shared/logger.js";
import { secondsToFrames, framesToSeconds } from "./timeMath.js";
import type { SceneRecord } from "../schemas/storyboard.js";
import type { FitMode, CameraEffect, TransitionType } from "../../shared/types.js";

export interface TimelineValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sceneCount: number;
  totalDurationFrames: number;
  totalDurationSeconds: number;
}

export class TimelineCompiler {
  private pm: ProjectManager;
  private audioMgr: AudioManager;

  constructor(pm?: ProjectManager, audioMgr?: AudioManager) {
    this.pm = pm ?? new ProjectManager();
    this.audioMgr = audioMgr ?? new AudioManager(this.pm);
  }

  getRenderDir(projectId: string): string {
    return path.join(this.pm.getProjectRoot(projectId), "render");
  }

  getManifestPath(projectId: string): string {
    return path.join(this.getRenderDir(projectId), "render-manifest.json");
  }

  async getRenderManifest(projectId: string): Promise<RenderManifest> {
    const p = this.getManifestPath(projectId);
    if (!existsSync(p)) {
      throw new TimelineError(
        `Render manifest not found for project "${projectId}". Run "video-studio timeline compile" first.`
      );
    }
    const raw = await readJsonFile(p);
    return RenderManifestSchema.parse(raw);
  }

  /**
   * Compiles the editorial storyboard and audio mix into a frame-accurate, deterministic render manifest.
   */
  async compileTimeline(
    projectId: string,
    options?: {
      breathingRoomSeconds?: number;
      mode?: "scene" | "draft" | "final";
      singleSceneId?: string;
    }
  ): Promise<RenderManifest> {
    const root = this.pm.getProjectRoot(projectId);
    const project = await this.pm.loadProject(projectId);
    const logger = new Logger(path.join(root, "logs", "project.log"));

    logger.info("Compiling frame-accurate timeline...", { projectId, stage: "TIMELINE" });

    const scenesPath = path.join(root, "storyboard", "scenes.json");
    if (!existsSync(scenesPath)) {
      throw new TimelineError(`Storyboard scenes file not found at ${scenesPath}`);
    }

    const scenesData = await readJsonFile<{ scenes: SceneRecord[] }>(scenesPath);
    let rawScenes = scenesData.scenes;

    if (options?.singleSceneId) {
      rawScenes = rawScenes.filter((s) => s.sceneId === options.singleSceneId);
      if (rawScenes.length === 0) {
        throw new TimelineError(`Scene "${options.singleSceneId}" not found for timeline compilation.`);
      }
    }

    if (rawScenes.length === 0) {
      throw new TimelineError("Cannot compile timeline: no scenes in storyboard.");
    }

    const fps = project.settings.fps;
    const breathingRoomFrames = secondsToFrames(options?.breathingRoomSeconds ?? 0.5, fps);

    const compiledScenes: CompiledScene[] = [];
    const sceneStartFrameMap = new Map<string, number>();

    let currentTimelineFrame = 0;

    for (let i = 0; i < rawScenes.length; i++) {
      const scene = rawScenes[i]!;

      // 1. Determine duration in integer frames
      let durationFrames: number;
      if (scene.actualVoiceDurationFrames && scene.actualVoiceDurationFrames > 0) {
        // Priority 2: measured narration duration + breathing room
        durationFrames = Math.max(
          secondsToFrames(scene.suggestedDurationSeconds, fps),
          scene.actualVoiceDurationFrames + breathingRoomFrames
        );
      } else {
        // Priority 4: suggested duration in seconds converted to integer frames
        durationFrames = secondsToFrames(scene.suggestedDurationSeconds, fps);
      }

      if (durationFrames <= 0) {
        durationFrames = secondsToFrames(4.0, fps); // Safety minimum
      }

      // 2. Determine transition overlap
      const transType = scene.transition?.type ?? "cross_dissolve";
      const transSecs = scene.transition?.durationSeconds ?? 0.5;
      const transFrames = transType === "cut" ? 0 : secondsToFrames(transSecs, fps);

      // Overlap cannot exceed 40% of either scene
      let overlapFrames = 0;
      if (i > 0 && transType !== "cut") {
        const prevDuration = compiledScenes[i - 1]!.durationFrames;
        const maxAllowedOverlap = Math.floor(Math.min(prevDuration, durationFrames) * 0.4);
        overlapFrames = Math.min(transFrames, maxAllowedOverlap);
      }

      // 3. Compute startFrame and endFrame
      const startFrame = i === 0 ? 0 : currentTimelineFrame - overlapFrames;
      const endFrame = startFrame + durationFrames;
      currentTimelineFrame = endFrame;

      sceneStartFrameMap.set(scene.sceneId, startFrame);

      const compiledScene: CompiledScene = {
        sceneId: scene.sceneId,
        sceneNumber: scene.sceneNumber,
        chapterId: scene.chapterId,
        title: scene.title,
        startFrame,
        endFrame,
        durationFrames,
        imagePath: scene.visual.image,
        fit: (scene.visual.fit as FitMode) ?? "cover",
        crop: scene.visual.crop ?? null,
        camera: {
          effect: (scene.camera?.effect as CameraEffect) ?? "slow_zoom_in",
          intensity: scene.camera?.intensity ?? 0.08,
          origin: scene.camera?.origin ?? "center",
        },
        transition: {
          type: (scene.transition?.type as TransitionType) ?? "cross_dissolve",
          durationFrames: transFrames,
          overlapFrames,
        },
      };

      compiledScenes.push(compiledScene);
    }

    const totalDurationFrames = currentTimelineFrame;
    const totalDurationSeconds = framesToSeconds(totalDurationFrames, fps);

    // 4. Compile audio tracks on the global timeline
    const audioMix = await this.audioMgr.getAudioMix(projectId);

    const compiledVoiceTracks: CompiledVoiceTrack[] = [];
    for (const vt of audioMix.voiceTracks) {
      const sceneStart = sceneStartFrameMap.get(vt.sceneId);
      if (sceneStart !== undefined) {
        const durFrames = secondsToFrames(vt.durationSeconds, fps);
        compiledVoiceTracks.push({
          eventId: vt.eventId,
          sceneId: vt.sceneId,
          file: vt.file,
          startFrame: sceneStart,
          durationFrames: durFrames,
          volume: vt.volume,
          fadeInFrames: secondsToFrames(vt.fadeInSeconds, fps),
          fadeOutFrames: secondsToFrames(vt.fadeOutSeconds, fps),
        });
      }
    }

    const compiledSoundEffects: CompiledSoundEffect[] = [];
    for (const sfx of audioMix.soundEffects) {
      let startFrame = secondsToFrames(sfx.startSeconds, fps);
      if (sfx.sceneId && sceneStartFrameMap.has(sfx.sceneId)) {
        startFrame = sceneStartFrameMap.get(sfx.sceneId)! + startFrame;
      }
      const durFrames = sfx.durationSeconds
        ? secondsToFrames(sfx.durationSeconds, fps)
        : secondsToFrames(2.0, fps);

      compiledSoundEffects.push({
        eventId: sfx.eventId,
        file: sfx.file,
        startFrame,
        durationFrames: durFrames,
        volume: sfx.volume,
        fadeInFrames: secondsToFrames(sfx.fadeInSeconds, fps),
        fadeOutFrames: secondsToFrames(sfx.fadeOutSeconds, fps),
        loop: sfx.loop,
      });
    }

    const compiledMusicBeds: CompiledMusicBed[] = [];
    for (const mb of audioMix.musicBeds) {
      const startFrame = secondsToFrames(mb.startSeconds, fps);
      const endFrame = mb.endSeconds
        ? secondsToFrames(mb.endSeconds, fps)
        : totalDurationFrames;

      compiledMusicBeds.push({
        trackId: mb.trackId,
        file: mb.file,
        startFrame,
        endFrame,
        durationFrames: Math.max(1, endFrame - startFrame),
        volume: mb.volume,
        fadeInFrames: secondsToFrames(mb.fadeInSeconds, fps),
        fadeOutFrames: secondsToFrames(mb.fadeOutSeconds, fps),
        loop: mb.loop,
        ducking: {
          enabled: mb.ducking?.enabled ?? true,
          duckedVolume: mb.ducking?.duckedVolume ?? 0.08,
          duckFadeFrames: secondsToFrames(mb.ducking?.duckFadeSeconds ?? 0.5, fps),
        },
      });
    }

    const renderScale =
      options?.mode === "draft"
        ? project.settings.draftScale
        : 1.0;

    const manifest: RenderManifest = {
      schemaVersion: 1,
      projectId,
      title: project.name,
      width: Math.round(project.settings.width * renderScale),
      height: Math.round(project.settings.height * renderScale),
      fps,
      totalDurationFrames,
      totalDurationSeconds,
      scenes: compiledScenes,
      audio: {
        masterVolume: audioMix.masterVolume,
        voiceTracks: compiledVoiceTracks,
        soundEffects: compiledSoundEffects,
        musicBeds: compiledMusicBeds,
      },
      metadata: {
        compiledAt: new Date().toISOString(),
        mode: options?.mode ?? "final",
        renderScale,
      },
    };

    const validated = RenderManifestSchema.parse(manifest);
    await atomicWriteJson(this.getManifestPath(projectId), validated);

    // Update project checkpoints
    project.checkpoints.timelineCompiled = true;
    project.status = "TIMELINE_READY";
    await this.pm.saveProject(project);

    logger.info(
      `Timeline compiled: ${compiledScenes.length} scenes, total frames: ${totalDurationFrames} (${totalDurationSeconds}s @ ${fps}fps)`,
      { projectId, stage: "TIMELINE" }
    );

    return validated;
  }

  async validateTimeline(projectId: string): Promise<TimelineValidationReport> {
    const root = this.pm.getProjectRoot(projectId);
    const manifest = await this.getRenderManifest(projectId);
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check scenes and assets
    for (const sc of manifest.scenes) {
      const fullImg = path.join(root, sc.imagePath);
      if (!existsSync(fullImg)) {
        errors.push(`Scene "${sc.sceneId}" image file not found: ${sc.imagePath}`);
      }
      if (sc.durationFrames <= 0) {
        errors.push(`Scene "${sc.sceneId}" has non-positive durationFrames: ${sc.durationFrames}`);
      }
      if (sc.startFrame < 0 || sc.endFrame <= sc.startFrame) {
        errors.push(
          `Scene "${sc.sceneId}" has invalid frame range: [${sc.startFrame}, ${sc.endFrame}]`
        );
      }
    }

    // Check audio files
    for (const vt of manifest.audio.voiceTracks) {
      const fullAudio = path.join(root, vt.file);
      if (!existsSync(fullAudio)) {
        errors.push(`Voice track "${vt.eventId}" file not found: ${vt.file}`);
      }
    }
    for (const sfx of manifest.audio.soundEffects) {
      const fullSfx = path.join(root, sfx.file);
      if (!existsSync(fullSfx)) {
        errors.push(`Sound effect "${sfx.eventId}" file not found: ${sfx.file}`);
      }
    }
    for (const mb of manifest.audio.musicBeds) {
      const fullMusic = path.join(root, mb.file);
      if (!existsSync(fullMusic)) {
        errors.push(`Music bed "${mb.trackId}" file not found: ${mb.file}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sceneCount: manifest.scenes.length,
      totalDurationFrames: manifest.totalDurationFrames,
      totalDurationSeconds: manifest.totalDurationSeconds,
    };
  }
}

