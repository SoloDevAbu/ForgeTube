import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import { AssetManager } from "../assets/assetManager.js";
import { StageGraph } from "../pipeline/stageGraph.js";
import {
  CalibrationManifestSchema,
  type CalibrationManifest,
  type SceneCalibration,
} from "../schemas/calibration.js";
import { atomicWriteFile, atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { ValidationError, AssetError } from "../../shared/errors.js";
import { Logger } from "../../shared/logger.js";
import { computeCropParameters, validateCropAspect, validateNormalizedCrop } from "./cropMath.js";
import type { NormalizedCrop, SceneRecord } from "../schemas/storyboard.js";
import type { FitMode } from "../../shared/types.js";

/** Default zoom that takes the corner sparkle out of frame. Tune against real images. */
export const GEMINI_WATERMARK_ZOOM = 1.1;
const SHEET_COLUMNS = 6;
const SHEET_ROWS = 5;
const WINDOWS_FONT = "C:/Windows/Fonts/arial.ttf";

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { shell: false, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf-8")));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new AssetError(`FFmpeg failed: ${stderr.slice(-800)}`))
    );
    child.on("error", (err) => reject(new AssetError(`Failed to spawn ffmpeg: ${err.message}`)));
  });
}

export class CalibrationManager {
  private pm: ProjectManager;
  private assets: AssetManager;
  private stages: StageGraph;

  constructor(pm?: ProjectManager) {
    this.pm = pm ?? new ProjectManager();
    this.assets = new AssetManager(this.pm);
    this.stages = new StageGraph(this.pm);
  }

  getCalibrationPath(projectId: string): string {
    return path.join(this.pm.getProjectRoot(projectId), "editing", "calibration.json");
  }

  private scenesPath(projectId: string): string {
    return path.join(this.pm.getProjectRoot(projectId), "storyboard", "scenes.json");
  }

  private async loadScenes(projectId: string): Promise<{ scenes: SceneRecord[] }> {
    const p = this.scenesPath(projectId);
    if (!existsSync(p)) throw new ValidationError(`Storyboard scenes not found for project "${projectId}".`);
    return readJsonFile(p);
  }

  async getCalibrationManifest(projectId: string): Promise<CalibrationManifest> {
    const p = this.getCalibrationPath(projectId);
    if (!existsSync(p)) {
      return { schemaVersion: 1, scenes: {}, updatedAt: new Date().toISOString() };
    }
    const raw = await readJsonFile(p);
    return CalibrationManifestSchema.parse(raw);
  }

  async saveCalibrationManifest(projectId: string, manifest: CalibrationManifest): Promise<void> {
    manifest.updatedAt = new Date().toISOString();
    const validated = CalibrationManifestSchema.parse(manifest);
    await atomicWriteJson(this.getCalibrationPath(projectId), validated);
  }

  private applyToScene(scene: SceneRecord, fit: FitMode, crop: NormalizedCrop | null, pos: { x: number; y: number }, zoom: number) {
    scene.visual.fit = fit;
    scene.visual.crop = crop;
    scene.visual.position = pos;
    scene.visual.zoom = zoom;
    scene.status.calibration = "calibrated";
  }

  private record(scene: SceneRecord): SceneCalibration {
    return {
      sceneId: scene.sceneId,
      sourceImage: scene.visual.image,
      fit: scene.visual.fit,
      crop: scene.visual.crop,
      position: scene.visual.position ?? { x: 0.5, y: 0.5 },
      scale: scene.visual.zoom ?? 1,
      previewStillPath: null,
      status: "calibrated",
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Adjusts one scene's framing. Use posX/posY/scale to nudge the 16:9 window,
   * or an explicit crop, which must itself be 16:9.
   */
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
    const data = await this.loadScenes(projectId);
    const scene = data.scenes.find((s) => s.sceneId === sceneId);
    if (!scene) throw new ValidationError(`Scene "${sceneId}" not found in project "${projectId}".`);

    const project = await this.pm.loadProject(projectId);
    const fit: FitMode = options.fit ?? (options.x !== undefined ? "manual" : "cover");
    let crop: NormalizedCrop | null = null;

    if (fit === "manual") {
      if (
        options.x === undefined ||
        options.y === undefined ||
        options.width === undefined ||
        options.height === undefined
      ) {
        throw new ValidationError("A manual crop needs x, y, width and height.");
      }
      crop = { x: options.x, y: options.y, width: options.width, height: options.height };
      validateNormalizedCrop(crop);
      const { width, height } = await this.assets.getImageSize(projectId, scene.visual.image);
      validateCropAspect(crop, width, height, project.settings.width / project.settings.height);
    }

    const position = {
      x: options.posX ?? scene.visual.position?.x ?? 0.5,
      y: options.posY ?? scene.visual.position?.y ?? 0.5,
    };
    this.applyToScene(scene, fit, crop, position, options.scale ?? scene.visual.zoom ?? 1);
    await atomicWriteJson(this.scenesPath(projectId), data);

    const manifest = await this.getCalibrationManifest(projectId);
    const record = this.record(scene);
    manifest.scenes[sceneId] = record;
    await this.saveCalibrationManifest(projectId, manifest);
    await this.stages.markBuilt(projectId, "images");
    return record;
  }

