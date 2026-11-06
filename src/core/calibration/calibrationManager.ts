import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import {
  CalibrationManifestSchema,
  type CalibrationManifest,
  type SceneCalibration,
} from "../schemas/calibration.js";
import { atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { ValidationError, AssetError } from "../../shared/errors.js";
import { Logger } from "../../shared/logger.js";
import { computeCropParameters, validateNormalizedCrop } from "./cropMath.js";
import { inspectMedia } from "../assets/mediaInspector.js";
import type { SceneRecord } from "../schemas/storyboard.js";
import type { FitMode } from "../../shared/types.js";
import type { NormalizedCrop } from "../schemas/storyboard.js";

export class CalibrationManager {
  private pm: ProjectManager;

  constructor(pm?: ProjectManager) {
    this.pm = pm ?? new ProjectManager();
  }

  getCalibrationPath(projectId: string): string {
    return path.join(this.pm.getProjectRoot(projectId), "editing", "calibration.json");
  }

  async getCalibrationManifest(projectId: string): Promise<CalibrationManifest> {
    const p = this.getCalibrationPath(projectId);
    if (!existsSync(p)) {
      return {
        schemaVersion: 1,
        scenes: {},
        updatedAt: new Date().toISOString(),
      };
    }
    const raw = await readJsonFile(p);
    return CalibrationManifestSchema.parse(raw);
  }

  async saveCalibrationManifest(projectId: string, manifest: CalibrationManifest): Promise<void> {
    manifest.updatedAt = new Date().toISOString();
    const validated = CalibrationManifestSchema.parse(manifest);
    await atomicWriteJson(this.getCalibrationPath(projectId), validated);
  }

  async setCalibration(
    projectId: string,
    sceneId: string,
    options: {
      fit?: FitMode;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      posX?: number;
      posY?: number;
      scale?: number;
    }
  ): Promise<SceneCalibration> {
    const root = this.pm.getProjectRoot(projectId);
    const scenesPath = path.join(root, "storyboard", "scenes.json");
    if (!existsSync(scenesPath)) {
      throw new ValidationError(`Storyboard scenes not found for project "${projectId}".`);
    }

    const scenesData = await readJsonFile<{ scenes: SceneRecord[] }>(scenesPath);
    const scene = scenesData.scenes.find((s) => s.sceneId === sceneId);
    if (!scene) {
      throw new ValidationError(`Scene "${sceneId}" not found in project "${projectId}".`);
    }

    const fit: FitMode = options.fit ?? "manual";
    let crop: NormalizedCrop | null = null;

    if (fit === "manual") {
      if (
        options.x === undefined ||
        options.y === undefined ||
        options.width === undefined ||
        options.height === undefined
      ) {
        throw new ValidationError("Manual fit mode requires --x, --y, --width, and --height parameters.");
      }
      crop = {
        x: options.x,
        y: options.y,
        width: options.width,
        height: options.height,
      };
      validateNormalizedCrop(crop);
    }

    const manifest = await this.getCalibrationManifest(projectId);
    const calibRecord: SceneCalibration = {
      sceneId,
      sourceImage: scene.visual.image,
      fit,
      crop,
      position: {
        x: options.posX ?? 0.5,
        y: options.posY ?? 0.5,
      },
      scale: options.scale ?? 1.0,
      previewStillPath: null,
      status: "calibrated",
      updatedAt: new Date().toISOString(),
    };

    manifest.scenes[sceneId] = calibRecord;
    await this.saveCalibrationManifest(projectId, manifest);

    // Update scene record
    scene.visual.fit = fit;
    scene.visual.crop = crop;
    scene.status.calibration = "calibrated";
    await atomicWriteJson(scenesPath, scenesData);

    return calibRecord;
  }

  async resetCalibration(projectId: string, sceneId: string): Promise<SceneCalibration> {
    return this.setCalibration(projectId, sceneId, { fit: "cover" });
  }

  /**
   * Generates a 16:9 preview still for a calibrated scene using the exact same crop math as the Remotion renderer.
   */
  async generateCalibrationPreview(
    projectId: string,
    sceneId: string
  ): Promise<{ previewPath: string; cropParams: any }> {
    const root = this.pm.getProjectRoot(projectId);
    const project = await this.pm.loadProject(projectId);
    const scenesPath = path.join(root, "storyboard", "scenes.json");
    const scenesData = await readJsonFile<{ scenes: SceneRecord[] }>(scenesPath);
    const scene = scenesData.scenes.find((s) => s.sceneId === sceneId);

    if (!scene) {
      throw new ValidationError(`Scene "${sceneId}" not found.`);
    }

    const imageFullPath = path.join(root, scene.visual.image);
    if (!existsSync(imageFullPath)) {
      throw new AssetError(`Source image not found for scene "${sceneId}": ${scene.visual.image}`);
    }

    // Inspect source dimensions
    const meta = await inspectMedia(imageFullPath);
    if (!meta.width || !meta.height) {
      throw new AssetError(`Unable to determine dimensions for image: ${imageFullPath}`);
    }

    // Compute exact crop parameters
    const cropParams = computeCropParameters({
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      targetWidth: project.settings.width,
      targetHeight: project.settings.height,
      fit: scene.visual.fit as FitMode,
      manualCrop: scene.visual.crop,
    });

    const previewDir = path.join(root, "render", "preview");
    await fs.mkdir(previewDir, { recursive: true });
    const previewFilename = `${sceneId}_preview.png`;
    const previewPath = path.join(previewDir, previewFilename);

    // Render preview still using FFmpeg crop filter
    const { x, y, width, height } = cropParams.pixelCrop;
    const filter = `crop=${width}:${height}:${x}:${y},scale=${project.settings.width}:${project.settings.height}`;

    await new Promise<void>((resolve, reject) => {
      const args = ["-y", "-i", imageFullPath, "-vf", filter, previewPath];
      const child = spawn("ffmpeg", args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf-8");
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new AssetError(`FFmpeg preview still generation failed: ${stderr}`));
        } else {
          resolve();
        }
      });
      child.on("error", (err) => reject(new AssetError(`Failed to spawn ffmpeg: ${err.message}`)));
    });

    // Update calibration record preview path
    const manifest = await this.getCalibrationManifest(projectId);
    if (manifest.scenes[sceneId]) {
      manifest.scenes[sceneId]!.previewStillPath = `render/preview/${previewFilename}`;
      await this.saveCalibrationManifest(projectId, manifest);
    }

    return {
      previewPath,
      cropParams,
    };
  }

  async validateCalibration(projectId: string): Promise<{ valid: boolean; errors: string[] }> {
    const root = this.pm.getProjectRoot(projectId);
    const scenesPath = path.join(root, "storyboard", "scenes.json");
    if (!existsSync(scenesPath)) {
      return { valid: false, errors: ["Storyboard scenes not found."] };
    }

    const scenesData = await readJsonFile<{ scenes: SceneRecord[] }>(scenesPath);
    const manifest = await this.getCalibrationManifest(projectId);
    const errors: string[] = [];

    for (const sc of scenesData.scenes) {
      const calib = manifest.scenes[sc.sceneId];
      if (sc.visual.fit === "manual" && !sc.visual.crop) {
        errors.push(`Scene "${sc.sceneId}" has manual fit but no crop coordinates.`);
      }
      if (calib?.crop) {
        try {
          validateNormalizedCrop(calib.crop);
        } catch (err: any) {
          errors.push(`Scene "${sc.sceneId}" has invalid crop: ${err.message}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async approveCalibration(projectId: string): Promise<void> {
    const val = await this.validateCalibration(projectId);
    if (!val.valid) {
      throw new ValidationError(`Cannot approve calibration:\n${val.errors.join("\n")}`);
    }

    const project = await this.pm.loadProject(projectId);
    project.checkpoints.calibrationApproved = true;
    project.status = "CALIBRATION_COMPLETE";
    await this.pm.saveProject(project);

    const logger = new Logger(path.join(this.pm.getProjectRoot(projectId), "logs", "project.log"));
    logger.info("Image calibration approved for all scenes", { projectId, stage: "CALIBRATION" });
  }
}

