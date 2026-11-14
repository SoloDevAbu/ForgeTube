import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import { ResearchManager } from "../research/researchManager.js";
import { StageGraph } from "../pipeline/stageGraph.js";
import {
  ScriptManifestSchema,
  type ScriptManifest,
  type ScriptChapter,
  type NarrationSegment,
} from "../schemas/script.js";
import { atomicWriteJson, atomicWriteFile, readJsonFile } from "../../shared/atomic.js";
import { ValidationError } from "../../shared/errors.js";
import { Logger } from "../../shared/logger.js";
import { getLanguage } from "../language/languages.js";
import {
  checkSegmentAgainstClaims,
  countWords,
  parseScriptMarkdown,
  renderScriptMarkdown,
  type ParsedChapter,
} from "./scriptFormat.js";

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

/** Slow documentary pacing: a band around the voice's spoken words per minute. */
const WPM_BAND = 5;
const WORD_TOLERANCE = 0.1;

export function wordTarget(targetMinutes: number, wpm = 130): { min: number; max: number } {
  return {
    min: Math.round(targetMinutes * (wpm - WPM_BAND) * (1 - WORD_TOLERANCE)),
    max: Math.round(targetMinutes * (wpm + WPM_BAND) * (1 + WORD_TOLERANCE)),
  };
}

export class ScriptManager {
  private pm: ProjectManager;
  private rm: ResearchManager;
  private stages: StageGraph;

