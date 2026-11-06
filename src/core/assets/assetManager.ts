import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import { StageGraph } from "../pipeline/stageGraph.js";
import {
  AssetManifestSchema,
  type AssetManifest,
  type AssetRecord,
} from "../schemas/assets.js";
import { atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { AssetError, ValidationError } from "../../shared/errors.js";
import { inspectMedia } from "./mediaInspector.js";
import type { SceneRecord } from "../schemas/storyboard.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MIN_RECOMMENDED_WIDTH = 1920;
const FRAME_ASPECT = 16 / 9;

export interface AssetValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  totalImportedAssets: number;
  totalScenes: number;
  missingScenes: string[];
  unusedAssets: string[];
}

export interface ImageImportRow {
  file: string;
  sceneId: string | null;
  result: "imported" | "duplicate" | "unmatched" | "unknown_scene" | "failed";
  relativePath: string | null;
  note: string;
}

export interface ImageImportResult {
  importedCount: number;
  importedAssets: AssetRecord[];
  rows: ImageImportRow[];
  missingScenes: string[];
}

/** True extension from the file's first bytes, whatever its name says. */
export async function detectImageExtension(filePath: string): Promise<string | null> {
  const handle = await fs.open(filePath, "r");
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(12), 0, 12, 0);
    if (bytesRead < 12) return null;
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return ".jpg";
    if (buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return ".webp";
    return null;
  } finally {
    await handle.close();
  }
}

async function listImageFiles(inputPath: string): Promise<string[]> {
  const stat = await fs.stat(inputPath);
  if (!stat.isDirectory()) {
    if (!IMAGE_EXTENSIONS.has(path.extname(inputPath).toLowerCase())) {
      throw new ValidationError(`File is not a supported image format (.png, .jpg, .jpeg, .webp): ${inputPath}`);
    }
    return [inputPath];
  }
  const entries = await fs.readdir(inputPath, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(e.parentPath, e.name));
}

/** Oldest first, so files line up with the order the prompts were run in. */
async function sortByFileTime(files: string[]): Promise<string[]> {
  const stats = await Promise.all(files.map(async (f) => ({ f, t: (await fs.stat(f)).mtimeMs })));
  return stats.sort((a, b) => a.t - b.t || a.f.localeCompare(b.f)).map((s) => s.f);
}

export class AssetManager {
  private pm: ProjectManager;
  private stages: StageGraph;

  constructor(pm?: ProjectManager) {
    this.pm = pm ?? new ProjectManager();
    this.stages = new StageGraph(this.pm);
  }

  getAssetsDir(projectId: string): string {
    return path.join(this.pm.getProjectRoot(projectId), "assets");
  }

  getManifestPath(projectId: string): string {
    return path.join(this.getAssetsDir(projectId), "manifest.json");
  }

  async getAssetManifest(projectId: string): Promise<AssetManifest> {
    const p = this.getManifestPath(projectId);
    if (!existsSync(p)) {
      return { schemaVersion: 1, assets: [], updatedAt: new Date().toISOString() };
    }
    const raw = await readJsonFile(p);
    return AssetManifestSchema.parse(raw);
  }

  async saveAssetManifest(projectId: string, manifest: AssetManifest): Promise<void> {
    manifest.updatedAt = new Date().toISOString();
    const validated = AssetManifestSchema.parse(manifest);
    await atomicWriteJson(this.getManifestPath(projectId), validated);
  }

