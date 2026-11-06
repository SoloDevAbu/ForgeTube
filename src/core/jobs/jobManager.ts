import path from "node:path";
import { existsSync } from "node:fs";
import { atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { ProjectManager } from "../projects/projectManager.js";

export interface JobRecord {
  jobId: string;
  projectId: string;
  type: "render" | "research" | "script" | "preview";
  mode?: "scene" | "draft" | "final";
  status: "running" | "completed" | "failed" | "cancelled";
  progress: number; // 0.0 to 1.0
  outputPath: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  metadata?: Record<string, unknown>;
}

export class JobManager {
  private pm: ProjectManager;
  private lastProgressWriteTime = 0;

  constructor(pm?: ProjectManager) {
    this.pm = pm ?? new ProjectManager();
  }

  getJobsFilePath(projectId: string): string {
    return path.join(this.pm.getProjectRoot(projectId), "logs", "jobs.json");
  }

  async getJobs(projectId: string): Promise<JobRecord[]> {
    const p = this.getJobsFilePath(projectId);
    if (!existsSync(p)) return [];
    try {
      const raw = await readJsonFile<{ jobs: JobRecord[] }>(p);
      return raw.jobs || [];
    } catch {
      return [];
    }
  }

  async recordJob(job: JobRecord): Promise<void> {
    const p = this.getJobsFilePath(job.projectId);
    const jobs = await this.getJobs(job.projectId);
    const existingIdx = jobs.findIndex((j) => j.jobId === job.jobId);
    if (existingIdx >= 0) {
      jobs[existingIdx] = job;
    } else {
      jobs.push(job);
    }
    await atomicWriteJson(p, { jobs });
  }

  async updateJobProgress(
    projectId: string,
    jobId: string,
    progress: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const now = Date.now();
    // Throttle progress file writes to once every 1000ms
    if (now - this.lastProgressWriteTime < 1000 && progress < 0.99) {
      return;
    }
    this.lastProgressWriteTime = now;

    try {
      const jobs = await this.getJobs(projectId);
      const job = jobs.find((j) => j.jobId === jobId);
      if (job) {
        job.progress = Math.min(1.0, Math.max(0, progress));
        if (metadata) {
          job.metadata = { ...job.metadata, ...metadata };
        }
        await atomicWriteJson(this.getJobsFilePath(projectId), { jobs });
      }
    } catch {
      // Progress write error should not fail the render job
    }
  }

  async completeJob(
    projectId: string,
    jobId: string,
    outputPath: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const jobs = await this.getJobs(projectId);
    const job = jobs.find((j) => j.jobId === jobId);
    if (job) {
      job.status = "completed";
      job.progress = 1.0;
      job.outputPath = outputPath;
      job.completedAt = new Date().toISOString();
      if (metadata) job.metadata = { ...job.metadata, ...metadata };
      await atomicWriteJson(this.getJobsFilePath(projectId), { jobs });
    }
  }

  async failJob(
    projectId: string,
    jobId: string,
    error: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const jobs = await this.getJobs(projectId);
    const job = jobs.find((j) => j.jobId === jobId);
    if (job) {
      job.status = "failed";
      job.error = error;
      job.completedAt = new Date().toISOString();
      if (metadata) job.metadata = { ...job.metadata, ...metadata };
      await atomicWriteJson(this.getJobsFilePath(projectId), { jobs });
    }
  }
}
