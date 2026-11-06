import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ProjectManager } from "../src/core/projects/projectManager.js";
import { ResearchManager } from "../src/core/research/researchManager.js";
import { ScriptManager } from "../src/core/script/scriptManager.js";
import { StoryboardManager } from "../src/core/storyboard/storyboardManager.js";

describe("StoryboardManager", () => {
  let tmpDir: string;
  let pm: ProjectManager;
  let rm: ResearchManager;
  let sm: ScriptManager;
  let stm: StoryboardManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "forgetube-storyboard-test-"));
    pm = new ProjectManager(tmpDir);
    rm = new ResearchManager(pm);
    sm = new ScriptManager(pm, rm);
    stm = new StoryboardManager(pm, sm, rm);

    await pm.createProject({
      name: "History of Rome",
      topic: "The complete history of Rome",
      targetMinutes: 12,
    });
    await rm.runResearch("history_of_rome");
    await rm.approveResearch("history_of_rome");
    await sm.generateScript("history_of_rome");
    await sm.approveScript("history_of_rome");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("generates storyboard with scenes and Google Flow prompts", async () => {
    const sb = await stm.generateStoryboard("history_of_rome");
    expect(sb.scenes.length).toBeGreaterThan(5);
    expect(sb.prompts.length).toBe(sb.scenes.length);
    expect(sb.visualStyleGuide.artisticDirection).toBeDefined();

    const val = await stm.validateStoryboard("history_of_rome");
    expect(val.valid).toBe(true);
    expect(val.errors.length).toBe(0);
  });

  it("exports prompts and sets project state to WAITING_FOR_MANUAL_IMAGES", async () => {
    await stm.generateStoryboard("history_of_rome");
    await stm.approveStoryboard("history_of_rome");

    const result = await stm.exportPrompts("history_of_rome", { format: "markdown" });
    expect(result.promptCount).toBeGreaterThan(5);
    expect(result.exportContent).toContain("MANUAL GENERATION CHECKPOINT");
    expect(result.exportContent).toContain("scene_001.png");

    const project = await pm.loadProject("history_of_rome");
    expect(project.status).toBe("WAITING_FOR_MANUAL_IMAGES");
    expect(project.checkpoints.promptsExported).toBe(true);
  });
});

