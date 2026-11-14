import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { projectFileName } from "../../shared/paths.js";
import { ProjectManager } from "../projects/projectManager.js";
import { TimelineCompiler } from "../timeline/timelineCompiler.js";
import { AudioMixer } from "../audio/mixer.js";
import { StageGraph, fingerprint } from "../pipeline/stageGraph.js";
import { JobManager, type JobRecord } from "../jobs/jobManager.js";
import { validateRenderOutput, type RenderValidationResult } from "./outputValidator.js";
import { planChunks, planSceneChunk, PROFILES, type QualityProfile, type RenderChunk } from "./chunkPlanner.js";
import { getRendererHash, runRenderWorker } from "./renderWorker.js";
import { atomicWriteFile, atomicWriteJson } from "../../shared/atomic.js";
import { RenderError, ValidationError } from "../../shared/errors.js";
import { Logger } from "../../shared/logger.js";
import type { RenderManifest } from "../schemas/renderManifest.js";
import type { RenderMode } from "../../shared/types.js";

export interface RenderServiceOptions {
  mode: RenderMode;
  sceneId?: string;
  force?: boolean;
  onProgress?: (progress: number) => void;
}

export interface RenderOutcome {
  outputPath: string;
  validation: RenderValidationResult;
  chunksRendered: number;
  chunksReused: number;
  warnings: string[];
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf-8")));
    child.on("error", (err) => reject(new RenderError(`Failed to spawn FFmpeg: ${err.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new RenderError(`FFmpeg failed (code ${code}): ${stderr.slice(-800)}`))
    );
  });
}

export class RenderService {
  private pm: ProjectManager;
  private tc: TimelineCompiler;
  private jm: JobManager;
  private mixer: AudioMixer;
  private stages: StageGraph;

  constructor(pm?: ProjectManager, tc?: TimelineCompiler, jm?: JobManager, mixer?: AudioMixer) {
    this.pm = pm ?? new ProjectManager();
    this.tc = tc ?? new TimelineCompiler(this.pm);
    this.jm = jm ?? new JobManager(this.pm);
    this.mixer = mixer ?? new AudioMixer(this.pm, this.tc);
    this.stages = new StageGraph(this.pm);
  }

  private async concurrency(projectId: string, profile: QualityProfile): Promise<number> {
    const project = await this.pm.loadProject(projectId);
    return Math.max(1, Math.round(project.settings.renderConcurrency * profile.concurrencyFactor));
  }

  /** Renders one frame of a scene for a quick look. */
  async renderSceneStill(projectId: string, sceneId: string, frameOffset = 0): Promise<string> {
    const root = this.pm.getProjectRoot(projectId);
    const manifest = await this.tc.compileTimeline(projectId);
    const scene = manifest.scenes.find((s) => s.sceneId === sceneId);
    if (!scene) throw new ValidationError(`Scene "${sceneId}" not found.`);
    if (!existsSync(path.join(root, scene.imagePath))) {
      throw new ValidationError(`Scene "${sceneId}" has no image yet.`);
    }

    const output = path.join(root, "render", "preview", `${sceneId}_still.png`);
    await runRenderWorker({
      projectId,
      assetsDir: path.join(root, "assets"),
      inputProps: manifest,
      concurrency: 1,
      workDir: path.join(root, "render", ".work"),
      tasks: [{ id: sceneId, type: "still", output, frame: scene.startFrame + frameOffset }],
    });
    return output;
  }

  /** Stops anything that shouldn't render. Final is strict; previews only need pictures. */
  private async checkReadiness(
    projectId: string,
    manifest: RenderManifest,
    options: RenderServiceOptions
  ): Promise<string[]> {
    const warnings: string[] = [];
    if (options.mode === "scene") return warnings;

    const report = await this.tc.validateTimeline(projectId);
    const isVoiceGap = (e: string) => e.includes("has no voice yet");
    const blocking = report.errors.filter((e) => options.mode === "final" || !isVoiceGap(e));
    if (blocking.length > 0) {
      throw new RenderError(`Cannot render:\n${blocking.join("\n")}`);
    }
    warnings.push(...report.errors, ...report.warnings);

    const mixCurrent = await this.mixer.isCurrent(projectId);
    if (options.mode === "draft") {
      if (!mixCurrent) warnings.push('The audio mix is missing or out of date. Run "audio mix" to hear changes.');
      return warnings;
    }

    if (options.force) return warnings;
    for (const stage of ["script", "storyboard", "images", "mix"] as const) {
      await this.stages.requireApproved(projectId, stage);
    }
    if (!mixCurrent) throw new RenderError('The audio mix is out of date. Run "audio mix", then "audio approve".');
    if (manifest.metadata.usesEstimatedTiming) throw new RenderError("Some narration has no voice.");

    const statuses = await this.stages.getStatus(projectId);
    const stale = statuses.filter((s) => s.stale && s.stage !== "render");
    if (stale.length > 0) {
      throw new RenderError(
        `Stale stages: ${stale.map((s) => `${s.stage} (changed: ${s.staleBecause.join(", ")})`).join("; ")}.`
      );
    }
    return warnings;
  }

  private outputPathFor(root: string, projectId: string, options: RenderServiceOptions): string {
    const name = projectFileName(this.pm.resolveId(projectId));
    if (options.mode === "final") return path.join(root, "render", "final", `${name}.mp4`);
    if (options.mode === "draft") return path.join(root, "render", "preview", `${name}_draft.mp4`);
    return path.join(root, "render", "preview", `${name}_${options.sceneId}.mp4`);
  }

  /** Stitches chunks and adds the mix. The previous output stays until the new one is complete. */
  private async assemble(
    root: string,
    chunkFiles: string[],
    workDir: string,
    outputPath: string,
    manifest: RenderManifest,
    range: { firstFrame: number; frames: number },
    mixPath: string | null
  ): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const listPath = path.join(workDir, `concat_${path.basename(outputPath)}.txt`);
    await atomicWriteFile(
      listPath,
      chunkFiles.map((f) => `file '${f.split(path.sep).join("/")}'`).join("\n") + "\n"
    );

    const partial = `${outputPath}.part.mp4`;
    const seconds = range.frames / manifest.fps;
    const audio = mixPath
      ? ["-ss", (range.firstFrame / manifest.fps).toFixed(3), "-t", seconds.toFixed(3), "-i", mixPath]
      : [];
    await runFfmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      ...audio,
      "-map",
      "0:v:0",
      ...(mixPath ? ["-map", "1:a:0", "-c:a", "aac", "-b:a", "256k"] : []),
      "-c:v",
      "copy",
      "-movflags",
      "+faststart",
      partial,
    ]);
    await fs.rename(partial, outputPath);
    await fs.rm(listPath, { force: true });
  }

  /**
   * Renders silent chunks that are stored by content hash, then stitches them
   * and adds the mix. A crash loses only the chunk in progress, and an
   * audio-only change renders no video at all.
   */
  async renderVideo(projectId: string, options: RenderServiceOptions): Promise<RenderOutcome> {
    if (options.mode === "scene" && !options.sceneId) {
      throw new ValidationError("Scene mode needs a scene ID.");
    }

    const root = this.pm.getProjectRoot(projectId);
    const logger = new Logger(path.join(root, "render", "render.log"));
    await this.jm.recoverStaleJobs(projectId);

    const manifest = await this.tc.compileTimeline(projectId);
    const warnings = await this.checkReadiness(projectId, manifest, options);

    const jobId = `job_render_${Date.now()}`;
    const job: JobRecord = {
      jobId,
      projectId,
      type: "render",
      mode: options.mode,
      status: "running",
      progress: 0,
      outputPath: null,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      metadata: { sceneId: options.sceneId, pid: process.pid },
    };
    await this.jm.recordJob(job);
    if (options.mode === "final") await this.pm.updateState(projectId, "RENDERING");

    try {
      const profile = options.mode === "final" ? PROFILES.final : PROFILES.draft;
      const rendererHash = await getRendererHash();

      let chunks: RenderChunk[];
      if (options.mode === "scene") {
        const scene = manifest.scenes.find((s) => s.sceneId === options.sceneId);
        if (!scene) throw new ValidationError(`Scene "${options.sceneId}" not found.`);
        if (!existsSync(path.join(root, scene.imagePath))) {
          throw new ValidationError(`Scene "${options.sceneId}" has no image yet.`);
        }
        chunks = [planSceneChunk(manifest, scene, profile, rendererHash, root)];
      } else {
        chunks = planChunks(manifest, profile, rendererHash, root);
      }

      const chunkDir = path.join(root, "render", "chunks", profile.name);
      await fs.mkdir(chunkDir, { recursive: true });
      const fileFor = (chunk: RenderChunk) => path.join(chunkDir, `${chunk.hash}.mp4`);
      const missing = chunks.filter((c) => !existsSync(fileFor(c)));

      const totalFrames = chunks.reduce((sum, c) => sum + c.frames, 0);
      const inProgress = new Map<string, number>();
      let doneFrames = totalFrames - missing.reduce((sum, c) => sum + c.frames, 0);
      const report = () => {
        const frames = doneFrames + [...inProgress.values()].reduce((a, b) => a + b, 0);
        const progress = frames / totalFrames;
        options.onProgress?.(progress);
        this.jm.updateJobProgress(projectId, jobId, progress, { renderedFrames: frames });
      };
      report();

      logger.info(`Render ${jobId}: ${missing.length} of ${chunks.length} chunks to render`, {
        projectId,
        stage: "RENDER",
        jobId,
      });

      if (missing.length > 0) {
        await runRenderWorker({
          projectId,
          assetsDir: path.join(root, "assets"),
          inputProps: manifest,
          concurrency: await this.concurrency(projectId, profile),
          workDir: path.join(root, "render", ".work"),
          tasks: missing.map((chunk) => ({
            id: chunk.id,
            type: "video",
            output: fileFor(chunk),
            frameRange: [chunk.firstFrame, chunk.lastFrame],
            scale: profile.scale,
            crf: profile.crf,
            x264Preset: profile.x264Preset,
            jpegQuality: profile.jpegQuality,
          })),
          onProgress: (taskId, renderedFrames) => {
            inProgress.set(taskId, renderedFrames);
            report();
          },
          onTaskDone: (taskId) => {
            doneFrames += chunks.find((c) => c.id === taskId)?.frames ?? 0;
            inProgress.delete(taskId);
            report();
          },
        });
      }

      const mixPath = this.mixer.getMixPath(projectId);
      const useMix = existsSync(mixPath) && (await this.mixer.isCurrent(projectId));
      const outputPath = this.outputPathFor(root, projectId, options);
      const range = { firstFrame: chunks[0]!.firstFrame, frames: totalFrames };

      await this.assemble(
        root,
        chunks.map(fileFor),
        chunkDir,
        outputPath,
        manifest,
        range,
        useMix ? mixPath : null
      );

      const validation = await validateRenderOutput(outputPath, {
        frames: totalFrames,
        fps: manifest.fps,
        width: Math.round(manifest.width * profile.scale),
        height: Math.round(manifest.height * profile.scale),
        expectAudio: useMix,
      });

      await this.jm.completeJob(projectId, jobId, outputPath, {
        fileSizeBytes: validation.fileSizeBytes,
        durationSeconds: validation.durationSeconds,
      });

      if (options.mode === "final") {
        const mix = await this.mixer.getRecord(projectId);
        await atomicWriteJson(path.join(root, "render", "final", "render.json"), {
          inputHash: fingerprint({ chunks: chunks.map((c) => c.hash), mix: mix?.inputHash ?? null }),
          renderedAt: new Date().toISOString(),
        });
        await this.stages.markBuilt(projectId, "render");
        await this.pm.updateState(projectId, "RENDERED");
      }

      return {
        outputPath,
        validation,
        chunksRendered: missing.length,
        chunksReused: chunks.length - missing.length,
        warnings,
      };
    } catch (err: any) {
      logger.error(`Render failed: ${err.message}`, { projectId, stage: "RENDER", jobId });
      await this.jm.failJob(projectId, jobId, err.message);
      if (options.mode === "final") await this.pm.updateState(projectId, "FAILED");
      throw err instanceof RenderError || err instanceof ValidationError
        ? err
        : new RenderError(`Rendering failed: ${err.message}`);
    }
  }
}