  async resetCalibration(projectId: string, sceneId: string): Promise<SceneCalibration> {
    return this.setCalibration(projectId, sceneId, { fit: "cover", posX: 0.5, posY: 0.5, scale: 1 });
  }

  /** Frames every scene that has an image, leaving hand-set crops alone unless asked. */
  async applyPreset(
    projectId: string,
    preset: string,
    options?: { zoom?: number; x?: number; y?: number; includeManual?: boolean }
  ): Promise<{ applied: number; skipped: string[] }> {
    if (preset !== "gemini-watermark") throw new ValidationError(`Unknown preset "${preset}".`);
    const root = this.pm.getProjectRoot(projectId);
    const data = await this.loadScenes(projectId);
    const manifest = await this.getCalibrationManifest(projectId);
    const zoom = options?.zoom ?? GEMINI_WATERMARK_ZOOM;
    const position = { x: options?.x ?? 0.5, y: options?.y ?? 0.5 };

    let applied = 0;
    const skipped: string[] = [];
    for (const scene of data.scenes) {
      const hasImage = existsSync(path.join(root, scene.visual.image));
      const handSet = scene.visual.fit === "manual" && scene.visual.crop && !options?.includeManual;
      if (!hasImage || handSet) {
        skipped.push(scene.sceneId);
        continue;
      }
      this.applyToScene(scene, "cover", null, position, zoom);
      manifest.scenes[scene.sceneId] = this.record(scene);
      applied++;
    }

    await atomicWriteJson(this.scenesPath(projectId), data);
    await this.saveCalibrationManifest(projectId, manifest);
    await this.stages.markBuilt(projectId, "images");
    return { applied, skipped };
  }

  private async resolvePixelCrop(projectId: string, scene: SceneRecord) {
    const project = await this.pm.loadProject(projectId);
    const { width, height } = await this.assets.getImageSize(projectId, scene.visual.image);
    return computeCropParameters({
      sourceWidth: width,
      sourceHeight: height,
      targetWidth: project.settings.width,
      targetHeight: project.settings.height,
      fit: scene.visual.fit as FitMode,
      manualCrop: scene.visual.crop,
      position: scene.visual.position,
      zoom: scene.visual.zoom,
    });
  }

  /** Preview still built from the same crop values the renderer receives. */
  async generateCalibrationPreview(
    projectId: string,
    sceneId: string
  ): Promise<{ previewPath: string; cropParams: any }> {
    const root = this.pm.getProjectRoot(projectId);
    const project = await this.pm.loadProject(projectId);
    const { scenes } = await this.loadScenes(projectId);
    const scene = scenes.find((s) => s.sceneId === sceneId);
    if (!scene) throw new ValidationError(`Scene "${sceneId}" not found.`);

    const imageFullPath = path.join(root, scene.visual.image);
    if (!existsSync(imageFullPath)) {
      throw new AssetError(`Source image not found for scene "${sceneId}": ${scene.visual.image}`);
    }

    const cropParams = await this.resolvePixelCrop(projectId, scene);
    const previewDir = path.join(root, "render", "preview");
    await fs.mkdir(previewDir, { recursive: true });
    const previewFilename = `${sceneId}_preview.png`;
    const previewPath = path.join(previewDir, previewFilename);

    const { x, y, width, height } = cropParams.pixelCrop;
    const filter = `crop=${width}:${height}:${x}:${y},scale=${project.settings.width}:${project.settings.height}`;
    await runFfmpeg(["-y", "-i", imageFullPath, "-vf", filter, "-frames:v", "1", "-update", "1", previewPath]);

    const manifest = await this.getCalibrationManifest(projectId);
    if (manifest.scenes[sceneId]) {
      manifest.scenes[sceneId]!.previewStillPath = `render/preview/${previewFilename}`;
      await this.saveCalibrationManifest(projectId, manifest);
    }
    return { previewPath, cropParams };
  }

