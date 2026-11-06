import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

const expect = (actual: any) => ({
  toBe: (expected: any) => assert.strictEqual(actual, expected),
  toBeGreaterThan: (expected: number) => assert.ok(actual > expected, `${actual} not > ${expected}`),
  toContain: (expected: string) => assert.ok(String(actual).includes(expected), `${actual} does not contain ${expected}`),
  toBeDefined: () => assert.ok(actual !== undefined && actual !== null, "expected to be defined"),
});
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ProjectManager } from "../src/core/projects/projectManager.js";
import { ResearchManager } from "../src/core/research/researchManager.js";
import { ScriptManager } from "../src/core/script/scriptManager.js";
import { StoryboardManager } from "../src/core/storyboard/storyboardManager.js";
import { AssetManager } from "../src/core/assets/assetManager.js";
import { CalibrationManager } from "../src/core/calibration/calibrationManager.js";
import { AudioManager } from "../src/core/audio/audioManager.js";
import { TimelineCompiler } from "../src/core/timeline/timelineCompiler.js";
import { JobManager } from "../src/core/jobs/jobManager.js";
import { RenderService } from "../src/core/render/renderService.js";
import { createTestImage, createTestAudio } from "./fixtures.js";

describe("End-to-End Video Production Pipeline", () => {
  let tmpDir: string;
  let pm: ProjectManager;
  let rm: ResearchManager;
  let sm: ScriptManager;
  let stm: StoryboardManager;
  let am: AssetManager;
  let cm: CalibrationManager;
  let audioMgr: AudioManager;
  let tc: TimelineCompiler;
  let rs: RenderService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "forgetube-e2e-"));
    pm = new ProjectManager(tmpDir);
    rm = new ResearchManager(pm);
    sm = new ScriptManager(pm, rm);
    stm = new StoryboardManager(pm, sm, rm);
    am = new AssetManager(pm);
    cm = new CalibrationManager(pm);
    audioMgr = new AudioManager(pm);
    tc = new TimelineCompiler(pm, audioMgr);
    const jm = new JobManager(pm);
    rs = new RenderService(pm, tc, jm);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it(
    "executes complete lifecycle: research -> script -> storyboard -> prompts -> assets -> calibration -> audio -> timeline -> preview -> draft render",
    async () => {
      const projectId = "rome_slice";

      // 1. Create project
      const project = await pm.createProject({
        name: "Rome Slice",
        topic: "The complete history of Rome",
        targetMinutes: 1,
        width: 1280,
        height: 720,
        fps: 30,
      });
      expect(project.id).toBe(projectId);

      // 2. Research workflow
      await rm.runResearch(projectId);
      const resVal = await rm.validateResearch(projectId);
      expect(resVal.valid).toBe(true);
      await rm.approveResearch(projectId);

      // 3. Script workflow
      await sm.generateScript(projectId);
      const scriptVal = await sm.validateScript(projectId);
      expect(scriptVal.valid).toBe(true);
      await sm.approveScript(projectId);

      // 4. Storyboard workflow
      await stm.generateStoryboard(projectId);
      // Trim to 3 scenes for acceptance test
      const scenesPath = path.join(pm.getProjectRoot(projectId), "storyboard", "scenes.json");
      const scenesData = JSON.parse(await fs.readFile(scenesPath, "utf-8"));
      scenesData.scenes = scenesData.scenes.slice(0, 3);
      // Ensure scene 0 is cut, scene 1 is cross_dissolve, scene 2 is fade_black
      scenesData.scenes[0].suggestedDurationSeconds = 2.5;
      scenesData.scenes[0].transition = { type: "cut", durationSeconds: 0 };
      scenesData.scenes[0].camera = { effect: "slow_zoom_in", intensity: 0.08, origin: "center" };
      scenesData.scenes[1].suggestedDurationSeconds = 2.5;
      scenesData.scenes[1].transition = { type: "cross_dissolve", durationSeconds: 0.5 };
      scenesData.scenes[1].camera = { effect: "pan_right", intensity: 0.08, origin: "center" };
      scenesData.scenes[2].suggestedDurationSeconds = 2.5;
      scenesData.scenes[2].transition = { type: "fade_black", durationSeconds: 0.5 };
      scenesData.scenes[2].camera = { effect: "slow_zoom_out", intensity: 0.08, origin: "center" };
      await fs.writeFile(scenesPath, JSON.stringify(scenesData, null, 2));

      await stm.approveStoryboard(projectId);

      // 5. Google Flow manual prompt handoff
      const exportRes = await stm.exportPrompts(projectId);
      expect(exportRes.promptCount).toBeGreaterThan(0);
      const pausedProject = await pm.loadProject(projectId);
      expect(pausedProject.status).toBe("WAITING_FOR_MANUAL_IMAGES");

      // 6. Generate 3 fixture images & import
      for (let i = 1; i <= 3; i++) {
        const sceneId = `scene_${String(i).padStart(3, "0")}`;
        const imgPath = path.join(tmpDir, `${sceneId}.png`);
        const color = i === 1 ? "red" : i === 2 ? "green" : "blue";
        await createTestImage(imgPath, 1920, 1080, color);
        await am.importImages(projectId, { inputPath: imgPath, sceneId });
      }

      const assetVal = await am.validateAssets(projectId);
      expect(assetVal.valid).toBe(true);
      expect(assetVal.totalImportedAssets).toBe(3);

      // 7. Calibration
      const calib = await cm.setCalibration(projectId, "scene_001", {
        fit: "manual",
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.8,
      });
      expect(calib.fit).toBe("manual");

      const previewStill = await cm.generateCalibrationPreview(projectId, "scene_001");
      expect(previewStill.previewPath).toContain("scene_001_preview.png");
      await cm.approveCalibration(projectId);

      // 8. Audio Import: 2 narration files, 2 sound effects, 1 music bed
      const voice1 = path.join(tmpDir, "voice_001.wav");
      const voice2 = path.join(tmpDir, "voice_002.wav");
      await createTestAudio(voice1, 2.0, 440);
      await createTestAudio(voice2, 2.5, 520);
      await audioMgr.importVoiceAudio(projectId, { inputPath: voice1, sceneId: "scene_001" });
      await audioMgr.importVoiceAudio(projectId, { inputPath: voice2, sceneId: "scene_002" });

      const sfx1 = path.join(tmpDir, "sfx_wind.wav");
      const sfx2 = path.join(tmpDir, "sfx_chime.wav");
      await createTestAudio(sfx1, 1.0, 880);
      await createTestAudio(sfx2, 1.0, 660);
      await audioMgr.importSoundEffect(projectId, { inputPath: sfx1, sceneId: "scene_001", volume: 0.3 });
      await audioMgr.importSoundEffect(projectId, { inputPath: sfx2, sceneId: "scene_002", volume: 0.4 });

      const music = path.join(tmpDir, "music_ambient.wav");
      await createTestAudio(music, 10.0, 220);
      await audioMgr.importMusicBed(projectId, { inputPath: music, volume: 0.2, ducking: true });

      // 9. Timeline Compilation
      const manifest = await tc.compileTimeline(projectId, { mode: "draft" });
      expect(manifest.scenes.length).toBe(3);
      expect(manifest.audio.voiceTracks.length).toBe(2);
      expect(manifest.audio.soundEffects.length).toBe(2);
      expect(manifest.audio.musicBeds.length).toBe(1);

      const timelineVal = await tc.validateTimeline(projectId);
      expect(timelineVal.valid).toBe(true);

      // 10. Scene Still Preview via Remotion
      const stillPath = await rs.renderSceneStill(projectId, "scene_001");
      expect(stillPath).toBeDefined();
      const stillStat = await fs.stat(stillPath);
      expect(stillStat.size).toBeGreaterThan(0);

      // 11. Render Draft Video via Remotion & Validate with FFprobe
      const renderResult = await rs.renderVideo(projectId, { mode: "draft" });
      expect(renderResult.outputPath).toBeDefined();
      expect(renderResult.validation.valid).toBe(true);
      expect(renderResult.validation.fileSizeBytes).toBeGreaterThan(0);
      expect(renderResult.validation.hasAudio).toBe(true);
      expect(renderResult.validation.durationSeconds).toBeGreaterThan(0);
    },
    { timeout: 120_000 } // 2 minute timeout for Remotion bundling + rendering
  );
});

