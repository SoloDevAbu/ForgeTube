import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import {
  AssetManifestSchema,
  type AssetManifest,
  type AssetRecord,
} from "../schemas/assets.js";
import { atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { AssetError, ValidationError } from "../../shared/errors.js";
import { Logger } from "../../shared/logger.js";
import { inspectMedia } from "./mediaInspector.js";
import type { SceneRecord } from "../schemas/storyboard.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export interface AssetValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  totalImportedAssets: number;
  totalScenes: number;
  missingScenes: string[];
  unusedAssets: string[];
}

export class AssetManager {
  private pm: ProjectManager;

  constructor(pm?: ProjectManager) {
    this.pm = pm ?? new ProjectManager();
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
      return {
        schemaVersion: 1,
        assets: [],
        updatedAt: new Date().toISOString(),
      };
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
   * Imports one or more image files, maps them to scene IDs, inspects with ffprobe,
   * copies into assets/generated/, and updates scene and asset manifests.
   */
  async importImages(
    projectId: string,
    options: { inputPath: string; sceneId?: string }
  ): Promise<{ importedCount: number; importedAssets: AssetRecord[] }> {
    const root = this.pm.getProjectRoot(projectId);
    const logger = new Logger(path.join(root, "logs", "project.log"));
    const generatedDir = path.join(root, "assets", "generated");
    await fs.mkdir(generatedDir, { recursive: true });

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
          if (IMAGE_EXTENSIONS.has(ext)) {
            // In Node 20+, entry.parentPath or path.join(base, ...)
            const fullPath = (entry as any).parentPath
              ? path.join((entry as any).parentPath, entry.name)
              : path.join(options.inputPath, entry.name);
            filesToProcess.push(fullPath);
          }
        }
      }
    } else {
      const ext = path.extname(options.inputPath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) {
        throw new ValidationError(`File is not a supported image format (.png, .jpg, .jpeg, .webp): ${options.inputPath}`);
      }
      filesToProcess.push(options.inputPath);
    }

    if (filesToProcess.length === 0) {
      throw new ValidationError(`No valid image files found in: ${options.inputPath}`);
    }

    // Load scenes manifest to match
    const scenesPath = path.join(root, "storyboard", "scenes.json");
    let scenesData: { scenes: SceneRecord[]; visualStyleGuide: any } | null = null;
    if (existsSync(scenesPath)) {
      scenesData = await readJsonFile(scenesPath);
    }

    const assetManifest = await this.getAssetManifest(projectId);
    const importedAssets: AssetRecord[] = [];

    for (const file of filesToProcess) {
      const filename = path.basename(file);
      // Deduce target scene ID
      let targetSceneId = options.sceneId;
      if (!targetSceneId) {
        const match = filename.match(/scene_(\d+)/i);
        if (match) {
          targetSceneId = `scene_${match[1]?.padStart(3, "0")}`;
        }
      }

      // Inspect media using FFprobe
      logger.info(`Inspecting image with ffprobe: ${filename}`, { projectId, stage: "ASSETS" });
      const meta = await inspectMedia(file);

      const targetFilename = targetSceneId ? `${targetSceneId}.png` : filename;
      const targetPath = path.join(generatedDir, targetFilename);

      // Copy file immutably
      await fs.copyFile(file, targetPath);

      const relativePath = `assets/generated/${targetFilename}`;
      const assetRecord: AssetRecord = {
        assetId: `asset_img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        relativePath,
        assetType: "image",
        originalFilename: filename,
        importedFilename: targetFilename,
        format: meta.format,
        width: meta.width ?? null,
        height: meta.height ?? null,
        durationSeconds: null,
        fileSizeBytes: meta.fileSizeBytes,
        checksum: meta.checksum,
        importedAt: new Date().toISOString(),
        sceneAssociations: targetSceneId ? [targetSceneId] : [],
        status: "valid",
        validationError: null,
      };

      // Update asset manifest
      const existingIdx = assetManifest.assets.findIndex((a) => a.relativePath === relativePath);
      if (existingIdx >= 0) {
        assetManifest.assets[existingIdx] = assetRecord;
      } else {
        assetManifest.assets.push(assetRecord);
      }
      importedAssets.push(assetRecord);

      // Update scene record status
      if (scenesData && targetSceneId) {
        const scene = scenesData.scenes.find((s) => s.sceneId === targetSceneId);
        if (scene) {
          scene.visual.image = relativePath;
          scene.status.image = "imported";
        }
      }
    }

    await this.saveAssetManifest(projectId, assetManifest);

    if (scenesData) {
      await atomicWriteJson(scenesPath, scenesData);
    }

    // Check if all scenes now have images
    const report = await this.validateAssets(projectId);
    const project = await this.pm.loadProject(projectId);
    if (report.missingScenes.length === 0 && report.totalImportedAssets > 0) {
      project.status = "ASSETS_IMPORTED";
      project.checkpoints.assetsImported = true;
      await this.pm.saveProject(project);
      logger.info(`All ${report.totalScenes} scene images successfully imported and verified.`, {
        projectId,
        stage: "ASSETS",
      });
    }

    return {
      importedCount: importedAssets.length,
      importedAssets,
    };
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
        const imagePath = path.join(root, sc.visual.image);
        if (!existsSync(imagePath)) {
          missingScenes.push(sc.sceneId);
          errors.push(`Scene "${sc.sceneId}" is missing image asset: ${sc.visual.image}`);
        } else {
          usedAssetPaths.add(sc.visual.image);
        }
      }
    }

    const unusedAssets: string[] = [];
    for (const a of manifest.assets) {
      if (a.assetType === "image" && !usedAssetPaths.has(a.relativePath)) {
        unusedAssets.push(a.relativePath);
        warnings.push(`Imported image asset is not mapped to any scene: ${a.relativePath}`);
      }
    }

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

