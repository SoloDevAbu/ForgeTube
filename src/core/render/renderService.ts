import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia, renderStill } from "@remotion/renderer";
import { ProjectManager } from "../projects/projectManager.js";
import { TimelineCompiler } from "../timeline/timelineCompiler.js";
import { JobManager, type JobRecord } from "../jobs/jobManager.js";
import { getLocalBrowserExecutable } from "./browserLocator.js";
import { validateRenderOutput, type RenderValidationResult } from "./outputValidator.js";
import { ensureAudioMuxed } from "./audioMuxer.js";
import { RenderError } from "../../shared/errors.js";
import { Logger } from "../../shared/logger.js";
import type { RenderMode } from "../../shared/types.js";

export interface RenderServiceOptions {
  mode: RenderMode;
  sceneId?: string;
  onProgress?: (progress: number) => void;
}

export class RenderService {
  private pm: ProjectManager;
  private tc: TimelineCompiler;
  private jm: JobManager;

  constructor(pm?: ProjectManager, tc?: TimelineCompiler, jm?: JobManager) {
    this.pm = pm ?? new ProjectManager();
    this.tc = tc ?? new TimelineCompiler(this.pm);
    this.jm = jm ?? new JobManager(this.pm);
  }

  /**
   * Renders a still frame of a single scene for instant visual inspection.
   */
  async renderSceneStill(
    projectId: string,
    sceneId: string,
    frameOffset = 0
  ): Promise<string> {
    const root = this.pm.getProjectRoot(projectId);
    const manifest = await this.tc.compileTimeline(projectId, {
      singleSceneId: sceneId,
      mode: "scene",
    });

    const browserExec = getLocalBrowserExecutable();
    const entryPoint = path.resolve(process.cwd(), "src", "renderer", "index.ts");

    const bundleLocation = await bundle({
      entryPoint,
      publicDir: root,
    });

    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "Documentary",
      inputProps: manifest,
      browserExecutable: browserExec,
    });

    const outputDir = path.join(root, "render", "preview");
    await fs.mkdir(outputDir, { recursive: true });
    const outputLocation = path.join(outputDir, `${sceneId}_still.png`);

    await renderStill({
      composition,
      serveUrl: bundleLocation,
      output: outputLocation,
      inputProps: manifest,
      frame: frameOffset,
      browserExecutable: browserExec,
    });

    return outputLocation;
  }

  /**
   * Renders a video: scene preview, draft MP4, or final high-quality MP4.
   */
  async renderVideo(
    projectId: string,
    options: RenderServiceOptions
  ): Promise<{ outputPath: string; validation: RenderValidationResult }> {
    const root = this.pm.getProjectRoot(projectId);
    const project = await this.pm.loadProject(projectId);
    const renderLogger = new Logger(path.join(root, "render", "render.log"));
    const projectLogger = new Logger(path.join(root, "logs", "project.log"));

    const jobId = `job_render_${Date.now()}`;
    const startedAt = new Date().toISOString();

    const jobRecord: JobRecord = {
      jobId,
      projectId,
      type: "render",
      mode: options.mode,
      status: "running",
      progress: 0.0,
      outputPath: null,
      error: null,
      startedAt,
      completedAt: null,
      metadata: { sceneId: options.sceneId },
    };
    await this.jm.recordJob(jobRecord);
    await this.pm.updateState(projectId, "RENDERING");

    renderLogger.info(`Starting render job [${jobId}] mode: ${options.mode}`, {
      projectId,
      stage: "RENDER",
      jobId,
    });

    let manifest;
    try {
      manifest = await this.tc.compileTimeline(projectId, {
        mode: options.mode,
        singleSceneId: options.mode === "scene" ? options.sceneId : undefined,
      });

      const valReport = await this.tc.validateTimeline(projectId);
      if (!valReport.valid) {
        throw new RenderError(
          `Cannot render video: timeline validation failed:\n${valReport.errors.join("\n")}`
        );
      }
    } catch (err: any) {
      await this.jm.failJob(projectId, jobId, err.message);
      await this.pm.updateState(projectId, "FAILED");
      throw err;
    }

    // Determine output file path
    let outputDir: string;
    let outputFilename: string;

    if (options.mode === "final") {
      outputDir = path.join(root, "render", "final");
      outputFilename = `${projectId}.mp4`;
    } else if (options.mode === "draft") {
      outputDir = path.join(root, "render", "preview");
      outputFilename = `${projectId}_draft.mp4`;
    } else {
      outputDir = path.join(root, "render", "preview");
      outputFilename = `${projectId}_${options.sceneId || "scene"}.mp4`;
    }

    await fs.mkdir(outputDir, { recursive: true });
    const outputLocation = path.join(outputDir, outputFilename);

    const browserExec = getLocalBrowserExecutable();
    const entryPoint = path.resolve(process.cwd(), "src", "renderer", "index.ts");

    renderLogger.info(`Bundling Remotion composition with publicDir=${root}...`, {
      projectId,
      stage: "RENDER",
      jobId,
    });

    let bundleLocation: string;
    try {
      bundleLocation = await bundle({
        entryPoint,
        publicDir: root,
      });
    } catch (err: any) {
      const msg = `Remotion bundling failed: ${err.message}`;
      renderLogger.error(msg, { projectId, stage: "RENDER", jobId });
      await this.jm.failJob(projectId, jobId, msg);
      await this.pm.updateState(projectId, "FAILED");
      throw new RenderError(msg);
    }

    try {
      const composition = await selectComposition({
        serveUrl: bundleLocation,
        id: "Documentary",
        inputProps: manifest,
        browserExecutable: browserExec,
      });

      renderLogger.info(
        `Rendering media: ${manifest.width}x${manifest.height} @ ${manifest.fps}fps, ${manifest.totalDurationFrames} frames`,
        { projectId, stage: "RENDER", jobId }
      );

      await renderMedia({
        composition,
        serveUrl: bundleLocation,
        codec: "h264",
        outputLocation,
        inputProps: manifest,
        browserExecutable: browserExec,
        concurrency: project.settings.renderConcurrency || 1,
        onProgress: ({ renderedFrames, encodedFrames }) => {
          const p = manifest.totalDurationFrames > 0 ? encodedFrames / manifest.totalDurationFrames : 0;
          options.onProgress?.(p);
          void this.jm.updateJobProgress(projectId, jobId, p, {
            renderedFrames,
            encodedFrames,
          });
        },
      });

      renderLogger.info(`Media rendering finished. Ensuring audio streams are muxed...`, {
        projectId,
        stage: "RENDER",
        jobId,
      });

      // Ensure audio streams are present in final media via FFmpeg if necessary
      await ensureAudioMuxed(outputLocation, manifest, root);

      renderLogger.info(`Validating output with ffprobe...`, {
        projectId,
        stage: "RENDER",
        jobId,
      });

      // Post-render FFprobe output validation
      const validation = await validateRenderOutput(outputLocation, manifest);

      await this.jm.completeJob(projectId, jobId, outputLocation, {
        fileSizeBytes: validation.fileSizeBytes,
        durationSeconds: validation.durationSeconds,
      });

      await this.pm.updateState(projectId, "RENDERED");
      projectLogger.info(`Render completed successfully: ${outputLocation}`, {
        projectId,
        stage: "RENDER",
        jobId,
      });

      return {
        outputPath: outputLocation,
        validation,
      };
    } catch (err: any) {
      const msg = `Rendering execution failed: ${err.message}`;
      renderLogger.error(msg, { projectId, stage: "RENDER", jobId });
      await this.jm.failJob(projectId, jobId, msg);
      await this.pm.updateState(projectId, "FAILED");
      throw new RenderError(msg);
    }
  }
}
