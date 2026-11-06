import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ProjectManager } from "../src/core/projects/projectManager.js";
import { ResearchManager } from "../src/core/research/researchManager.js";
import { ScriptManager } from "../src/core/script/scriptManager.js";
import { StoryboardManager } from "../src/core/storyboard/storyboardManager.js";
import { AssetManager } from "../src/core/assets/assetManager.js";
import { CalibrationManager } from "../src/core/calibration/calibrationManager.js";
import { computeCropParameters, validateNormalizedCrop } from "../src/core/calibration/cropMath.js";
import { createTestImage } from "./fixtures.js";

describe("Crop Math & CalibrationManager", () => {
  let tmpDir: string;
  let pm: ProjectManager;
  let rm: ResearchManager;
  let sm: ScriptManager;
  let stm: StoryboardManager;
  let am: AssetManager;
  let cm: CalibrationManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "forgetube-calib-test-"));
    pm = new ProjectManager(tmpDir);
    rm = new ResearchManager(pm);
    sm = new ScriptManager(pm, rm);
    stm = new StoryboardManager(pm, sm, rm);
    am = new AssetManager(pm);
    cm = new CalibrationManager(pm);

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

  it("validates crop math correctly for cover and manual modes", () => {
    // 1. Cover mode with wider image (2000x1000 into 1920x1080)
    const coverParams = computeCropParameters({
      sourceWidth: 2000,
      sourceHeight: 1000,
      targetWidth: 1920,
      targetHeight: 1080,
      fit: "cover",
    });
    expect(coverParams.normalizedCrop.height).toBe(1.0);
    expect(coverParams.normalizedCrop.width).toBeLessThan(1.0);
    expect(coverParams.pixelCrop.width).toBe(1778);
    expect(coverParams.pixelCrop.height).toBe(1000);

    // 2. Manual crop validation
    expect(() => {
      validateNormalizedCrop({ x: 0.2, y: 0.1, width: 0.9, height: 0.5 });
    }).toThrow(); // 0.2 + 0.9 = 1.1 > 1.0

    const validCrop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
    expect(() => validateNormalizedCrop(validCrop)).not.toThrow();
  });

  it("imports image asset and inspects dimensions with ffprobe", async () => {
    const rawImg = path.join(tmpDir, "scene_001.png");
    await createTestImage(rawImg, 1920, 1080, "red");

    const importResult = await am.importImages("history_of_rome", {
      inputPath: rawImg,
      sceneId: "scene_001",
    });

    expect(importResult.importedCount).toBe(1);
    expect(importResult.importedAssets[0]?.width).toBe(1920);
    expect(importResult.importedAssets[0]?.height).toBe(1080);
    expect(importResult.importedAssets[0]?.relativePath).toBe("assets/generated/scene_001.png");
  });

  it("sets manual calibration and generates a preview still", async () => {
    const rawImg = path.join(tmpDir, "scene_001.png");
    await createTestImage(rawImg, 1920, 1080, "gold");
    await am.importImages("history_of_rome", {
      inputPath: rawImg,
      sceneId: "scene_001",
    });

    // Set manual crop: center 80%
    const calib = await cm.setCalibration("history_of_rome", "scene_001", {
      fit: "manual",
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.8,
    });

    expect(calib.fit).toBe("manual");
    expect(calib.crop?.width).toBe(0.8);

    // Generate preview still
    const preview = await cm.generateCalibrationPreview("history_of_rome", "scene_001");
    expect(preview.previewPath).toContain("scene_001_preview.png");
    const exists = await fs.stat(preview.previewPath);
    expect(exists.size).toBeGreaterThan(0);
  });
});