  /** Labelled sheets of every crop, 30 to a sheet, for review at a glance. */
  async generateContactSheets(projectId: string): Promise<{ sheets: string[]; missing: string[] }> {
    const root = this.pm.getProjectRoot(projectId);
    const { scenes } = await this.loadScenes(projectId);
    const outDir = path.join(root, "render", "preview", "contact");
    await fs.mkdir(outDir, { recursive: true });

    const ready = scenes.filter((s) => existsSync(path.join(root, s.visual.image)));
    const missing = scenes.filter((s) => !ready.includes(s)).map((s) => s.sceneId);
    const perSheet = SHEET_COLUMNS * SHEET_ROWS;
    const sheets: string[] = [];

    for (let i = 0; i < ready.length; i += perSheet) {
      const group = ready.slice(i, i + perSheet);
      const filters: string[] = [];
      const inputs: string[] = [];

      for (const [n, scene] of group.entries()) {
        inputs.push("-i", path.join(root, scene.visual.image));
        const { x, y, width, height } = (await this.resolvePixelCrop(projectId, scene)).pixelCrop;
        const label = existsSync(WINDOWS_FONT)
          ? `,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='${scene.sceneId}':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6`
          : "";
        filters.push(`[${n}:v]crop=${width}:${height}:${x}:${y},scale=320:180${label},setsar=1[t${n}]`);
      }
      const pads = group.map((_, n) => `[t${n}]`).join("");
      filters.push(`${pads}xstack=inputs=${group.length}:layout=${this.gridLayout(group.length)}:fill=black[out]`);

      const scriptPath = path.join(outDir, `.sheet_${i}.txt`);
      await atomicWriteFile(scriptPath, filters.join(";\n"));
      const sheet = path.join(outDir, `sheet_${String(i / perSheet + 1).padStart(2, "0")}.jpg`);
      const single = group.length === 1;
      await runFfmpeg([
        "-y",
        ...inputs,
        ...(single
          ? ["-filter_complex", filters[0]!.replace(/\[t0\]$/, "[out]")]
          : ["-/filter_complex", scriptPath]),
        "-map",
        "[out]",
        "-frames:v",
        "1",
        "-update",
        "1",
        "-q:v",
        "3",
        sheet,
      ]);
      await fs.rm(scriptPath, { force: true });
      sheets.push(sheet);
    }
    return { sheets, missing };
  }

  private gridLayout(count: number): string {
    const cells: string[] = [];
    for (let n = 0; n < count; n++) {
      cells.push(`${(n % SHEET_COLUMNS) * 320}_${Math.floor(n / SHEET_COLUMNS) * 180}`);
    }
    return cells.join("|");
  }

  async validateCalibration(projectId: string): Promise<{ valid: boolean; errors: string[] }> {
    const { scenes } = await this.loadScenes(projectId).catch(() => ({ scenes: null as SceneRecord[] | null }));
    if (!scenes) return { valid: false, errors: ["Storyboard scenes not found."] };

    const root = this.pm.getProjectRoot(projectId);
    const project = await this.pm.loadProject(projectId);
    const aspect = project.settings.width / project.settings.height;
    const errors: string[] = [];

    for (const sc of scenes) {
      if (sc.visual.fit === "manual" && !sc.visual.crop) {
        errors.push(`Scene "${sc.sceneId}" has manual fit but no crop coordinates.`);
      }
      if (sc.visual.crop) {
        try {
          validateNormalizedCrop(sc.visual.crop);
          if (existsSync(path.join(root, sc.visual.image))) {
            const { width, height } = await this.assets.getImageSize(projectId, sc.visual.image);
            validateCropAspect(sc.visual.crop, width, height, aspect);
          }
        } catch (err: any) {
          errors.push(`Scene "${sc.sceneId}" has invalid crop: ${err.message}`);
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }

  async approveCalibration(projectId: string): Promise<void> {
    const val = await this.validateCalibration(projectId);
    if (!val.valid) throw new ValidationError(`Cannot approve calibration:\n${val.errors.join("\n")}`);

    await this.stages.markBuilt(projectId, "images");
    const project = await this.pm.loadProject(projectId);
    project.checkpoints.calibrationApproved = true;
    if (project.status === "ASSETS_IMPORTED") project.status = "CALIBRATION_COMPLETE";
    await this.pm.saveProject(project);
    await this.stages.markApproved(projectId, "images");

    new Logger(path.join(this.pm.getProjectRoot(projectId), "logs", "project.log")).info(
      "Image calibration approved for all scenes",
      { projectId, stage: "CALIBRATION" }
    );
  }
}
