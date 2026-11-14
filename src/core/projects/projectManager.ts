import fs from "node:fs/promises";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import {
  getProjectDir,
  getProjectsDir,
  ensureProjectDirectories,
  projectFileName,
  sanitizeFilename,
  topicOf,
} from "../../shared/paths.js";
import { atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { ProjectNotFoundError, ValidationError } from "../../shared/errors.js";
import {
  ProjectManifestSchema,
  type ProjectManifest,
  type ProjectSettings,
} from "../schemas/project.js";
import { Logger } from "../../shared/logger.js";
import type { ProjectState } from "../../shared/types.js";
import { getLanguage, LANGUAGES } from "../language/languages.js";

export interface CreateProjectOptions {
  name: string;
  topic: string;
  targetMinutes?: number;
  width?: number;
  height?: number;
  fps?: number;
  /** Narration language code. English when left out. */
  language?: string;
  customBase?: string;
}

export class ProjectManager {
  private customBase?: string;

  constructor(customBase?: string) {
    this.customBase = customBase;
  }

  /** The folder that holds every topic. */
  getProjectsRoot(): string {
    return getProjectsDir(this.customBase);
  }

  /** Folder of a topic. It holds the shared research and one folder per language. */
  getTopicRoot(projectId: string): string {
    return path.join(getProjectsDir(this.customBase), topicOf(projectId));
  }

  /** IDs of the language versions a topic has, English first. */
  listVersions(projectId: string): string[] {
    const topic = topicOf(projectId);
    const root = this.getTopicRoot(topic);
    if (!existsSync(root)) return [];
    const folders = new Set(readdirSync(root));
    return Object.values(LANGUAGES)
      .filter((l) => folders.has(l.folder) && existsSync(path.join(root, l.folder, "project.json")))
      .map((l) => `${topic}/${l.folder}`);
  }

  /**
   * The full "topic/language" ID. A bare topic names its only version; with
   * two versions the language has to be said.
   */
  resolveId(projectId: string): string {
    const topic = topicOf(projectId);
    const language = projectId.split("/")[1];
    if (language) return `${topic}/${getLanguage(language).folder}`;

    if (existsSync(path.join(this.getTopicRoot(topic), "project.json"))) {
      throw new ValidationError(`"${topic}" uses the old folder layout. Run: video-studio project migrate`);
    }
    const versions = this.listVersions(topic);
    if (versions.length > 1) {
      throw new ValidationError(`"${topic}" has more than one version. Use one of: ${versions.join(", ")}.`);
    }
    return versions[0] ?? `${topic}/${getLanguage(null).folder}`;
  }

  /** Another language version of the same topic that already has the given file. */
  findSibling(projectId: string, relativeFile: string): string | null {
    const id = this.resolveId(projectId);
    return (
      this.listVersions(id).find(
        (other) => other !== id && existsSync(path.join(getProjectDir(other, this.customBase), relativeFile))
      ) ?? null
    );
  }

  getProjectRoot(projectId: string): string {
    return getProjectDir(this.resolveId(projectId), this.customBase);
  }

  getManifestPath(projectId: string): string {
    return path.join(this.getProjectRoot(projectId), "project.json");
  }

  async exists(projectId: string): Promise<boolean> {
    const p = this.getManifestPath(projectId);
    return existsSync(p);
  }

  async createProject(options: CreateProjectOptions): Promise<ProjectManifest> {
    const language = getLanguage(options.language);
    const topic = sanitizeFilename(options.name);
    if (existsSync(this.getTopicRoot(topic))) {
      throw new ValidationError(
        `Topic "${topic}" already exists. To add another language to it, run: video-studio project add-version -p ${topic} --lang <language>`
      );
    }
    const id = `${topic}/${language.folder}`;
    const root = this.getProjectRoot(id);
    await ensureProjectDirectories(root);
    await fs.mkdir(path.join(this.getTopicRoot(topic), "research"), { recursive: true });

    const now = new Date().toISOString();
    const validated = ProjectManifestSchema.parse({
      schemaVersion: 1,
      id,
      name: options.name,
      topic: options.topic,
      targetMinutes: options.targetMinutes ?? 12,
      language: language.code,
      status: "NEW",
      createdAt: now,
      updatedAt: now,
      settings: {
        width: options.width ?? 1920,
        height: options.height ?? 1080,
        fps: options.fps ?? 30,
        speakingRateWpm: language.speakingRateWpm,
        voice: { provider: "edge", ...language.voice },
      },
    });
    await atomicWriteJson(this.getManifestPath(id), validated);

    const logger = new Logger(path.join(root, "logs", "project.log"));
    logger.info(`Project "${options.name}" created`, { projectId: id });

    return validated;
  }

  async loadProject(projectId: string): Promise<ProjectManifest> {
    const manifestPath = this.getManifestPath(projectId);
    if (!existsSync(manifestPath)) {
      throw new ProjectNotFoundError(projectId);
    }
    const raw = await readJsonFile(manifestPath);
    return ProjectManifestSchema.parse(raw);
  }

  async saveProject(manifest: ProjectManifest): Promise<ProjectManifest> {
    const root = this.getProjectRoot(manifest.id);
    if (!existsSync(root)) {
      throw new ProjectNotFoundError(manifest.id);
    }
    const updated: ProjectManifest = {
      ...manifest,
      updatedAt: new Date().toISOString(),
    };
    const validated = ProjectManifestSchema.parse(updated);
    await atomicWriteJson(this.getManifestPath(manifest.id), validated);
    return validated;
  }

  async updateState(projectId: string, newState: ProjectState): Promise<ProjectManifest> {
    const manifest = await this.loadProject(projectId);
    manifest.status = newState;
    return this.saveProject(manifest);
  }

  async listProjects(): Promise<ProjectManifest[]> {
    const base = getProjectsDir(this.customBase);
    if (!existsSync(base)) {
      return [];
    }

    const entries = await fs.readdir(base, { withFileTypes: true });
    const projects: ProjectManifest[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      for (const id of this.listVersions(entry.name)) {
        try {
          projects.push(ProjectManifestSchema.parse(await readJsonFile(this.getManifestPath(id))));
        } catch {
          // Ignore folders that are not projects.
        }
      }
    }

    return projects.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async getProjectStatus(projectId: string): Promise<ProjectStatusSummary> {
    const manifest = await this.loadProject(projectId);
    const root = this.getProjectRoot(projectId);

    // Read scenes count if available
    let sceneCount = 0;
    let imagesImported = 0;
    let imagesMissing = 0;
    let calibratedCount = 0;
    let uncalibratedCount = 0;
    let audioReadyCount = 0;
    let chapterCount = 0;

    const scenesPath = path.join(root, "storyboard", "scenes.json");
    if (existsSync(scenesPath)) {
      try {
        const data = await readJsonFile<{ scenes: any[] }>(scenesPath);
        if (Array.isArray(data.scenes)) {
          sceneCount = data.scenes.length;
          const chapters = new Set<string>();
          for (const s of data.scenes) {
            if (s.chapterId) chapters.add(s.chapterId);
            const imgPath = path.join(root, s.visual?.image || "");
            if (s.visual?.image && existsSync(imgPath)) {
              imagesImported++;
            } else {
              imagesMissing++;
            }
            if (s.visual?.crop || s.status?.calibration === "calibrated" || s.status?.calibration === "approved") {
              calibratedCount++;
            } else {
              uncalibratedCount++;
            }
            if (s.audio?.voice && existsSync(path.join(root, s.audio.voice))) {
              audioReadyCount++;
            }
          }
          chapterCount = chapters.size;
        }
      } catch {
        // scenes not yet generated or invalid
      }
    }

    // Check last render output
    const fileName = projectFileName(manifest.id);
    const renderPath = path.join(root, "render", "final", `${fileName}.mp4`);
    const draftRenderPath = path.join(root, "render", "preview", `${fileName}_draft.mp4`);
    const lastRenderOutput = existsSync(renderPath)
      ? renderPath
      : existsSync(draftRenderPath)
      ? draftRenderPath
      : null;

    // Determine next recommended command based on workflow state
    const nextCommand = getNextRecommendedCommand(manifest, {
      sceneCount,
      imagesImported,
      imagesMissing,
      uncalibratedCount,
      audioReadyCount,
    });

    return {
      projectId: manifest.id,
      name: manifest.name,
      topic: manifest.topic,
      targetMinutes: manifest.targetMinutes,
      status: manifest.status,
      resolution: `${manifest.settings.width}x${manifest.settings.height} @ ${manifest.settings.fps}fps`,
      chapterCount,
      sceneCount,
      imagesImported,
      imagesMissing,
      scenesCalibrated: calibratedCount,
      scenesUnreviewed: uncalibratedCount,
      audioReady: `${audioReadyCount}/${sceneCount}`,
      lastRenderOutput,
      checkpoints: manifest.checkpoints,
      nextCommand,
    };
  }

  async exportProject(projectId: string, destinationDir: string): Promise<string> {
    const root = this.getProjectRoot(projectId);
    if (!existsSync(root)) {
      throw new ProjectNotFoundError(projectId);
    }
    const target = path.resolve(destinationDir, projectFileName(this.resolveId(projectId)));
    await fs.cp(root, target, { recursive: true });
    return target;
  }

  async backupProject(projectId: string, destinationDir?: string): Promise<string> {
    const root = this.getProjectRoot(projectId);
    if (!existsSync(root)) {
      throw new ProjectNotFoundError(projectId);
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const targetDir = destinationDir || path.join(getProjectsDir(this.customBase), ".backups");
    const target = path.join(targetDir, `${projectFileName(this.resolveId(projectId))}_backup_${timestamp}`);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.cp(root, target, { recursive: true });
    return target;
  }
}

export interface ProjectStatusSummary {
  projectId: string;
  name: string;
  topic: string;
  targetMinutes: number;
  status: ProjectState;
  resolution: string;
  chapterCount: number;
  sceneCount: number;
  imagesImported: number;
  imagesMissing: number;
  scenesCalibrated: number;
  scenesUnreviewed: number;
  audioReady: string;
  lastRenderOutput: string | null;
  checkpoints: ProjectManifest["checkpoints"];
  nextCommand: string;
}

function getNextRecommendedCommand(
  manifest: ProjectManifest,
  stats: {
    sceneCount: number;
    imagesImported: number;
    imagesMissing: number;
    uncalibratedCount: number;
    audioReadyCount: number;
  }
): string {
  switch (manifest.status) {
    case "NEW":
    case "RESEARCH_IN_PROGRESS":
      return `video-studio research brief --project ${manifest.id}`;
    case "RESEARCH_REVIEW":
      return manifest.checkpoints.researchApproved
        ? `video-studio script brief --project ${manifest.id}`
        : `video-studio research approve --project ${manifest.id}`;
    case "SCRIPT_IN_PROGRESS":
      return `video-studio script brief --project ${manifest.id}`;
    case "SCRIPT_REVIEW":
      return manifest.checkpoints.scriptApproved
        ? `video-studio storyboard brief --project ${manifest.id}`
        : `video-studio script approve --project ${manifest.id}`;
    case "STORYBOARD_IN_PROGRESS":
      return `video-studio storyboard brief --project ${manifest.id}`;
    case "STORYBOARD_REVIEW":
      return manifest.checkpoints.storyboardApproved
        ? `video-studio prompts export --project ${manifest.id}`
        : `video-studio storyboard approve --project ${manifest.id}`;
    case "WAITING_FOR_MANUAL_IMAGES":
      if (stats.imagesMissing > 0) {
        return `Generate images in Google Flow, then run: video-studio assets import --project ${manifest.id} --input <dir> --order`;
      }
      return `video-studio assets validate --project ${manifest.id}`;
    case "ASSETS_IMPORTED":
      return `video-studio calibration apply-preset --project ${manifest.id} --preset gemini-watermark`;
    case "CALIBRATION_COMPLETE":
      return `video-studio audio voice --project ${manifest.id}`;
    case "TIMELINE_READY":
      return manifest.checkpoints.audioApproved
        ? `video-studio render --project ${manifest.id} --mode draft`
        : `video-studio audio mix --project ${manifest.id}`;
    case "AUDIO_READY":
      return `video-studio render --project ${manifest.id} --mode draft`;
    case "RENDERING":
      return `video-studio jobs status --project ${manifest.id}`;
    case "RENDERED":
      return `Finished. Output is in projects/${manifest.id}/render/final. Another language: video-studio project add-version`;
    case "FAILED":
      return `Inspect error logs at projects/${manifest.id}/logs/project.log`;
    default:
      return `video-studio project status --project ${manifest.id}`;
  }
}

