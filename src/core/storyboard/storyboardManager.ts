import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import { ScriptManager } from "../script/scriptManager.js";
import { ResearchManager } from "../research/researchManager.js";
import { StageGraph } from "../pipeline/stageGraph.js";
import {
  StoryboardManifestSchema,
  type StoryboardManifest,
  type ImagePrompt,
  type SceneRecord,
  type VisualStyleGuide,
} from "../schemas/storyboard.js";
import { atomicWriteJson, atomicWriteFile, readJsonFile } from "../../shared/atomic.js";
import { ValidationError } from "../../shared/errors.js";
import { Logger } from "../../shared/logger.js";
import { countWords, splitWords } from "../script/scriptFormat.js";
import { estimateSeconds, rebalanceShots, type RebalanceResult } from "../timeline/shotTiming.js";
import { defaultCamera, parseStoryboardFile, type ParsedShot } from "./storyboardFormat.js";
import type { TimelineCompiler } from "../timeline/timelineCompiler.js";
import type { CameraEffect } from "../../shared/types.js";

export interface StoryboardValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sceneCount: number;
  promptCount: number;
  totalSuggestedDurationSeconds: number;
}

const BATCH_SIZE = 10;
const CHAPTER_FADE_SECONDS = 0.6;

export function sceneIdFor(n: number): string {
  return `scene_${String(n).padStart(3, "0")}`;
}

export class StoryboardManager {
  private pm: ProjectManager;
  private sm: ScriptManager;
  private rm: ResearchManager;
  private stages: StageGraph;

