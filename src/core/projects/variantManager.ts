import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "./projectManager.js";
import { StageGraph } from "../pipeline/stageGraph.js";
import { getLanguage } from "../language/languages.js";
import { ProjectManifestSchema, type ProjectManifest } from "../schemas/project.js";
import { atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { ensureProjectDirectories, projectFileName, topicOf } from "../../shared/paths.js";
import { ValidationError } from "../../shared/errors.js";
import { Logger } from "../../shared/logger.js";

export interface AddVersionResult {
  project: ProjectManifest;
  created: boolean;
  /** The version whose settings this one started from. */
  from: string;
  musicPlanCopied: boolean;
}

export interface MigrationRow {
  from: string;
  to: string;
  note: string;
}

/**
 * Language versions of a topic. `projects/<topic>/` holds the research once
 * and one folder per language. Each version has its own script, shots, voice,
 * mix and render, and is made only when asked for. Whichever version exists
 * first lends its script as a reference and its images to the other.
 */
export class VariantManager {
  private pm: ProjectManager;
  private stages: StageGraph;

  constructor(pm?: ProjectManager) {
    this.pm = pm ?? new ProjectManager();
    this.stages = new StageGraph(this.pm);
  }

  /** Adds another language to a topic. Running it again changes nothing. */
  async addVersion(topicOrProjectId: string, languageCode: string): Promise<AddVersionResult> {
    const topic = topicOf(topicOrProjectId);
    const language = getLanguage(languageCode);
    const id = `${topic}/${language.folder}`;
    const versions = this.pm.listVersions(topic);

    const others = versions.filter((v) => v !== id);
    if (others.length === 0 && !versions.includes(id)) {
      throw new ValidationError(
        `Topic "${topic}" has no version yet. Start it with: video-studio project create --name <name> --topic <topic> --lang ${language.folder}`
      );
    }
    // Start from the version that is furthest along.
    const from = others.find((v) => existsSync(path.join(this.pm.getProjectRoot(v), "storyboard", "scenes.json"))) ?? others[0]!;
    if (versions.includes(id)) {
      return { project: await this.pm.loadProject(id), created: false, from: from ?? id, musicPlanCopied: false };
    }

    const source = await this.pm.loadProject(from);
    const root = this.pm.getProjectRoot(id);
    await ensureProjectDirectories(root);
    const now = new Date().toISOString();
    const manifest = ProjectManifestSchema.parse({
      id,
      name: source.name,
      topic: source.topic,
      targetMinutes: source.targetMinutes,
      language: language.code,
      createdAt: now,
      updatedAt: now,
      settings: {
        ...source.settings,
        speakingRateWpm: language.speakingRateWpm,
        voice: { provider: "edge", ...language.voice },
      },
    });
    await atomicWriteJson(this.pm.getManifestPath(id), manifest);

    // The research is the topic's. An approval given in one version holds here too.
    await this.stages.markBuilt(id, "research");
    if (source.checkpoints.researchApproved) {
      await this.stages.markApproved(id, "research");
      const project = await this.pm.loadProject(id);
      project.checkpoints.researchApproved = true;
      project.status = "RESEARCH_REVIEW";
      await this.pm.saveProject(project);
    }

    // Chapters are the same, so the music follows the other version until changed here.
    const plan = path.join(this.pm.getProjectRoot(from), "editing", "music-plan.json");
    const musicPlanCopied = existsSync(plan);
    if (musicPlanCopied) await fs.copyFile(plan, path.join(root, "editing", "music-plan.json"));

    new Logger(path.join(root, "logs", "project.log")).info(`${language.name} version added to "${topic}"`, {
      projectId: id,
    });
    return { project: await this.pm.loadProject(id), created: true, from, musicPlanCopied };
  }

  /**
   * Moves projects from the old one-folder layout into `<topic>/<language>/`.
   * Folders are renamed, never copied or deleted, and the research moves up to
   * the topic. A second copy of the research is kept aside if it differs.
   */
  async migrate(): Promise<MigrationRow[]> {
    const base = this.pm.getProjectsRoot();
    if (!existsSync(base)) return [];
    const rows: MigrationRow[] = [];

    const legacy: { dir: string; raw: any }[] = [];
    for (const entry of await fs.readdir(base, { withFileTypes: true })) {
      const manifest = path.join(base, entry.name, "project.json");
      if (entry.isDirectory() && !entry.name.startsWith(".") && existsSync(manifest)) {
        legacy.push({ dir: entry.name, raw: await readJsonFile<any>(manifest) });
      }
    }
    // Films first, then the versions that pointed at them.
    legacy.sort((a, b) => Number(Boolean(a.raw.variantOf)) - Number(Boolean(b.raw.variantOf)));

    for (const { dir, raw } of legacy) {
      const language = getLanguage(raw.language);
      const topic = topicOf(raw.variantOf ?? dir);
      const id = `${topic}/${language.folder}`;
      const topicRoot = path.join(base, topic);
      const target = path.join(topicRoot, language.folder);
      const notes: string[] = [];

      if (existsSync(target)) {
        rows.push({ from: dir, to: id, note: "skipped: that version already exists" });
        continue;
      }

      const holding = path.join(base, `.migrating_${dir}`);
      await fs.rename(path.join(base, dir), holding);
      await fs.mkdir(topicRoot, { recursive: true });
      await fs.rename(holding, target);

      // Research moves up to the topic, once.
      const own = path.join(target, "research");
      const shared = path.join(topicRoot, "research");
      if (existsSync(own)) {
        if (!existsSync(shared)) {
          await fs.rename(own, shared);
          notes.push("research moved to the topic");
        } else {
          const file = (dirPath: string) => path.join(dirPath, "research.json");
          const same =
            existsSync(file(own)) &&
            existsSync(file(shared)) &&
            (await fs.readFile(file(own))).equals(await fs.readFile(file(shared)));
          if (same || (await fs.readdir(own)).length === 0) {
            await fs.rename(own, path.join(target, "research.duplicate"));
            notes.push("its research was a copy of the topic's; set aside as research.duplicate");
          } else {
            await fs.rename(own, path.join(target, "research.differs"));
            notes.push("its research DIFFERS from the topic's; kept as research.differs, please compare");
          }
        }
      }

      // Rendered files carry the project name.
      const newName = projectFileName(id);
      for (const folder of ["render/final", "render/preview"]) {
        const full = path.join(target, folder);
        if (!existsSync(full)) continue;
        for (const file of await fs.readdir(full)) {
          if (file === `${dir}.mp4` || file.startsWith(`${dir}_`) || file.startsWith(`${dir}.`)) {
            await fs.rename(path.join(full, file), path.join(full, newName + file.slice(dir.length)));
          }
        }
      }

      const { variantOf: _old, ...rest } = raw;
      await atomicWriteJson(path.join(target, "project.json"), ProjectManifestSchema.parse({ ...rest, id }));
      rows.push({ from: dir, to: id, note: notes.join("; ") });
    }
    return rows;
  }
}
