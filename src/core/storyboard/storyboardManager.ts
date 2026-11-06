import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import { ScriptManager } from "../script/scriptManager.js";
import { ResearchManager } from "../research/researchManager.js";
import {
  StoryboardManifestSchema,
  type StoryboardManifest,
  type ImagePrompt,
  type SceneRecord,
} from "../schemas/storyboard.js";
import { atomicWriteJson, atomicWriteFile, readJsonFile } from "../../shared/atomic.js";
import { ValidationError } from "../../shared/errors.js";
import { Logger } from "../../shared/logger.js";
import { generateStoryboardFromScript } from "./storyboardGenerator.js";

export interface StoryboardValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sceneCount: number;
  promptCount: number;
  totalSuggestedDurationSeconds: number;
}

export class StoryboardManager {
  private pm: ProjectManager;
  private sm: ScriptManager;
  private rm: ResearchManager;

  constructor(pm?: ProjectManager, sm?: ScriptManager, rm?: ResearchManager) {
    this.pm = pm ?? new ProjectManager();
    this.sm = sm ?? new ScriptManager(this.pm);
    this.rm = rm ?? new ResearchManager(this.pm);
  }

  getStoryboardDir(projectId: string): string {
    return path.join(this.pm.getProjectRoot(projectId), "storyboard");
  }

  getScenesPath(projectId: string): string {
    return path.join(this.getStoryboardDir(projectId), "scenes.json");
  }

  getPromptsPath(projectId: string): string {
    return path.join(this.getStoryboardDir(projectId), "image-prompts.json");
  }

  async generateStoryboard(projectId: string): Promise<StoryboardManifest> {
    const script = await this.sm.getScriptManifest(projectId);
    const research = await this.rm.getResearch(projectId);
    const logger = new Logger(path.join(this.pm.getProjectRoot(projectId), "logs", "project.log"));

    await this.pm.updateState(projectId, "STORYBOARD_IN_PROGRESS");
    logger.info(`Generating storyboard and scene breakdown...`, {
      projectId,
      stage: "STORYBOARD",
    });

    const storyboard = generateStoryboardFromScript(script, research);

    await atomicWriteJson(this.getScenesPath(projectId), {
      schemaVersion: 1,
      scenes: storyboard.scenes,
      visualStyleGuide: storyboard.visualStyleGuide,
    });
    await atomicWriteJson(this.getPromptsPath(projectId), storyboard.prompts);

    await this.pm.updateState(projectId, "STORYBOARD_REVIEW");
    logger.info(
      `Storyboard generated: ${storyboard.scenes.length} scenes planned, ${storyboard.prompts.length} Google Flow prompts created`,
      { projectId, stage: "STORYBOARD" }
    );

    return storyboard;
  }

  async getStoryboard(projectId: string): Promise<StoryboardManifest> {
    const scenesPath = this.getScenesPath(projectId);
    const promptsPath = this.getPromptsPath(projectId);

    if (!existsSync(scenesPath) || !existsSync(promptsPath)) {
      throw new ValidationError(
        `Storyboard files not found for project "${projectId}". Run "video-studio storyboard generate" first.`
      );
    }

    const scenesData = await readJsonFile<{
      scenes: SceneRecord[];
      visualStyleGuide: any;
    }>(scenesPath);
    const promptsData = await readJsonFile<ImagePrompt[]>(promptsPath);

    return StoryboardManifestSchema.parse({
      schemaVersion: 1,
      scenes: scenesData.scenes,
      visualStyleGuide: scenesData.visualStyleGuide,
      prompts: promptsData,
      status: "draft",
      updatedAt: new Date().toISOString(),
    });
  }

