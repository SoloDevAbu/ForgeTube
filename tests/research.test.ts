import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ProjectManager } from "../src/core/projects/projectManager.js";
import { ResearchManager } from "../src/core/research/researchManager.js";

describe("ResearchManager", () => {
  let tmpDir: string;
  let pm: ProjectManager;
  let rm: ResearchManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "forgetube-research-test-"));
    pm = new ProjectManager(tmpDir);
    rm = new ResearchManager(pm);
    await pm.createProject({
      name: "History of Rome",
      topic: "The complete history of Rome",
      targetMinutes: 12,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("runs research and populates sources, claims, and chronology", async () => {
    const dossier = await rm.runResearch("history_of_rome");
    expect(dossier.sources.length).toBeGreaterThan(5);
    expect(dossier.claims.length).toBeGreaterThan(5);
    expect(dossier.chronology.length).toBeGreaterThan(10);
    expect(dossier.chapters.length).toBe(6);

    const val = await rm.validateResearch("history_of_rome");
    expect(val.valid).toBe(true);
    expect(val.errors.length).toBe(0);
  });

  it("approves valid research and updates project manifest", async () => {
    await rm.runResearch("history_of_rome");
    const approved = await rm.approveResearch("history_of_rome");
    expect(approved.status).toBe("approved");

    const project = await pm.loadProject("history_of_rome");
    expect(project.checkpoints.researchApproved).toBe(true);
  });
});

