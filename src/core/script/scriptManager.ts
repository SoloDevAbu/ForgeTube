import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import { ResearchManager } from "../research/researchManager.js";
import {
  ScriptManifestSchema,
  type ScriptManifest,
  type NarrationSegment,
} from "../schemas/script.js";
import { atomicWriteJson, atomicWriteFile, readJsonFile } from "../../shared/atomic.js";
import { ValidationError } from "../../shared/errors.js";
import { Logger } from "../../shared/logger.js";
import { generateScriptFromResearch } from "./scriptGenerator.js";

export interface ScriptValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  totalWords: number;
  estimatedDurationSeconds: number;
  targetMinutes: number;
  durationDifferenceSeconds: number;
  chapterCount: number;
  segmentCount: number;
}

export class ScriptManager {
  private pm: ProjectManager;
  private rm: ResearchManager;

  constructor(pm?: ProjectManager, rm?: ResearchManager) {
    this.pm = pm ?? new ProjectManager();
    this.rm = rm ?? new ResearchManager(this.pm);
  }

  getScriptDir(projectId: string): string {
    return path.join(this.pm.getProjectRoot(projectId), "script");
  }

  getManifestPath(projectId: string): string {
    return path.join(this.getScriptDir(projectId), "narration.json");
  }

  getMarkdownPath(projectId: string): string {
    return path.join(this.getScriptDir(projectId), "script.md");
  }

  async generateScript(projectId: string): Promise<ScriptManifest> {
    const project = await this.pm.loadProject(projectId);
    const research = await this.rm.getResearch(projectId);
    const logger = new Logger(path.join(this.pm.getProjectRoot(projectId), "logs", "project.log"));

    await this.pm.updateState(projectId, "SCRIPT_IN_PROGRESS");
    logger.info(`Generating documentary script from approved research...`, {
      projectId,
      stage: "SCRIPT",
    });

    const { manifest, markdown } = generateScriptFromResearch(
      research,
      project.targetMinutes,
      project.settings.speakingRateWpm
    );

    await atomicWriteJson(this.getManifestPath(projectId), manifest);
    await atomicWriteFile(this.getMarkdownPath(projectId), markdown);

    await this.pm.updateState(projectId, "SCRIPT_REVIEW");
    logger.info(
      `Script generated: ${manifest.chapters.length} chapters, ${manifest.totalWordCount} words, ~${manifest.estimatedTotalDurationSeconds}s`,
      { projectId, stage: "SCRIPT" }
    );

    return manifest;
  }

  async getScriptManifest(projectId: string): Promise<ScriptManifest> {
    const p = this.getManifestPath(projectId);
    if (!existsSync(p)) {
      throw new ValidationError(`Script manifest not found for project "${projectId}". Run "video-studio script generate" first.`);
    }
    const raw = await readJsonFile(p);
    return ScriptManifestSchema.parse(raw);
  }

  async getScriptMarkdown(projectId: string): Promise<string> {
    const p = this.getMarkdownPath(projectId);
    if (!existsSync(p)) {
      throw new ValidationError(`Script markdown not found for project "${projectId}". Run "video-studio script generate" first.`);
    }
    return fs.readFile(p, "utf-8");
  }

  async validateScript(projectId: string): Promise<ScriptValidationResult> {
    const manifest = await this.getScriptManifest(projectId);
    const research = await this.rm.getResearch(projectId);
    const errors: string[] = [];
    const warnings: string[] = [];

    const claimIds = new Set(research.claims.map((c) => c.claim_id));
    let segmentCount = 0;

    for (const ch of manifest.chapters) {
      if (ch.segments.length === 0) {
        errors.push(`Chapter "${ch.chapter_id}" contains no narration segments.`);
      }
      for (const seg of ch.segments) {
        segmentCount++;
        for (const cid of seg.source_claim_ids) {
          if (!claimIds.has(cid)) {
            errors.push(`Narration segment "${seg.segment_id}" references non-existent claim ID: "${cid}"`);
          }
        }
      }
    }

    const targetSeconds = manifest.targetMinutes * 60;
    const diff = manifest.estimatedTotalDurationSeconds - targetSeconds;
    if (Math.abs(diff) > 300) {
      warnings.push(
        `Substantial difference (${Math.round(diff)}s) between estimated duration (${manifest.estimatedTotalDurationSeconds}s) and target duration (${targetSeconds}s).`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      totalWords: manifest.totalWordCount,
      estimatedDurationSeconds: manifest.estimatedTotalDurationSeconds,
      targetMinutes: manifest.targetMinutes,
      durationDifferenceSeconds: diff,
      chapterCount: manifest.chapters.length,
      segmentCount,
    };
  }

  async approveScript(projectId: string): Promise<ScriptManifest> {
    const val = await this.validateScript(projectId);
    if (!val.valid) {
      throw new ValidationError(`Cannot approve script with validation errors:\n${val.errors.join("\n")}`);
    }

    const manifest = await this.getScriptManifest(projectId);
    manifest.status = "approved";
    manifest.updatedAt = new Date().toISOString();

    await atomicWriteJson(this.getManifestPath(projectId), manifest);

    const project = await this.pm.loadProject(projectId);
    project.checkpoints.scriptApproved = true;
    await this.pm.saveProject(project);

    const logger = new Logger(path.join(this.pm.getProjectRoot(projectId), "logs", "project.log"));
    logger.info("Script approved by user", { projectId, stage: "SCRIPT" });

    return manifest;
  }

  async inspectSegment(projectId: string, segmentId: string) {
    const manifest = await this.getScriptManifest(projectId);
    const research = await this.rm.getResearch(projectId);

    let targetSegment: NarrationSegment | null = null;
    let targetChapter: any = null;

    for (const ch of manifest.chapters) {
      for (const seg of ch.segments) {
        if (seg.segment_id === segmentId) {
          targetSegment = seg;
          targetChapter = ch;
          break;
        }
      }
      if (targetSegment) break;
    }

    if (!targetSegment) {
      throw new ValidationError(`Narration segment "${segmentId}" not found in project "${projectId}".`);
    }

    // Find linked claims and their sources
    const claimMap = new Map(research.claims.map((c) => [c.claim_id, c]));
    const sourceMap = new Map(research.sources.map((s) => [s.source_id, s]));

    const linkedClaims = targetSegment.source_claim_ids.map((cid) => {
      const claim = claimMap.get(cid);
      const sources = claim?.evidence_source_ids.map((sid) => sourceMap.get(sid)).filter(Boolean);
      return {
        claim,
        sources,
      };
    });

    return {
      segment: targetSegment,
      chapter: {
        id: targetChapter.chapter_id,
        number: targetChapter.chapter_number,
        title: targetChapter.title,
      },
      linkedClaims,
    };
  }
}