  async validateStoryboard(projectId: string): Promise<StoryboardValidationResult> {
    const storyboard = await this.getStoryboard(projectId);
    const errors: string[] = [];
    const warnings: string[] = [];

    const promptIds = new Set(storyboard.prompts.map((p) => p.promptId));
    let totalSuggested = 0;

    for (const sc of storyboard.scenes) {
      totalSuggested += sc.suggestedDurationSeconds;
      if (!promptIds.has(sc.imagePromptId)) {
        errors.push(`Scene "${sc.sceneId}" references non-existent image prompt ID: "${sc.imagePromptId}"`);
      }
      if (sc.suggestedDurationSeconds <= 0) {
        errors.push(`Scene "${sc.sceneId}" has non-positive duration: ${sc.suggestedDurationSeconds}s`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sceneCount: storyboard.scenes.length,
      promptCount: storyboard.prompts.length,
      totalSuggestedDurationSeconds: Math.round(totalSuggested * 10) / 10,
    };
  }

  async approveStoryboard(projectId: string): Promise<StoryboardManifest> {
    const val = await this.validateStoryboard(projectId);
    if (!val.valid) {
      throw new ValidationError(`Cannot approve storyboard with validation errors:\n${val.errors.join("\n")}`);
    }

    const storyboard = await this.getStoryboard(projectId);
    storyboard.status = "approved";
    storyboard.updatedAt = new Date().toISOString();

    await atomicWriteJson(this.getScenesPath(projectId), {
      schemaVersion: 1,
      scenes: storyboard.scenes,
      visualStyleGuide: storyboard.visualStyleGuide,
    });

    const project = await this.pm.loadProject(projectId);
    project.checkpoints.storyboardApproved = true;
    await this.pm.saveProject(project);

    const logger = new Logger(path.join(this.pm.getProjectRoot(projectId), "logs", "project.log"));
    logger.info("Storyboard approved by user", { projectId, stage: "STORYBOARD" });

    return storyboard;
  }

  async exportPrompts(
    projectId: string,
    options?: { format?: "markdown" | "json"; chapterId?: string; sceneId?: string }
  ): Promise<{ exportContent: string; exportPath: string; promptCount: number }> {
    const storyboard = await this.getStoryboard(projectId);
    const format = options?.format ?? "markdown";
    const logger = new Logger(path.join(this.pm.getProjectRoot(projectId), "logs", "project.log"));

    let targetPrompts = storyboard.prompts;
    if (options?.sceneId) {
      targetPrompts = targetPrompts.filter((p) => p.sceneId === options.sceneId);
    } else if (options?.chapterId) {
      const sceneIdsInChapter = new Set(
        storyboard.scenes.filter((s) => s.chapterId === options.chapterId).map((s) => s.sceneId)
      );
      targetPrompts = targetPrompts.filter((p) => sceneIdsInChapter.has(p.sceneId));
    }

    if (targetPrompts.length === 0) {
      throw new ValidationError("No matching prompts found for export criteria.");
    }

    let exportContent = "";
    let exportFilename = "google-flow-prompts.md";

    if (format === "json") {
      exportFilename = "google-flow-prompts.json";
      exportContent = JSON.stringify(targetPrompts, null, 2);
    } else {
      exportContent = `# Google Flow Image Generation Prompts\n\n`;
      exportContent += `> **MANUAL GENERATION CHECKPOINT**\n`;
      exportContent += `> Generate these images in Google Flow at **16:9** aspect ratio.\n`;
      exportContent += `> Save each resulting file with its exact expected filename (e.g. \`scene_001.png\`).\n`;
      exportContent += `> Then run: \`video-studio assets import --project ${projectId} --input <dir>\`\n\n`;
      exportContent += `## Visual Style Guide Reference\n`;
      exportContent += `- **Direction**: ${storyboard.visualStyleGuide.artisticDirection}\n`;
      exportContent += `- **Costumes & Armor**: ${storyboard.visualStyleGuide.clothingAndArmor}\n`;
      exportContent += `- **Architecture**: ${storyboard.visualStyleGuide.architectureAndEnvironment}\n`;
      exportContent += `- **Palette & Lighting**: ${storyboard.visualStyleGuide.colorPaletteAndLighting}\n\n`;
      exportContent += `## Prompt Checklist (${targetPrompts.length} images)\n\n`;

      for (const p of targetPrompts) {
        exportContent += `### [ ] ${p.outputFilename} (${p.sceneId})\n`;
        exportContent += `- **Expected Filename**: \`${p.outputFilename}\`\n`;
        exportContent += `- **Aspect Ratio**: 16:9\n`;
        exportContent += `- **Prompt**:\n\`\`\`text\n${p.prompt}\n\`\`\`\n`;
        exportContent += `- **Negative Prompt**:\n\`\`\`text\n${p.negativePrompt}\n\`\`\`\n`;
        if (p.continuityNotes) {
          exportContent += `- **Continuity Guidance**: ${p.continuityNotes}\n`;
        }
        exportContent += `\n---\n\n`;
      }
    }

    const exportPath = path.join(this.getStoryboardDir(projectId), exportFilename);
    await atomicWriteFile(exportPath, exportContent);

    // Transition project state to WAITING_FOR_MANUAL_IMAGES
    const project = await this.pm.loadProject(projectId);
    project.status = "WAITING_FOR_MANUAL_IMAGES";
    project.checkpoints.promptsExported = true;
    await this.pm.saveProject(project);

    logger.info(
      `Prompts exported to ${exportPath}. Paused at WAITING_FOR_MANUAL_IMAGES checkpoint.`,
      { projectId, stage: "STORYBOARD" }
    );

    return {
      exportContent,
      exportPath,
      promptCount: targetPrompts.length,
    };
  }
}

