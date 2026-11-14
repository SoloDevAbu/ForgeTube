import path from "node:path";
import { existsSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import { StageGraph } from "../pipeline/stageGraph.js";
import { ResearchDossierSchema, type ResearchDossier } from "../schemas/research.js";
import { atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { ValidationError } from "../../shared/errors.js";
import { Logger } from "../../shared/logger.js";

export interface ResearchValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  totalSources: number;
  totalClaims: number;
  totalEvents: number;
  unverifiedClaimsCount: number;
}

export class ResearchManager {
  private pm: ProjectManager;
  private stages: StageGraph;

  constructor(pm?: ProjectManager) {
    this.pm = pm ?? new ProjectManager();
    this.stages = new StageGraph(this.pm);
  }

  /** Research belongs to the topic, so every language version states the same facts. */
  getResearchDir(projectId: string): string {
    return path.join(this.pm.getTopicRoot(projectId), "research");
  }

  getDossierPath(projectId: string): string {
    return path.join(this.getResearchDir(projectId), "research.json");
  }

  /** Compact brief for the research pass. Only this much needs to be read. */
  async buildBrief(projectId: string): Promise<string> {
    const project = await this.pm.loadProject(projectId);
    const chapterCount = Math.max(3, Math.round(project.targetMinutes / 2));
    return [
      `# Research brief: ${project.topic}`,
      `Runtime ${project.targetMinutes} minutes, about ${chapterCount} chapters.`,
      "",
      "Find 8-12 reliable sources and actually open each one. Set opened: true only for pages you read.",
      "Never invent a source, URL or quote. Save claims, not raw pages.",
      "Claim kinds: fact, tradition (legend or later story), estimate (numbers scholars approximate), debated.",
      "Give each chapter the claim_ids it needs, so later stages can read a short list.",
      "",
      "Write JSON, then run: video-studio research import --project " + projectId + " --input <file>",
      JSON.stringify(
        {
          topic: project.topic,
          scope_statement: "...",
          sources: [
            {
              source_id: "src_001",
              title: "...",
              publisher: "...",
              author: null,
              url: "https://...",
              source_type: "academic_book_or_article",
              published_at: null,
              accessed_at: new Date().toISOString().slice(0, 10),
              opened: true,
            },
          ],
          claims: [
            {
              claim_id: "clm_001",
              claim: "...",
              kind: "fact",
              time_period: "...",
              confidence: "high",
              evidence_source_ids: ["src_001"],
              caveat: null,
            },
          ],
          chronology: [
            {
              event_id: "evt_001",
              date: "...",
              date_type: "approximate",
              description: "...",
              supporting_claim_ids: ["clm_001"],
              source_ids: ["src_001"],
            },
          ],
          chapters: [
            {
              chapter_id: "chapter_01",
              chapter_number: 1,
              title: "...",
              time_period: "...",
              summary: "...",
              estimated_duration_seconds: 120,
              claim_ids: ["clm_001"],
            },
          ],
          disagreements_and_debates: [],
          updatedAt: new Date().toISOString(),
        },
        null,
        0
      ),
    ].join("\n");
  }

  async getResearch(projectId: string): Promise<ResearchDossier> {
    const p = this.getDossierPath(projectId);
    if (!existsSync(p)) {
      throw new ValidationError(`Research not found for project "${projectId}". Run "video-studio research import" first.`);
    }
    const raw = await readJsonFile(p);
    return ResearchDossierSchema.parse(raw);
  }

  async validateResearch(projectId: string): Promise<ResearchValidationResult> {
    const dossier = await this.getResearch(projectId);
    const errors: string[] = [];
    const warnings: string[] = [];

    const sourceIds = new Set(dossier.sources.map((s) => s.source_id));
    const claimIds = new Set(dossier.claims.map((c) => c.claim_id));

    for (const s of dossier.sources) {
      if (!s.opened) errors.push(`Source "${s.source_id}" was not opened. Read it, or remove it.`);
    }

    let unverifiedClaimsCount = 0;
    for (const c of dossier.claims) {
      if (c.status !== "verified") {
        unverifiedClaimsCount++;
        warnings.push(`Claim "${c.claim_id}" is marked as ${c.status}. Requires review: "${c.claim}"`);
      }
      for (const sid of c.evidence_source_ids) {
        if (!sourceIds.has(sid)) {
          errors.push(`Claim "${c.claim_id}" references non-existent source ID: "${sid}"`);
        }
      }
    }

    for (const evt of dossier.chronology) {
      for (const cid of evt.supporting_claim_ids) {
        if (!claimIds.has(cid)) {
          errors.push(`Chronology event "${evt.event_id}" references non-existent claim ID: "${cid}"`);
        }
      }
      for (const sid of evt.source_ids) {
        if (!sourceIds.has(sid)) {
          errors.push(`Chronology event "${evt.event_id}" references non-existent source ID: "${sid}"`);
        }
      }
    }

    for (const ch of dossier.chapters) {
      for (const cid of ch.claim_ids) {
        if (!claimIds.has(cid)) errors.push(`Chapter "${ch.chapter_id}" references non-existent claim ID: "${cid}"`);
      }
    }

    if (dossier.chapters.length === 0) errors.push("Research dossier contains no chapters.");
    if (dossier.claims.length === 0) errors.push("Research dossier contains no claims.");

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      totalSources: dossier.sources.length,
      totalClaims: dossier.claims.length,
      totalEvents: dossier.chronology.length,
      unverifiedClaimsCount,
    };
  }

  async importResearch(projectId: string, inputFilePath: string): Promise<ResearchDossier> {
    if (!existsSync(inputFilePath)) {
      throw new ValidationError(`Import file not found: "${inputFilePath}"`);
    }
    const raw = await readJsonFile(inputFilePath);
    const dossier = ResearchDossierSchema.parse(raw);
    const researchDir = this.getResearchDir(projectId);

    await atomicWriteJson(this.getDossierPath(projectId), dossier);
    await atomicWriteJson(path.join(researchDir, "sources.json"), dossier.sources);
    await atomicWriteJson(path.join(researchDir, "claims.json"), dossier.claims);
    await atomicWriteJson(path.join(researchDir, "chronology.json"), dossier.chronology);

    await this.pm.updateState(projectId, "RESEARCH_REVIEW");
    await this.stages.markBuilt(projectId, "research");
    return dossier;
  }

  async approveResearch(projectId: string): Promise<ResearchDossier> {
    const val = await this.validateResearch(projectId);
    if (!val.valid) {
      throw new ValidationError(`Cannot approve research with validation errors:\n${val.errors.join("\n")}`);
    }

    const dossier = await this.getResearch(projectId);
    dossier.status = "approved";
    dossier.updatedAt = new Date().toISOString();
    await atomicWriteJson(this.getDossierPath(projectId), dossier);

    // One approval covers every language version of the topic.
    for (const id of this.pm.listVersions(projectId)) {
      await this.stages.markBuilt(id, "research");
      const manifest = await this.pm.loadProject(id);
      manifest.checkpoints.researchApproved = true;
      await this.pm.saveProject(manifest);
      await this.stages.markApproved(id, "research");
    }

    const logger = new Logger(path.join(this.pm.getProjectRoot(projectId), "logs", "project.log"));
    logger.info("Research dossier approved by user", { projectId, stage: "RESEARCH" });
    return dossier;
  }
}