  /**
   * Imports images as untouched originals, one folder per scene. A file goes to
   * a scene by --scene, then a scene_### name, then --order against the scenes
   * still missing an image. Re-imports add a version and never overwrite.
   */
  async importImages(
    projectId: string,
    options: { inputPath: string; sceneId?: string; order?: boolean; firstScene?: string }
  ): Promise<ImageImportResult> {
    const root = this.pm.getProjectRoot(projectId);
    if (!existsSync(options.inputPath)) {
      throw new ValidationError(`Input path not found: "${options.inputPath}"`);
    }
    const scenesPath = path.join(root, "storyboard", "scenes.json");
    if (!existsSync(scenesPath)) {
      throw new ValidationError(`Storyboard not found for project "${projectId}". Import it before images.`);
    }

    const files = await sortByFileTime(await listImageFiles(options.inputPath));
    if (files.length === 0) throw new ValidationError(`No valid image files found in: ${options.inputPath}`);

    const scenesData = await readJsonFile<{ scenes: SceneRecord[] }>(scenesPath);
    const sceneById = new Map(scenesData.scenes.map((s) => [s.sceneId, s]));
    const assetManifest = await this.getAssetManifest(projectId);

    const startIndex = options.firstScene ? scenesData.scenes.findIndex((s) => s.sceneId === options.firstScene) : 0;
    if (startIndex < 0) throw new ValidationError(`Scene "${options.firstScene}" not found.`);
    const waiting = scenesData.scenes
      .slice(startIndex)
      .filter((s) => !existsSync(path.join(root, s.visual.image)))
      .map((s) => s.sceneId);

    const rows: ImageImportRow[] = [];
    const importedAssets: AssetRecord[] = [];

    for (const file of files) {
      const filename = path.basename(file);
      const row: ImageImportRow = { file: filename, sceneId: null, result: "failed", relativePath: null, note: "" };
      rows.push(row);

      let sceneId = options.sceneId ?? null;
      if (!sceneId) {
        const match = filename.match(/scene_(\d+)/i);
        if (match) sceneId = `scene_${match[1]!.padStart(3, "0")}`;
      }
      if (sceneId && waiting.includes(sceneId)) waiting.splice(waiting.indexOf(sceneId), 1);
      if (!sceneId && options.order) sceneId = waiting.shift() ?? null;

      row.sceneId = sceneId;
      if (!sceneId) {
        row.result = "unmatched";
        row.note = "no scene ID in the name; use --order or --scene";
        continue;
      }
      const scene = sceneById.get(sceneId);
      if (!scene) {
        row.result = "unknown_scene";
        row.note = "not in the storyboard";
        continue;
      }

      const extension = await detectImageExtension(file);
      if (!extension) {
        row.note = "not a readable PNG, JPEG or WebP";
        continue;
      }

      let meta;
      try {
        meta = await inspectMedia(file);
      } catch (err: any) {
        row.note = `could not read: ${err.message}`;
        continue;
      }
      if (!meta.width || !meta.height) {
        row.note = "no image dimensions";
        continue;
      }

      const sameFile = assetManifest.assets.find(
        (a) => a.checksum === meta.checksum && a.sceneAssociations.includes(sceneId!)
      );
      if (sameFile) {
        scene.visual.image = sameFile.relativePath;
        scene.status.image = "imported";
        row.result = "duplicate";
        row.relativePath = sameFile.relativePath;
        row.note = "same file already imported";
        continue;
      }

      const originalsDir = path.join(root, "assets", "generated", "originals", sceneId);
      await fs.mkdir(originalsDir, { recursive: true });
      const version = (await fs.readdir(originalsDir)).length + 1;
      const safeName = path.parse(filename).name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
      const targetName = `v${String(version).padStart(2, "0")}_${safeName}${extension}`;
      await fs.copyFile(file, path.join(originalsDir, targetName));

      const relativePath = `assets/generated/originals/${sceneId}/${targetName}`;
      const record: AssetRecord = {
        assetId: `asset_img_${meta.checksum.slice(0, 12)}_${sceneId}`,
        relativePath,
        assetType: "image",
        originalFilename: filename,
        importedFilename: targetName,
        format: extension.slice(1),
        width: meta.width,
        height: meta.height,
        durationSeconds: null,
        fileSizeBytes: meta.fileSizeBytes,
        checksum: meta.checksum,
        importedAt: new Date().toISOString(),
        sceneAssociations: [sceneId],
        status: "valid",
        validationError: null,
      };
      assetManifest.assets.push(record);
      importedAssets.push(record);

      scene.visual.image = relativePath;
      scene.status.image = "imported";
      row.result = "imported";
      row.relativePath = relativePath;

      const notes: string[] = [];
      if (Math.abs(meta.width / meta.height - FRAME_ASPECT) > 0.02) {
        notes.push(`${meta.width}x${meta.height} is not 16:9; the crop will trim it`);
      }
      if (meta.width < MIN_RECOMMENDED_WIDTH) notes.push(`only ${meta.width} px wide`);
      row.note = notes.join("; ");
    }

    await this.saveAssetManifest(projectId, assetManifest);
    await atomicWriteJson(scenesPath, scenesData);
    await this.stages.markBuilt(projectId, "images");

    const report = await this.validateAssets(projectId);
    if (report.missingScenes.length === 0 && report.totalImportedAssets > 0) {
      const project = await this.pm.loadProject(projectId);
      if (project.status === "WAITING_FOR_MANUAL_IMAGES") project.status = "ASSETS_IMPORTED";
      project.checkpoints.assetsImported = true;
      await this.pm.saveProject(project);
    }

    return {
      importedCount: importedAssets.length,
      importedAssets,
      rows,
      missingScenes: report.missingScenes,
    };
  }

  /** Dimensions for an imported image, without re-reading it when already known. */
  async getImageSize(projectId: string, relativePath: string): Promise<{ width: number; height: number }> {
    const manifest = await this.getAssetManifest(projectId);
    const known = manifest.assets.find((a) => a.relativePath === relativePath);
    if (known?.width && known?.height) return { width: known.width, height: known.height };

    const meta = await inspectMedia(path.join(this.pm.getProjectRoot(projectId), relativePath));
    if (!meta.width || !meta.height) throw new AssetError(`Unable to read image size: ${relativePath}`);
    return { width: meta.width, height: meta.height };
  }

  async validateAssets(projectId: string): Promise<AssetValidationReport> {
    const root = this.pm.getProjectRoot(projectId);
    const manifest = await this.getAssetManifest(projectId);
    const scenesPath = path.join(root, "storyboard", "scenes.json");

    const errors: string[] = [];
    const warnings: string[] = [];
    const missingScenes: string[] = [];
    const usedAssetPaths = new Set<string>();
    let totalScenes = 0;

    if (existsSync(scenesPath)) {
      const scenesData = await readJsonFile<{ scenes: SceneRecord[] }>(scenesPath);
      totalScenes = scenesData.scenes.length;
      for (const sc of scenesData.scenes) {
        if (!existsSync(path.join(root, sc.visual.image))) {
          missingScenes.push(sc.sceneId);
          errors.push(`Scene "${sc.sceneId}" is missing image asset: ${sc.visual.image}`);
        } else {
          usedAssetPaths.add(sc.visual.image);
        }
      }
    }

    // Older takes of a scene that has a newer image are kept on purpose.
    const unusedAssets = manifest.assets
      .filter(
        (a) =>
          a.assetType === "image" &&
          !usedAssetPaths.has(a.relativePath) &&
          !a.relativePath.includes("/originals/")
      )
      .map((a) => a.relativePath);
    for (const a of unusedAssets) warnings.push(`Imported image asset is not mapped to any scene: ${a}`);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      totalImportedAssets: manifest.assets.length,
      totalScenes,
      missingScenes,
      unusedAssets,
    };
  }
}
