import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ProjectManager } from "../src/core/projects/projectManager.js";
import { ResearchManager } from "../src/core/research/researchManager.js";
import { ScriptManager } from "../src/core/script/scriptManager.js";

describe("ScriptManager", () => {
  let tmpDir: string;
  let pm: ProjectManager;
  let rm: ResearchManager;
  let sm: ScriptManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "forgetube-script-test-"));
    pm = new ProjectManager(tmpDir);
    rm = new ResearchManager(pm);
    sm = new ScriptManager(pm, rm);

    await pm.createProject({
      name: "History of Rome",
      topic: "The complete history of Rome",
      targetMinutes: 12,
    });
    await rm.runResearch("history_of_rome");
    await rm.approveResearch("history_of_rome");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("generates structured script with chapters and narration segments", async () => {
    const script = await sm.generateScript("history_of_rome");
    expect(script.chapters.length).toBe(6);
    expect(script.totalWordCount).toBeGreaterThan(100);
    expect(script.estimatedTotalDurationSeconds).toBeGreaterThan(60);

    const markdown = await sm.getScriptMarkdown("history_of_rome");
    expect(markdown).toContain("Chapter 1: From Mythic Mud to Republic");

    const val = await sm.validateScript("history_of_rome");
    expect(val.valid).toBe(true);
    expect(val.errors.length).toBe(0);
  });

  it("inspects segment claim traceability", async () => {
    await sm.generateScript("history_of_rome");
    const inspected = await sm.inspectSegment("history_of_rome", "narration_001");
    expect(inspected.segment.segment_id).toBe("narration_001");
    expect(inspected.linkedClaims.length).toBeGreaterThan(0);
    expect(inspected.linkedClaims[0]?.claim?.claim_id).toBe("clm_founding_legend");
  });

  it("approves script and updates project checkpoints", async () => {
    await sm.generateScript("history_of_rome");
    const approved = await sm.approveScript("history_of_rome");
    expect(approved.status).toBe("approved");

    const project = await pm.loadProject("history_of_rome");
    expect(project.checkpoints.scriptApproved).toBe(true);
  });
});

