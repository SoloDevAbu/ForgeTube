import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ProjectManager } from "../src/core/projects/projectManager.js";
import { ResearchManager } from "../src/core/research/researchManager.js";
import { ScriptManager } from "../src/core/script/scriptManager.js";
import { StoryboardManager } from "../src/core/storyboard/storyboardManager.js";
import { AssetManager } from "../src/core/assets/assetManager.js";
import { AudioManager } from "../src/core/audio/audioManager.js";
import { TimelineCompiler } from "../src/core/timeline/timelineCompiler.js";
import { secondsToFrames, framesToSeconds } from "../src/core/timeline/timeMath.js";
import { createTestImage, createTestAudio } from "./fixtures.js";

describe("Timeline Compiler & Audio", () => {
  let tmpDir: string;
  let pm: ProjectManager;
  let rm: ResearchManager;
  let sm: ScriptManager;
  let stm: StoryboardManager;
  let am: AssetManager;
  let audioMgr: AudioManager;
  let tc: TimelineCompiler;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "forgetube-timeline-test-"));
    pm = new ProjectManager(tmpDir);
    rm = new ResearchManager(pm);
    sm = new ScriptManager(pm, rm);
    stm = new StoryboardManager(pm, sm, rm);
    am = new AssetManager(pm);
    audioMgr = new AudioManager(pm);
    tc = new TimelineCompiler(pm, audioMgr);

    await pm.createProject({
      name: "History of Rome",
      topic: "The complete history of Rome",
      targetMinutes: 12,
    });
    await rm.runResearch("history_of_rome");
    await rm.approveResearch("history_of_rome");
    await sm.generateScript("history_of_rome");
    await sm.approveScript("history_of_rome");
    await stm.generateStoryboard("history_of_rome");
    await stm.approveStoryboard("history_of_rome");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("converts time to frames and back deterministically", () => {
    expect(secondsToFrames(1.0, 30)).toBe(30);
    expect(secondsToFrames(0.5, 30)).toBe(15);
    expect(secondsToFrames(4.7, 30)).toBe(141);
    expect(framesToSeconds(141, 30)).toBe(4.7);
  });

  it("imports narration audio and compiles timeline with transition overlaps", async () => {
    // Generate fixture images for first 3 scenes
    const root = pm.getProjectRoot("history_of_rome");
    for (let i = 1; i <= 3; i++) {
      const sceneId = `scene_${String(i).padStart(3, "0")}`;
      const imgPath = path.join(tmpDir, `${sceneId}.png`);
      await createTestImage(imgPath, 1920, 1080, "blue");
      await am.importImages("history_of_rome", { inputPath: imgPath, sceneId });
    }

    // Import a narration audio file of 3 seconds for scene_001
    const voicePath = path.join(tmpDir, "scene_001.wav");
    await createTestAudio(voicePath, 3.0, 440);
    const audioImport = await audioMgr.importVoiceAudio("history_of_rome", {
      inputPath: voicePath,
      sceneId: "scene_001",
    });

    expect(audioImport.importedCount).toBe(1);
    expect(audioImport.importedTracks[0]?.durationSeconds).toBeCloseTo(3.0, 1);

    // Compile timeline for first 3 scenes
    const scenesPath = path.join(root, "storyboard", "scenes.json");
    const scenesData = JSON.parse(await fs.readFile(scenesPath, "utf-8"));
    scenesData.scenes = scenesData.scenes.slice(0, 3);
    await fs.writeFile(scenesPath, JSON.stringify(scenesData));

    const manifest = await tc.compileTimeline("history_of_rome");
    expect(manifest.scenes.length).toBe(3);
    expect(manifest.scenes[0]?.startFrame).toBe(0);
    expect(manifest.scenes[0]?.endFrame).toBeGreaterThan(0);

    // Verify scene 1 starts at scene 0 endFrame minus overlapFrames
    const s0 = manifest.scenes[0]!;
    const s1 = manifest.scenes[1]!;
    expect(s1.startFrame).toBe(s0.endFrame - s1.transition.overlapFrames);

    // Total duration equals last scene's endFrame
    const lastScene = manifest.scenes[manifest.scenes.length - 1]!;
    expect(manifest.totalDurationFrames).toBe(lastScene.endFrame);

    // Validate timeline
    const report = await tc.validateTimeline("history_of_rome");
    expect(report.valid).toBe(true);
    expect(report.errors.length).toBe(0);
  });
});