  constructor(pm?: ProjectManager, sm?: ScriptManager, rm?: ResearchManager) {
    this.pm = pm ?? new ProjectManager();
    this.rm = rm ?? new ResearchManager(this.pm);
    this.sm = sm ?? new ScriptManager(this.pm, this.rm);
    this.stages = new StageGraph(this.pm);
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

  /** Compact brief: narration with word counts, plus the file format. */
  async buildBrief(projectId: string, chapterId?: string): Promise<string> {
    const project = await this.pm.loadProject(projectId);
    const script = await this.sm.getScriptManifest(projectId);
    const { speakingRateWpm: wpm, maxShotSeconds } = project.settings;
    const maxWords = Math.floor((maxShotSeconds / 60) * wpm);
    const chapters = chapterId ? script.chapters.filter((c) => c.chapter_id === chapterId) : script.chapters;
    if (chapters.length === 0) throw new ValidationError(`Chapter "${chapterId}" not found.`);

    const lines = [
      `# Storyboard brief: ${project.topic}`,
      `Stills only, no character animation. Each image lasts ${maxShotSeconds} s at most, about ${maxWords} words of narration.`,
      "Use 2-5 s by context: quick for action, slower for reflective lines, under 2 s for fast beats.",
      "",
      "Format (write one file; prompts about 35 words, no style text, the header adds it):",
      "# style",
      "direction: ...",
      "wardrobe: ...",
      "environment: ...",
      "palette: ...",
      "composition: ...",
      "negative: text, watermark, logo, ...",
      "continuity: rule one; rule two",
      "character Name: stable description",
      "location Name: stable description",
      "",
      "# chapter chapter_01 | mood: tense, low strings",
      "narration_001 | last words of this shot | image prompt | cam=pan_left tr=dissolve sfx=impact/deep",
      "narration_001 | * | image prompt",
      "",
      'The second field is the last words the shot covers; "*" runs to the end of the segment.',
      "Options are optional: cam=static|slow_zoom_in|slow_zoom_out|pan_left|pan_right|pan_up|pan_down|cinematic_drift,",
      "tr=cut|dissolve|fade_black|fade_white, sfx=<earshot id>, short (allows under the minimum length).",
      "Leave them out unless the story needs them. Cuts are the default and chapters fade in by themselves.",
      "",
    ];

    for (const chapter of chapters) {
      lines.push(`## ${chapter.chapter_id}: ${chapter.title} (${chapter.time_period})`);
      for (const segment of chapter.segments) {
        const words = countWords(segment.text);
        const shots = Math.ceil(estimateSeconds(words, wpm) / maxShotSeconds);
        lines.push(`${segment.segment_id} (${words} words, at least ${shots} shots): ${segment.text}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  /** Imports the compact storyboard, keeping IDs, images and crops of shots that survive. */
  async importStoryboard(
    projectId: string,
    inputFile: string,
    options?: { force?: boolean }
  ): Promise<{ storyboard: StoryboardManifest; added: number; kept: number; removed: number; warnings: string[] }> {
    await this.stages.requireApproved(projectId, "script", options?.force);
    if (!existsSync(inputFile)) throw new ValidationError(`Storyboard file not found: "${inputFile}"`);

    const project = await this.pm.loadProject(projectId);
    const script = await this.sm.getScriptManifest(projectId);
    const segments = new Map(
      script.chapters.flatMap((c) =>
        c.segments.map((s) => [s.segment_id, { chapterId: c.chapter_id, text: s.text }] as const)
      )
    );

    const parsed = parseStoryboardFile(await fs.readFile(inputFile, "utf-8"), segments);
    const previous = existsSync(this.getScenesPath(projectId)) ? await this.getStoryboard(projectId) : null;
    const { settings } = project;

    const uncovered = [...segments.keys()].filter((id) => !parsed.shots.some((s) => s.segmentId === id));
    if (uncovered.length > 0) {
      throw new ValidationError(`Storyboard rejected: no shots for ${uncovered.join(", ")}.`);
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const shotSeconds = (shot: ParsedShot) =>
      estimateSeconds(shot.wordEnd - shot.wordStart, settings.speakingRateWpm);
    parsed.shots.forEach((shot) => {
      const seconds = shotSeconds(shot);
      const label = `${shot.segmentId} ending at word ${shot.wordEnd}`;
      if (seconds > settings.maxShotSeconds) {
        errors.push(`${label}: about ${seconds.toFixed(1)} s, over the ${settings.maxShotSeconds} s limit. Split it.`);
      } else if (seconds < settings.minShotSeconds && !shot.allowShort) {
        errors.push(`${label}: about ${seconds.toFixed(1)} s. Merge it, or mark it "short".`);
      }
    });
    if (errors.length > 0) throw new ValidationError(`Storyboard rejected:\n${errors.join("\n")}`);

    const existing = previous?.scenes ?? [];
    const claimed = new Set<string>();
    const findExisting = (shot: ParsedShot): SceneRecord | undefined => {
      const free = existing.filter((s) => !claimed.has(s.sceneId));
      return (
        free.find((s) => s.shortPrompt === shot.prompt) ??
        free.find((s) => s.narrationSegmentIds[0] === shot.segmentId && s.wordEnd === shot.wordEnd)
      );
    };

    const reused = parsed.shots.map((shot) => {
      const match = findExisting(shot);
      if (match) claimed.add(match.sceneId);
      return match;
    });

    let nextId = Math.max(0, ...existing.map((s) => parseInt(s.sceneId.replace(/\D/g, ""), 10) || 0)) + 1;
    let previousCamera: CameraEffect | null = null;
    let previousChapter = "";
    let added = 0;

    const scenes: SceneRecord[] = parsed.shots.map((shot, i) => {
      const old = reused[i];
      const sceneId = old?.sceneId ?? sceneIdFor(nextId++);
      if (!old) added++;

      const seconds = shotSeconds(shot);
      const chapter = script.chapters.find((c) => c.chapter_id === shot.chapterId)!;
      const segmentText = segments.get(shot.segmentId)!.text;
      const startsChapter = shot.chapterId !== previousChapter;
      previousChapter = shot.chapterId;

      const camera = shot.camera ?? defaultCamera(i, seconds, previousCamera);
      previousCamera = camera;
      const transition = shot.transition
        ? { type: shot.transition, durationSeconds: settings.defaultTransitionDurationSeconds }
        : startsChapter
          ? { type: "fade_black" as const, durationSeconds: CHAPTER_FADE_SECONDS }
          : { type: "cut" as const, durationSeconds: 0 };

      return {
        schemaVersion: 1,
        sceneId,
        sceneNumber: i + 1,
        chapterId: shot.chapterId,
        title: `${chapter.title}, shot ${i + 1}`,
        narrationSegmentIds: [shot.segmentId],
        narration: splitWords(segmentText).slice(shot.wordStart, shot.wordEnd).join(" "),
        wordStart: shot.wordStart,
        wordEnd: shot.wordEnd,
        allowShort: shot.allowShort,
        shortPrompt: shot.prompt,
        batchId: `batch_${String(Math.floor(i / BATCH_SIZE) + 1).padStart(2, "0")}`,
        sfxSuggestions: shot.sfx,
        musicMood: parsed.chapterMoods[shot.chapterId] ?? "",
        visualPurpose: shot.prompt,
        suggestedDurationSeconds: Math.max(0.1, Math.round(seconds * 100) / 100),
        actualVoiceDurationFrames: null,
        timeline: old?.timeline ?? { startFrame: null, endFrame: null, durationFrames: null, fps: settings.fps },
        visual: old?.visual ?? {
          type: "image",
          image: `assets/generated/${sceneId}.png`,
          fit: "cover",
          crop: null,
          position: { x: 0.5, y: 0.5 },
          zoom: 1,
        },
        camera: { effect: camera, intensity: shot.intensity, origin: "center", direction: null },
        transition,
        audio: { voice: null, soundEffects: [] },
        imagePromptId: `prompt_${sceneId}`,
        sourceClaimIds: script.chapters
          .flatMap((c) => c.segments)
          .find((s) => s.segment_id === shot.segmentId)!.source_claim_ids,
        status: old?.status ?? { image: "missing", calibration: "not_started", audio: "missing", review: "needs_review" },
      };
    });

    const negative = parsed.style.negativePromptRules.join(", ");
    const prompts: ImagePrompt[] = scenes.map((scene) => ({
      promptId: scene.imagePromptId,
      sceneId: scene.sceneId,
      outputFilename: `${scene.sceneId}.png`,
      aspectRatio: "16:9",
      prompt: scene.shortPrompt,
      negativePrompt: negative,
      referenceAssets: [],
      continuityNotes: "",
      status: scene.status.image === "missing" ? "ready_for_manual_generation" : "imported",
    }));

    await this.saveScenes(projectId, scenes, parsed.style, "draft", parsed.chapterMoods);
    await atomicWriteJson(this.getPromptsPath(projectId), prompts);
    await this.pm.updateState(projectId, "STORYBOARD_REVIEW");
    await this.stages.markBuilt(projectId, "storyboard");

    const removed = existing.length - claimed.size;
    if (removed > 0) warnings.push(`${removed} earlier shot(s) were removed. Their images stay on disk.`);

    new Logger(path.join(this.pm.getProjectRoot(projectId), "logs", "project.log")).info(
      `Storyboard imported: ${scenes.length} shots, ${added} new, ${removed} removed`,
      { projectId, stage: "STORYBOARD" }
    );

    return {
      storyboard: await this.getStoryboard(projectId),
      added,
      kept: claimed.size,
      removed,
      warnings,
    };
  }

  private async saveScenes(
    projectId: string,
    scenes: SceneRecord[],
    visualStyleGuide: VisualStyleGuide,
    status: "draft" | "approved",
    chapterMoods: Record<string, string>
  ): Promise<void> {
    await atomicWriteJson(this.getScenesPath(projectId), {
      schemaVersion: 1,
      scenes,
      visualStyleGuide,
      status,
      chapterMoods,
    });
  }

  async getStoryboard(projectId: string): Promise<StoryboardManifest> {
    const scenesPath = this.getScenesPath(projectId);
    const promptsPath = this.getPromptsPath(projectId);

    if (!existsSync(scenesPath) || !existsSync(promptsPath)) {
      throw new ValidationError(
        `Storyboard not found for project "${projectId}". Run "video-studio storyboard import" first.`
      );
    }

    const scenesData = await readJsonFile<any>(scenesPath);
    const promptsData = await readJsonFile<ImagePrompt[]>(promptsPath);

    return StoryboardManifestSchema.parse({
      schemaVersion: 1,
      scenes: scenesData.scenes,
      visualStyleGuide: scenesData.visualStyleGuide,
      prompts: promptsData,
      status: scenesData.status ?? "draft",
      chapterMoods: scenesData.chapterMoods ?? {},
      updatedAt: new Date().toISOString(),
    });
  }

  async validateStoryboard(projectId: string): Promise<StoryboardValidationResult> {
    const storyboard = await this.getStoryboard(projectId);
    const project = await this.pm.loadProject(projectId);
    const errors: string[] = [];
    const warnings: string[] = [];

    const promptIds = new Set(storyboard.prompts.map((p) => p.promptId));
    let totalSuggested = 0;

    for (const sc of storyboard.scenes) {
      totalSuggested += sc.suggestedDurationSeconds;
      if (!promptIds.has(sc.imagePromptId)) {
        errors.push(`Scene "${sc.sceneId}" references non-existent image prompt ID: "${sc.imagePromptId}"`);
      }
      if (sc.suggestedDurationSeconds > project.settings.maxShotSeconds) {
        errors.push(`Scene "${sc.sceneId}" is about ${sc.suggestedDurationSeconds}s, over the shot limit.`);
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
    await this.saveScenes(projectId, storyboard.scenes, storyboard.visualStyleGuide, "approved", storyboard.chapterMoods);

    await this.stages.markBuilt(projectId, "storyboard");
    const project = await this.pm.loadProject(projectId);
    project.checkpoints.storyboardApproved = true;
    await this.pm.saveProject(project);
    await this.stages.markApproved(projectId, "storyboard");

    new Logger(path.join(this.pm.getProjectRoot(projectId), "logs", "project.log")).info(
      "Storyboard approved by user",
      { projectId, stage: "STORYBOARD" }
    );
    return { ...storyboard, status: "approved" };
  }

  /** Shared detail for a batch: style plus only the characters and places it mentions. */
  private buildBatchHeader(style: VisualStyleGuide, prompts: string[]): string {
    const text = prompts.join(" ").toLowerCase();
    const named = (entries: Record<string, string>) =>
      Object.entries(entries)
        .filter(([name]) => text.includes(name.toLowerCase()))
        .map(([name, detail]) => `${name}: ${detail}`);

    return [
      style.artisticDirection,
      style.clothingAndArmor && `Wardrobe: ${style.clothingAndArmor}`,
      style.architectureAndEnvironment && `Setting: ${style.architectureAndEnvironment}`,
      style.colorPaletteAndLighting && `Palette: ${style.colorPaletteAndLighting}`,
      style.cameraAndComposition && `Composition: ${style.cameraAndComposition}`,
      ...named(style.characters),
      ...named(style.locations),
      style.continuityRules.length > 0 && `Continuity: ${style.continuityRules.join("; ")}`,
      style.negativePromptRules.length > 0 && `Avoid: ${style.negativePromptRules.join(", ")}`,
      "Aspect ratio 16:9.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  /**
   * Writes prompts in batches of 10: one shared header, then short prompts.
   * A full export pauses at the manual image stage. A chapter or scene export
   * is a side file and changes no project state.
   */
  async exportPrompts(
    projectId: string,
    options?: { format?: "markdown" | "json"; chapterId?: string; sceneId?: string; force?: boolean }
  ): Promise<{ exportContent: string; exportPath: string; promptCount: number; batchPaths: string[] }> {
    await this.stages.requireApproved(projectId, "storyboard", options?.force);

    const storyboard = await this.getStoryboard(projectId);
    const format = options?.format ?? "markdown";
    const partial = Boolean(options?.chapterId || options?.sceneId);

    let scenes = storyboard.scenes;
    if (options?.sceneId) scenes = scenes.filter((s) => s.sceneId === options.sceneId);
    else if (options?.chapterId) scenes = scenes.filter((s) => s.chapterId === options.chapterId);
    if (scenes.length === 0) throw new ValidationError("No matching prompts found for export criteria.");

    const promptsDir = path.join(this.getStoryboardDir(projectId), "prompts");
    const suffix = options?.sceneId ?? options?.chapterId;
    const sections: string[] = [];
    const batchPaths: string[] = [];

    for (let i = 0; i < scenes.length; i += BATCH_SIZE) {
      const batch = scenes.slice(i, i + BATCH_SIZE);
      const number = String(i / BATCH_SIZE + 1).padStart(2, "0");
      const header = this.buildBatchHeader(storyboard.visualStyleGuide, batch.map((s) => s.shortPrompt));
      const content = [
        `# Google Flow batch ${number} (${batch[0]!.sceneId} to ${batch.at(-1)!.sceneId})`,
        "",
        "Shared detail for every image in this batch:",
        "",
        header,
        "",
        "Images:",
        "",
        ...batch.map((s) => `${s.sceneId}: ${s.shortPrompt}`),
        "",
      ].join("\n");
      sections.push(content);

      if (format === "markdown") {
        const name = suffix ? `${suffix}_batch_${number}.md` : `batch_${number}.md`;
        const batchPath = path.join(promptsDir, name);
        await atomicWriteFile(batchPath, content);
        batchPaths.push(batchPath);
      }
    }

    const exportContent =
      format === "json"
        ? JSON.stringify(storyboard.prompts.filter((p) => scenes.some((s) => s.sceneId === p.sceneId)), null, 2)
        : sections.join("\n");
    const exportPath =
      format === "json"
        ? path.join(promptsDir, suffix ? `${suffix}.json` : "prompts.json")
        : batchPaths[0]!;
    if (format === "json") await atomicWriteFile(exportPath, exportContent);

    if (!partial) {
      const project = await this.pm.loadProject(projectId);
      project.checkpoints.promptsExported = true;
      if (project.status === "STORYBOARD_REVIEW") project.status = "WAITING_FOR_MANUAL_IMAGES";
      await this.pm.saveProject(project);
    }

    return { exportContent, exportPath, promptCount: scenes.length, batchPaths };
  }

  /** Moves shot boundaries to fit the limit using real voice timings. No LLM involved. */
  async rebalance(projectId: string, tc: TimelineCompiler): Promise<RebalanceResult> {
    const project = await this.pm.loadProject(projectId);
    const storyboard = await this.getStoryboard(projectId);
    const { segments, shots } = await tc.loadTimingInputs(projectId);
    const result = rebalanceShots(segments, shots, {
      fps: project.settings.fps,
      speakingRateWpm: project.settings.speakingRateWpm,
      segmentGapSeconds: project.settings.segmentGapSeconds,
      chapterGapSeconds: project.settings.chapterGapSeconds,
      maxShotSeconds: project.settings.maxShotSeconds,
      minShotSeconds: project.settings.minShotSeconds,
    });
    if (result.moves.length === 0) return result;

    const script = await this.sm.getScriptManifest(projectId);
    const textOf = new Map(script.chapters.flatMap((c) => c.segments.map((s) => [s.segment_id, s.text] as const)));
    for (const move of result.moves) {
      const scene = storyboard.scenes.find((s) => s.sceneId === move.sceneId)!;
      const index = storyboard.scenes.indexOf(scene);
      const previous = storyboard.scenes[index - 1]!;
      scene.wordStart = move.wordStart;
      previous.wordEnd = move.wordStart;
    }
    for (const scene of storyboard.scenes) {
      const words = splitWords(textOf.get(scene.narrationSegmentIds[0] ?? "") ?? "");
      scene.narration = words.slice(scene.wordStart ?? 0, scene.wordEnd ?? words.length).join(" ");
    }

    await this.saveScenes(
      projectId,
      storyboard.scenes,
      storyboard.visualStyleGuide,
      storyboard.status,
      storyboard.chapterMoods
    );
    return result;
  }
}
