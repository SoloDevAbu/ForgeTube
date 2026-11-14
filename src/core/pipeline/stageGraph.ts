import crypto from "node:crypto";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import { atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { ValidationError } from "../../shared/errors.js";
import type { ProjectCheckpoints } from "../schemas/project.js";

export const StageNames = ["research", "script", "storyboard", "images", "voice", "timeline", "mix", "render"] as const;
export type StageName = (typeof StageNames)[number];

/** What each stage is built from. */
const UPSTREAM: Record<StageName, StageName[]> = {
  research: [],
  script: ["research"],
  storyboard: ["script"],
  images: ["storyboard"],
  voice: ["script"],
  timeline: ["storyboard", "images", "voice"],
  mix: ["timeline"],
  render: ["timeline", "mix"],
};

const APPROVAL: Partial<Record<StageName, keyof ProjectCheckpoints>> = {
  research: "researchApproved",
  script: "scriptApproved",
  storyboard: "storyboardApproved",
  images: "calibrationApproved",
  mix: "audioApproved",
};

export interface StageRecord {
  /** Fingerprint of this stage's output when last built. */
  hash: string;
  /** Fingerprints of its inputs at that moment. */
  upstream: Partial<Record<StageName, string>>;
  /** Fingerprint that was approved, if any. */
  approvedHash: string | null;
  updatedAt: string;
}

type StageFile = Partial<Record<StageName, StageRecord>>;

export interface StageStatus {
  stage: StageName;
  built: boolean;
  approved: boolean;
  stale: boolean;
  staleBecause: StageName[];
}

/** Volatile fields that must not make a stage look changed. */
const VOLATILE = new Set(["status", "updatedAt", "compiledAt", "timeline", "schemaVersion", "suggestedDurationSeconds"]);

function stableJson(value: unknown): string {
  return JSON.stringify(value, (key, v) => {
    if (VOLATILE.has(key)) return undefined;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

export function fingerprint(value: unknown): string {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 16);
}

export class StageGraph {
  constructor(private pm: ProjectManager) {}

  private filePath(projectId: string): string {
    return path.join(this.pm.getProjectRoot(projectId), "pipeline", "stages.json");
  }

  private async load(projectId: string): Promise<StageFile> {
    const p = this.filePath(projectId);
    return existsSync(p) ? readJsonFile<StageFile>(p) : {};
  }

  /** Current fingerprint of a stage from the files on disk. Null if not built. */
  async currentHash(projectId: string, stage: StageName): Promise<string | null> {
    const root = this.pm.getProjectRoot(projectId);
    const readIf = async (rel: string) => {
      const p = path.join(root, rel);
      return existsSync(p) ? readJsonFile<any>(p) : null;
    };

    switch (stage) {
      case "research": {
        const shared = path.join(this.pm.getTopicRoot(projectId), "research", "research.json");
        const data = existsSync(shared) ? await readJsonFile<any>(shared) : null;
        return data ? fingerprint(data) : null;
      }
      case "script": {
        const data = await readIf("script/narration.json");
        return data ? fingerprint(data.chapters) : null;
      }
      case "storyboard": {
        const data = await readIf("storyboard/scenes.json");
        if (!data) return null;
        // Word boundaries are left out: rebalancing them is timing, not a new creative choice.
        return fingerprint({
          style: data.visualStyleGuide,
          shots: data.scenes.map((s: any) => [
            s.sceneId,
            s.narrationSegmentIds,
            s.shortPrompt,
            s.camera,
            s.transition,
            s.sfxSuggestions,
          ]),
        });
      }
      case "images": {
        const data = await readIf("storyboard/scenes.json");
        if (!data) return null;
        return fingerprint(
          data.scenes.map((s: any) => {
            const full = path.join(root, s.visual.image);
            const stat = existsSync(full) ? statSync(full) : null;
            return [s.sceneId, s.visual, stat?.size ?? 0, stat?.mtimeMs ?? 0];
          })
        );
      }
      case "voice": {
        const data = await readIf("editing/audio-mix.json");
        if (!data?.voiceTracks?.length) return null;
        return fingerprint(data.voiceTracks.map((t: any) => [t.segmentId ?? t.sceneId, t.file, t.durationSeconds]));
      }
      case "timeline": {
        const data = await readIf("render/render-manifest.json");
        return data ? fingerprint([data.scenes, data.chapters, data.audio]) : null;
      }
      case "mix": {
        const data = await readIf("editing/mix.json");
        return data?.inputHash ?? null;
      }
      case "render": {
        const data = await readIf("render/final/render.json");
        return data?.inputHash ?? null;
      }
    }
  }

  /** Records a stage as built from the current state of its inputs. */
  async markBuilt(projectId: string, stage: StageName): Promise<void> {
    const file = await this.load(projectId);
    const hash = await this.currentHash(projectId, stage);
    if (!hash) return;

    const upstream: StageRecord["upstream"] = {};
    for (const up of UPSTREAM[stage]) {
      const h = await this.currentHash(projectId, up);
      if (h) upstream[up] = h;
    }

    const previous = file[stage];
    const unchanged = previous?.hash === hash;
    file[stage] = {
      hash,
      upstream,
      approvedHash: unchanged ? (previous?.approvedHash ?? null) : null,
      updatedAt: new Date().toISOString(),
    };
    await atomicWriteJson(this.filePath(projectId), file);

    // Changed output needs approving again.
    const checkpoint = APPROVAL[stage];
    if (checkpoint && !unchanged) {
      const project = await this.pm.loadProject(projectId);
      if (project.checkpoints[checkpoint]) {
        project.checkpoints[checkpoint] = false;
        await this.pm.saveProject(project);
      }
    }
  }

  async markApproved(projectId: string, stage: StageName): Promise<void> {
    await this.markBuilt(projectId, stage);
    const file = await this.load(projectId);
    const record = file[stage];
    if (!record) return;
    record.approvedHash = record.hash;
    await atomicWriteJson(this.filePath(projectId), file);
  }

  async getStatus(projectId: string): Promise<StageStatus[]> {
    const file = await this.load(projectId);
    const project = await this.pm.loadProject(projectId);
    const statuses: StageStatus[] = [];

    for (const stage of StageNames) {
      const record = file[stage];
      const current = await this.currentHash(projectId, stage);
      const staleBecause: StageName[] = [];
      if (record) {
        if (current !== record.hash) staleBecause.push(stage);
        for (const up of UPSTREAM[stage]) {
          const now = await this.currentHash(projectId, up);
          if ((record.upstream[up] ?? null) !== now) staleBecause.push(up);
        }
      }
      const checkpoint = APPROVAL[stage];
      statuses.push({
        stage,
        built: current !== null,
        approved: checkpoint ? project.checkpoints[checkpoint] : false,
        stale: staleBecause.length > 0,
        staleBecause,
      });
    }
    return statuses;
  }

  /** Stops a command when an approval it depends on is missing. */
  async requireApproved(projectId: string, stage: StageName, force = false): Promise<void> {
    if (force) return;
    const checkpoint = APPROVAL[stage];
    if (!checkpoint) return;
    const project = await this.pm.loadProject(projectId);
    if (!project.checkpoints[checkpoint]) {
      throw new ValidationError(
        `The ${stage} stage is not approved. Review and approve it first, or pass --force to continue anyway.`
      );
    }
    const file = await this.load(projectId);
    const record = file[stage];
    if (record?.approvedHash && record.approvedHash !== (await this.currentHash(projectId, stage))) {
      throw new ValidationError(`The ${stage} stage changed after approval. Approve it again, or pass --force.`);
    }
  }
}