  constructor(pm?: ProjectManager, rm?: ResearchManager) {
    this.pm = pm ?? new ProjectManager();
    this.rm = rm ?? new ResearchManager(this.pm);
    this.stages = new StageGraph(this.pm);
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

  /** Compact brief for writing one chapter: only the claims it needs. */
  async buildBrief(projectId: string, chapterId?: string): Promise<string> {
    const project = await this.pm.loadProject(projectId);
    const research = await this.rm.getResearch(projectId);
    const script = existsSync(this.getManifestPath(projectId)) ? await this.getScriptManifest(projectId) : null;
    const language = getLanguage(project.language);
    const { min, max } = wordTarget(project.targetMinutes, project.settings.speakingRateWpm);
    const totalSeconds = research.chapters.reduce((sum, c) => sum + c.estimated_duration_seconds, 0);
    const baseId = this.pm.findSibling(projectId, "script/narration.json");
    const base = baseId ? await this.getScriptManifest(baseId) : null;

    const format = [
      "Format:",
      "# Chapter chapter_01: Title | period",
      "## narration_001 [clm_a,clm_b]",
      "Text. Use [pause] or [pause 1.2] for a held beat.",
      "",
      ...language.scriptRules,
      "Segment IDs run in order across the film. Every segment cites the claims it uses.",
      language.attribution.length > 0
        ? `Claims of kind tradition must be attributed in the text, for example with "${language.attribution[0]}" or "${language.attribution[7] ?? language.attribution[1]}".`
        : "Claims of kind tradition must be attributed in the text.",
      "Any number must appear in a cited claim.",
      ...(base
        ? [
            `This is the ${language.name} version. "${baseId}" already tells this film. Keep the chapter IDs and the facts.`,
            "Segment count, order inside a chapter and wording are yours to choose.",
          ]
        : []),
    ];

    if (!chapterId) {
      return [
        `# Script brief: ${project.topic}`,
        `Target ${project.targetMinutes} minutes, ${min}-${max} words in total.`,
        "",
        "Chapters:",
        ...research.chapters.map(
          (c) => `- ${c.chapter_id}: ${c.title} (${c.time_period}), about ${Math.round(c.estimated_duration_seconds)} s`
        ),
        "",
        `Write one chapter at a time: video-studio script brief --project ${projectId} --chapter <id>`,
        "",
        ...format,
      ].join("\n");
    }

    const chapter = research.chapters.find((c) => c.chapter_id === chapterId);
    if (!chapter) throw new ValidationError(`Chapter "${chapterId}" is not in the research plan.`);
    const share = totalSeconds > 0 ? chapter.estimated_duration_seconds / totalSeconds : 1 / research.chapters.length;
    const ids = new Set(chapter.claim_ids);
    const claims = ids.size > 0 ? research.claims.filter((c) => ids.has(c.claim_id)) : research.claims;

    const allSegments = script?.chapters.flatMap((c) => c.segments) ?? [];
    const chapterIndex = research.chapters.indexOf(chapter);
    const earlier = script?.chapters.filter((c) =>
      research.chapters.slice(0, chapterIndex).some((r) => r.chapter_id === c.chapter_id)
    );
    const lastBefore = earlier?.flatMap((c) => c.segments).at(-1);
    const nextNumber = Math.max(0, ...allSegments.map((s) => s.segment_number)) + 1;

    return [
      `# Chapter brief: ${chapter.chapter_id} ${chapter.title} (${chapter.time_period})`,
      chapter.summary,
      `Words: about ${Math.round(((min + max) / 2) * share)}.`,
      `Next free segment number: ${nextNumber}.`,
      lastBefore ? `Previous line: ${lastBefore.text.slice(-160)}` : "This chapter opens the film.",
      "",
      "Claims:",
      ...claims.map(
        (c) => `- ${c.claim_id} (${c.kind}, ${c.confidence}): ${c.claim}${c.caveat ? ` Caveat: ${c.caveat}` : ""}`
      ),
      "",
      ...this.baseChapterLines(base, chapterId),
      ...format,
    ].join("\n");
  }

  /** How the version written first tells a chapter, as a reference for this language. */
  private baseChapterLines(base: ScriptManifest | null, chapterId: string): string[] {
    const chapter = base?.chapters.find((c) => c.chapter_id === chapterId);
    if (!chapter) return [];
    return [
      "The other version tells this chapter as follows. Retell it, do not translate it:",
      ...chapter.segments.map((s) => `- [${s.source_claim_ids.join(",")}] ${s.text}`),
      "",
    ];
  }

  private toChapter(parsed: ParsedChapter, number: number, wpm: number, firstSegment: number): ScriptChapter {
    return {
      chapter_id: parsed.chapterId,
      chapter_number: number,
      title: parsed.title,
      time_period: parsed.timePeriod,
      segments: parsed.segments.map(
        (s, i): NarrationSegment => ({
          segment_id: s.segmentId,
          chapter_id: parsed.chapterId,
          segment_number: firstSegment + i,
          text: s.text,
          source_claim_ids: s.claimIds,
          estimated_duration_seconds: Math.max(0.1, (countWords(s.text) / wpm) * 60),
          voice_asset: null,
        })
      ),
    };
  }

  /** Imports a Markdown script. Chapters in the file replace chapters with the same ID. */
  async importScript(
    projectId: string,
    inputFile: string,
    options?: { force?: boolean }
  ): Promise<{ manifest: ScriptManifest; validation: ScriptValidationResult }> {
    await this.stages.requireApproved(projectId, "research", options?.force);
    if (!existsSync(inputFile)) throw new ValidationError(`Script file not found: "${inputFile}"`);

    const project = await this.pm.loadProject(projectId);
    const research = await this.rm.getResearch(projectId);
    const parsed = parseScriptMarkdown(await fs.readFile(inputFile, "utf-8"));

    const claims = new Map(research.claims.map((c) => [c.claim_id, c]));
    const { attribution } = getLanguage(project.language);
    const importErrors = parsed.flatMap((c) =>
      c.segments.flatMap((s) => checkSegmentAgainstClaims(s.segmentId, s.text, s.claimIds, claims, attribution))
    );
    if (importErrors.length > 0) {
      throw new ValidationError(`Script rejected:\n${importErrors.join("\n")}`);
    }

    const existing = existsSync(this.getManifestPath(projectId)) ? await this.getScriptManifest(projectId) : null;
    const byId = new Map(existing?.chapters.map((c) => [c.chapter_id, c]));
    const wpm = project.settings.speakingRateWpm;
    for (const chapter of parsed) byId.set(chapter.chapterId, this.toChapter(chapter, 0, wpm, 1));

    const planned = research.chapters.map((c) => c.chapter_id);
    const ordered = [...byId.values()].sort(
      (a, b) => (planned.indexOf(a.chapter_id) + 1 || 1e6) - (planned.indexOf(b.chapter_id) + 1 || 1e6)
    );

    const manifest = this.buildManifest(ordered, project.targetMinutes, wpm);
    await this.saveManifest(projectId, manifest);
    await this.pm.updateState(projectId, "SCRIPT_REVIEW");
    await this.stages.markBuilt(projectId, "script");

    return { manifest, validation: await this.validateScript(projectId) };
  }

  private buildManifest(chapters: ScriptChapter[], targetMinutes: number, wpm: number): ScriptManifest {
    let segmentNumber = 1;
    const numbered = chapters.map((c, i) => ({
      ...c,
      chapter_number: i + 1,
      segments: c.segments.map((s) => ({ ...s, segment_number: segmentNumber++ })),
    }));
    const totalWordCount = numbered.flatMap((c) => c.segments).reduce((sum, s) => sum + countWords(s.text), 0);
    return {
      schemaVersion: 1,
      totalWordCount,
      estimatedTotalDurationSeconds: Math.round((totalWordCount / wpm) * 60),
      targetMinutes,
      chapters: numbered,
      status: "draft",
      updatedAt: new Date().toISOString(),
    };
  }

  private async saveManifest(projectId: string, manifest: ScriptManifest): Promise<void> {
    await atomicWriteJson(this.getManifestPath(projectId), ScriptManifestSchema.parse(manifest));
    await atomicWriteFile(this.getMarkdownPath(projectId), renderScriptMarkdown(manifest.chapters));
  }

  /** Changes one segment, without touching the rest of the script. */
  async setSegment(
    projectId: string,
    segmentId: string,
    update: { text?: string; claimIds?: string[] }
  ): Promise<NarrationSegment> {
    const project = await this.pm.loadProject(projectId);
    const manifest = await this.getScriptManifest(projectId);
    const research = await this.rm.getResearch(projectId);
    const segment = manifest.chapters.flatMap((c) => c.segments).find((s) => s.segment_id === segmentId);
    if (!segment) throw new ValidationError(`Narration segment "${segmentId}" not found.`);

    const text = update.text ?? segment.text;
    const claimIds = update.claimIds ?? segment.source_claim_ids;
    const errors = checkSegmentAgainstClaims(
      segmentId,
      text,
      claimIds,
      new Map(research.claims.map((c) => [c.claim_id, c])),
      getLanguage(project.language).attribution
    );
    if (errors.length > 0) throw new ValidationError(errors.join("\n"));

    segment.text = text;
    segment.source_claim_ids = claimIds;
    const wpm = project.settings.speakingRateWpm;
    segment.estimated_duration_seconds = Math.max(0.1, (countWords(text) / wpm) * 60);

    await this.saveManifest(projectId, this.buildManifest(manifest.chapters, project.targetMinutes, wpm));
    await this.stages.markBuilt(projectId, "script");
    return segment;
  }

  async getScriptManifest(projectId: string): Promise<ScriptManifest> {
    const p = this.getManifestPath(projectId);
    if (!existsSync(p)) {
      throw new ValidationError(`Script not found for project "${projectId}". Run "video-studio script import" first.`);
    }
    const raw = await readJsonFile(p);
    return ScriptManifestSchema.parse(raw);
  }

  async getScriptMarkdown(projectId: string): Promise<string> {
    const p = this.getMarkdownPath(projectId);
    if (!existsSync(p)) {
      throw new ValidationError(`Script not found for project "${projectId}". Run "video-studio script import" first.`);
    }
    return fs.readFile(p, "utf-8");
  }

  async validateScript(projectId: string): Promise<ScriptValidationResult> {
    const manifest = await this.getScriptManifest(projectId);
    const research = await this.rm.getResearch(projectId);
    const project = await this.pm.loadProject(projectId);
    const { attribution } = getLanguage(project.language);
    const errors: string[] = [];
    const warnings: string[] = [];
    const claims = new Map(research.claims.map((c) => [c.claim_id, c]));

    let segmentCount = 0;
    const seen = new Set<string>();
    for (const ch of manifest.chapters) {
      if (ch.segments.length === 0) errors.push(`Chapter "${ch.chapter_id}" contains no narration segments.`);
      for (const seg of ch.segments) {
        segmentCount++;
        if (seen.has(seg.segment_id)) errors.push(`Duplicate segment ID "${seg.segment_id}".`);
        seen.add(seg.segment_id);
        errors.push(...checkSegmentAgainstClaims(seg.segment_id, seg.text, seg.source_claim_ids, claims, attribution));
      }
    }

    const missing = research.chapters.filter((r) => !manifest.chapters.some((c) => c.chapter_id === r.chapter_id));
    for (const chapter of missing) warnings.push(`Chapter "${chapter.chapter_id}" has not been written yet.`);

    const { min, max } = wordTarget(manifest.targetMinutes, project.settings.speakingRateWpm);
    if (missing.length === 0 && (manifest.totalWordCount < min || manifest.totalWordCount > max)) {
      errors.push(
        `Word count ${manifest.totalWordCount} is outside ${min}-${max} for a ${manifest.targetMinutes}-minute film.`
      );
    }

    return {
      valid: errors.length === 0 && missing.length === 0,
      errors,
      warnings,
      totalWords: manifest.totalWordCount,
      estimatedDurationSeconds: manifest.estimatedTotalDurationSeconds,
      targetMinutes: manifest.targetMinutes,
      durationDifferenceSeconds: manifest.estimatedTotalDurationSeconds - manifest.targetMinutes * 60,
      chapterCount: manifest.chapters.length,
      segmentCount,
    };
  }

  async approveScript(projectId: string): Promise<ScriptManifest> {
    const val = await this.validateScript(projectId);
    if (!val.valid) {
      throw new ValidationError(`Cannot approve script:\n${[...val.errors, ...val.warnings].join("\n")}`);
    }

    const manifest = await this.getScriptManifest(projectId);
    manifest.status = "approved";
    manifest.updatedAt = new Date().toISOString();
    await atomicWriteJson(this.getManifestPath(projectId), manifest);

    await this.stages.markBuilt(projectId, "script");
    const project = await this.pm.loadProject(projectId);
    project.checkpoints.scriptApproved = true;
    await this.pm.saveProject(project);
    await this.stages.markApproved(projectId, "script");

    const logger = new Logger(path.join(this.pm.getProjectRoot(projectId), "logs", "project.log"));
    logger.info("Script approved by user", { projectId, stage: "SCRIPT" });
    return manifest;
  }

  async inspectSegment(projectId: string, segmentId: string) {
    const manifest = await this.getScriptManifest(projectId);
    const research = await this.rm.getResearch(projectId);

    for (const chapter of manifest.chapters) {
      const segment = chapter.segments.find((s) => s.segment_id === segmentId);
      if (!segment) continue;

      const claimMap = new Map(research.claims.map((c) => [c.claim_id, c]));
      const sourceMap = new Map(research.sources.map((s) => [s.source_id, s]));
      return {
        segment,
        chapter: { id: chapter.chapter_id, number: chapter.chapter_number, title: chapter.title },
        linkedClaims: segment.source_claim_ids.map((id) => {
          const claim = claimMap.get(id);
          return { claim, sources: claim?.evidence_source_ids.map((sid) => sourceMap.get(sid)).filter(Boolean) };
        }),
      };
    }
    throw new ValidationError(`Narration segment "${segmentId}" not found in project "${projectId}".`);
  }
}
