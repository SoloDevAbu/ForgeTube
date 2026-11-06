import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import { AudioManager } from "../audio/audioManager.js";
import { AssetManager } from "../assets/assetManager.js";
import { StageGraph } from "../pipeline/stageGraph.js";
import {
  RenderManifestSchema,
  type RenderManifest,
  type CompiledScene,
  type CompiledVoiceTrack,
  type CompiledSoundEffect,
  type CompiledChapter,
} from "../schemas/renderManifest.js";
import { atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { TimelineError } from "../../shared/errors.js";
import { Logger } from "../../shared/logger.js";
import { secondsToFrames, framesToSeconds } from "./timeMath.js";
import {
  computeShotTiming,
  findShotLengthIssues,
  type SegmentTiming,
  type ShotInput,
} from "./shotTiming.js";
import { autoCameraIntensity } from "../storyboard/storyboardFormat.js";
import { computeCropParameters } from "../calibration/cropMath.js";
import { alignWordStarts, readVoiceTake } from "../audio/tts/voiceTake.js";
import { countWords } from "../script/scriptFormat.js";
import { ScriptManifestSchema } from "../schemas/script.js";
import type { SceneRecord } from "../schemas/storyboard.js";
import type { FitMode, CameraEffect } from "../../shared/types.js";

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
  private assets: AssetManager;
  private stages: StageGraph;

  constructor(pm?: ProjectManager, audioMgr?: AudioManager) {
    this.pm = pm ?? new ProjectManager();
    this.audioMgr = audioMgr ?? new AudioManager(this.pm);
    this.assets = new AssetManager(this.pm);
    this.stages = new StageGraph(this.pm);
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

  private async loadScenes(projectId: string): Promise<{ scenes: SceneRecord[]; [key: string]: unknown }> {
    const scenesPath = path.join(this.pm.getProjectRoot(projectId), "storyboard", "scenes.json");
    if (!existsSync(scenesPath)) throw new TimelineError(`Storyboard scenes file not found at ${scenesPath}`);
    return readJsonFile(scenesPath);
  }

  /** Segments with their measured voice, and shots in film order. */
  async loadTimingInputs(projectId: string): Promise<{ segments: SegmentTiming[]; shots: ShotInput[] }> {
    const root = this.pm.getProjectRoot(projectId);
    const { scenes } = await this.loadScenes(projectId);
    if (scenes.length === 0) throw new TimelineError("Cannot compile timeline: no scenes in storyboard.");

    const script = ScriptManifestSchema.parse(await readJsonFile(path.join(root, "script", "narration.json")));
    const mix = await this.audioMgr.getAudioMix(projectId);

    const segments: SegmentTiming[] = [];
    for (const segment of script.chapters.flatMap((c) => c.segments)) {
      const wordCount = countWords(segment.text);
      const track = mix.voiceTracks.find((t) => t.segmentId === segment.segment_id);
      const take = track ? await readVoiceTake(root, track.file) : null;
      segments.push({
        segmentId: segment.segment_id,
        chapterId: segment.chapter_id,
        wordCount,
        voiceSeconds: track?.durationSeconds ?? null,
        wordStarts: take ? alignWordStarts(take.words, wordCount) : null,
      });
    }

    const known = new Set(segments.map((s) => s.segmentId));
    const shots: ShotInput[] = scenes.map((scene) => {
      const segmentId = scene.narrationSegmentIds[0];
      if (!segmentId || !known.has(segmentId)) {
        throw new TimelineError(`Scene "${scene.sceneId}" points at narration "${segmentId}", which is not in the script.`);
      }
      return {
        sceneId: scene.sceneId,
        segmentId,
        wordStart: scene.wordStart ?? null,
        wordEnd: scene.wordEnd ?? null,
        transitionType: scene.transition.type,
        transitionSeconds: scene.transition.durationSeconds,
        allowShort: scene.allowShort,
      };
    });

    return { segments: segments.filter((s) => shots.some((shot) => shot.segmentId === s.segmentId)), shots };
  }

  /**
   * Compiles the whole film into a frame-accurate manifest. Previews render a
   * frame range of this manifest, so nothing else ever rewrites it.
   */
  async compileTimeline(projectId: string): Promise<RenderManifest> {
    const root = this.pm.getProjectRoot(projectId);
    const project = await this.pm.loadProject(projectId);
    const { settings } = project;
    const { fps } = settings;

    const scenesData = await this.loadScenes(projectId);
    const { segments, shots } = await this.loadTimingInputs(projectId);
    const timing = computeShotTiming(segments, shots, {
      fps,
      speakingRateWpm: settings.speakingRateWpm,
      segmentGapSeconds: settings.segmentGapSeconds,
      chapterGapSeconds: settings.chapterGapSeconds,
    });
    const timedById = new Map(timing.shots.map((s) => [s.sceneId, s]));

    const compiledScenes: CompiledScene[] = [];
    for (const scene of scenesData.scenes) {
      const timed = timedById.get(scene.sceneId)!;
      const fit = (scene.visual.fit as FitMode) ?? "cover";
      let crop = scene.visual.crop ?? null;

      if (fit !== "contain" && existsSync(path.join(root, scene.visual.image))) {
        const { width, height } = await this.assets.getImageSize(projectId, scene.visual.image);
        crop = computeCropParameters({
          sourceWidth: width,
          sourceHeight: height,
          targetWidth: settings.width,
          targetHeight: settings.height,
          fit,
          manualCrop: scene.visual.crop,
          position: scene.visual.position,
          zoom: scene.visual.zoom,
        }).normalizedCrop;
      }

      const seconds = timed.durationFrames / fps;
      compiledScenes.push({
        sceneId: scene.sceneId,
        sceneNumber: scene.sceneNumber,
        chapterId: scene.chapterId,
        title: scene.title,
        startFrame: timed.startFrame,
        endFrame: timed.endFrame,
        durationFrames: timed.durationFrames,
        imagePath: scene.visual.image,
        fit,
        crop,
        camera: {
          effect: (scene.camera?.effect as CameraEffect) ?? "static",
          intensity: scene.camera?.intensity ?? autoCameraIntensity(seconds),
          origin: scene.camera?.origin ?? "center",
        },
        transition: {
          type: scene.transition.type,
          durationFrames: timed.transitionFrames,
          overlapFrames: timed.overlapFrames,
          fadeOutFrames: timed.fadeOutFrames,
          fadeOutColor: "#000000",
        },
      });

      // Each scene shows its real start, end and duration.
      scene.timeline = {
        startFrame: timed.startFrame,
        endFrame: timed.endFrame,
        durationFrames: timed.durationFrames,
        fps,
      };
    }

    const audioMix = await this.audioMgr.getAudioMix(projectId);
    const voiceTracks: CompiledVoiceTrack[] = [];
    for (const seg of timing.segments) {
      const track = audioMix.voiceTracks.find((t) => t.segmentId === seg.segmentId);
      if (!track) continue;
      voiceTracks.push({
        eventId: track.eventId,
        segmentId: seg.segmentId,
        file: track.file,
        startFrame: seg.startFrame,
        durationFrames: seg.voiceFrames,
        volume: track.volume,
        fadeInFrames: secondsToFrames(track.fadeInSeconds, fps),
        fadeOutFrames: secondsToFrames(track.fadeOutSeconds, fps),
      });
    }

    const soundEffects: CompiledSoundEffect[] = [];
    for (const sfx of audioMix.soundEffects) {
      const anchor = sfx.sceneId ? timedById.get(sfx.sceneId) : undefined;
      if (sfx.sceneId && !anchor) continue;
      soundEffects.push({
        eventId: sfx.eventId,
        file: sfx.file,
        startFrame: (anchor?.boundaryFrame ?? 0) + secondsToFrames(sfx.startSeconds, fps),
        durationFrames: secondsToFrames(sfx.durationSeconds ?? 2.0, fps),
        volume: sfx.volume,
        fadeInFrames: secondsToFrames(sfx.fadeInSeconds, fps),
        fadeOutFrames: secondsToFrames(sfx.fadeOutSeconds, fps),
        loop: sfx.loop,
      });
    }

    const chapters: CompiledChapter[] = [];
    for (const seg of timing.segments) {
      const last = chapters.at(-1);
      if (last?.chapterId === seg.chapterId) last.endFrame = seg.endFrame;
      else chapters.push({ chapterId: seg.chapterId, startFrame: seg.startFrame, endFrame: seg.endFrame });
    }

    const manifest: RenderManifest = {
      schemaVersion: 1,
      projectId,
      title: project.name,
      width: settings.width,
      height: settings.height,
      fps,
      totalDurationFrames: timing.totalFrames,
      totalDurationSeconds: framesToSeconds(timing.totalFrames, fps),
      scenes: compiledScenes,
      chapters,
      audio: { masterVolume: audioMix.masterVolume, voiceTracks, soundEffects, musicBeds: [] },
      metadata: {
        compiledAt: new Date().toISOString(),
        usesEstimatedTiming: timing.segments.some((s) => s.estimated),
      },
    };

    const validated = RenderManifestSchema.parse(manifest);
    await atomicWriteJson(this.getManifestPath(projectId), validated);
    await atomicWriteJson(path.join(root, "storyboard", "scenes.json"), scenesData);
    await this.stages.markBuilt(projectId, "timeline");

    project.checkpoints.timelineCompiled = true;
    if (project.status !== "RENDERING" && project.status !== "AUDIO_READY") project.status = "TIMELINE_READY";
    await this.pm.saveProject(project);

    new Logger(path.join(root, "logs", "project.log")).info(
      `Timeline compiled: ${compiledScenes.length} shots, ${timing.totalFrames} frames (${manifest.totalDurationSeconds}s @ ${fps}fps)`,
      { projectId, stage: "TIMELINE" }
    );
    return validated;
  }

  async validateTimeline(projectId: string): Promise<TimelineValidationReport> {
    const root = this.pm.getProjectRoot(projectId);
    const project = await this.pm.loadProject(projectId);
    const manifest = await this.getRenderManifest(projectId);
    const { settings } = project;
    const errors: string[] = [];
    const warnings: string[] = [];

    const inputs = await this.loadTimingInputs(projectId);
    for (const seg of inputs.segments) {
      if (seg.voiceSeconds === null) errors.push(`Narration "${seg.segmentId}" has no voice yet.`);
    }

    let frame = 0;
    for (const sc of manifest.scenes) {
      if (!existsSync(path.join(root, sc.imagePath))) {
        errors.push(`Scene "${sc.sceneId}" image file not found: ${sc.imagePath}`);
      }
      if (sc.durationFrames <= 0 || sc.endFrame <= sc.startFrame) {
        errors.push(`Scene "${sc.sceneId}" has invalid frame range: [${sc.startFrame}, ${sc.endFrame}]`);
      }
      if (sc.startFrame > frame) {
        errors.push(`Black gap before "${sc.sceneId}": frames ${frame} to ${sc.startFrame} have no picture.`);
      }
      frame = Math.max(frame, sc.endFrame);
    }

    const issues = findShotLengthIssues(
      { shots: manifest.scenes.map((s) => ({ ...s, boundaryFrame: s.startFrame, transitionFrames: 0, overlapFrames: 0, fadeOutFrames: 0 })), segments: [], totalFrames: manifest.totalDurationFrames },
      inputs.shots,
      { fps: settings.fps, maxSeconds: settings.maxShotSeconds, minSeconds: settings.minShotSeconds }
    );
    for (const issue of issues) {
      const text = `Scene "${issue.sceneId}" runs ${issue.seconds}s`;
      if (issue.kind === "too_long") {
        errors.push(`${text}, over the ${settings.maxShotSeconds}s limit. Run "storyboard rebalance".`);
      } else {
        warnings.push(`${text}, under the ${settings.minShotSeconds}s minimum.`);
      }
    }

    for (const vt of manifest.audio.voiceTracks) {
      if (!existsSync(path.join(root, vt.file))) errors.push(`Voice track "${vt.eventId}" file not found: ${vt.file}`);
    }
    for (const sfx of manifest.audio.soundEffects) {
      if (!existsSync(path.join(root, sfx.file))) errors.push(`Sound effect "${sfx.eventId}" file not found: ${sfx.file}`);
      if (sfx.startFrame >= manifest.totalDurationFrames) errors.push(`Sound effect "${sfx.eventId}" starts after the film ends.`);
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
