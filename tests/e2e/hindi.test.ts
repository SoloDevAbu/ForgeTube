import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { createSample, SAMPLE_ID, SAMPLE_TOPIC, type SampleProject } from "../fixtures-sample.js";
import { createTestAudio, createTestImage } from "../fixtures.js";
import { hindiScriptMarkdown, hindiStoryboardText, HINDI_SEGMENTS } from "../fixtures-hindi.js";
import { AssetManager } from "../../src/core/assets/assetManager.js";
import { CalibrationManager } from "../../src/core/calibration/calibrationManager.js";
import { AudioManager } from "../../src/core/audio/audioManager.js";
import { VoiceManager } from "../../src/core/audio/voiceManager.js";
import { MusicLibrary } from "../../src/core/audio/musicLibrary.js";
import { AudioMixer, measureLoudness } from "../../src/core/audio/mixer.js";
import { TimelineCompiler } from "../../src/core/timeline/timelineCompiler.js";
import { VariantManager } from "../../src/core/projects/variantManager.js";
import { splitWords } from "../../src/core/script/scriptFormat.js";

const HINDI_ID = `${SAMPLE_TOPIC}/hindi`;

describe("Hindi version from the English film to a mix", () => {
  let sample: SampleProject;
  let root: string;
  let tc: TimelineCompiler;
  let mixer: AudioMixer;
  let music: MusicLibrary;
  let am: AssetManager;

  beforeAll(async () => {
    sample = await createSample("storyboard");
    process.env.FORGETUBE_MUSIC_DIR = path.join(sample.tmpDir, "music");
    process.env.FORGETUBE_EARSHOT = "";
    root = sample.pm.getProjectRoot(HINDI_ID);

    const audio = new AudioManager(sample.pm);
    tc = new TimelineCompiler(sample.pm, audio);
    music = new MusicLibrary(sample.pm);
    mixer = new AudioMixer(sample.pm, tc, music);
    am = new AssetManager(sample.pm);

    // The English film gets its images and crops first.
    const base = await sample.stm.getStoryboard(SAMPLE_ID);
    const flow = path.join(sample.tmpDir, "flow");
    for (const [i] of base.scenes.entries()) {
      await createTestImage(path.join(flow, `Flow_${String(i).padStart(3, "0")}.png`), 1920, 1080, "navy");
    }
    await am.importImages(SAMPLE_ID, { inputPath: flow, order: true });
    await new CalibrationManager(sample.pm).applyPreset(SAMPLE_ID, "gemini-watermark");

    await new VariantManager(sample.pm).addVersion(SAMPLE_TOPIC, "hindi");
    const write = async (name: string, content: string) => {
      const p = path.join(sample.tmpDir, name);
      await fs.writeFile(p, content, "utf-8");
      return p;
    };
    await sample.sm.importScript(HINDI_ID, await write("hi.md", hindiScriptMarkdown()));
    await sample.sm.approveScript(HINDI_ID);
    await sample.stm.importStoryboard(
      HINDI_ID,
      await write("hi.txt", hindiStoryboardText(base.scenes.map((s) => s.sceneId)))
    );
    await sample.stm.approveStoryboard(HINDI_ID);
  }, 120_000);

  afterAll(async () => {
    delete process.env.FORGETUBE_MUSIC_DIR;
    delete process.env.FORGETUBE_EARSHOT;
    await sample.cleanup();
  });

  it("needs only the one new image", async () => {
    const exported = await sample.stm.exportPrompts(HINDI_ID);
    expect(exported.promptCount).toBe(1);

    const image = path.join(sample.tmpDir, "new", "Flow_new.png");
    await createTestImage(image, 1920, 1080, "maroon");
    const result = await am.importImages(HINDI_ID, { inputPath: image, order: true });
    expect(result.importedCount).toBe(1);
    expect(result.missingScenes).toEqual([]);
    expect((await sample.pm.loadProject(HINDI_ID)).checkpoints.assetsImported).toBe(true);
  }, 60_000);

  it("times Hindi shots from its own voice, within five seconds each", async () => {
    const voice = new VoiceManager(sample.pm, sample.sm, new AudioManager(sample.pm));
    for (const [segmentId, text] of Object.entries(HINDI_SEGMENTS)) {
      const file = path.join(sample.tmpDir, "hi-voice", `${segmentId}.wav`);
      await createTestAudio(file, Number(((splitWords(text).length / 140) * 60).toFixed(2)), 180);
      await voice.importRecording(HINDI_ID, file, segmentId);
    }
    await tc.compileTimeline(HINDI_ID);
    // Hindi words fall differently, so boundaries move to fit the limit, as in the real flow.
    expect((await sample.stm.rebalance(HINDI_ID, tc)).unresolved).toEqual([]);
    const manifest = await tc.compileTimeline(HINDI_ID);
    expect(manifest.metadata.usesEstimatedTiming).toBe(false);
    for (const scene of manifest.scenes) expect(scene.durationFrames).toBeLessThanOrEqual(150);
    expect((await tc.validateTimeline(HINDI_ID)).errors).toEqual([]);
    for (const scene of manifest.scenes) expect(existsSync(path.join(root, scene.imagePath))).toBe(true);
  }, 60_000);

  it("mixes the bed far under the voice", async () => {
    const dir = process.env.FORGETUBE_MUSIC_DIR!;
    await createTestAudio(path.join(dir, "dark_drones.wav"), 40, 110);
    await createTestAudio(path.join(dir, "reverent_strings.wav"), 40, 330);
    await music.scan();
    await music.plan(HINDI_ID, await sample.stm.getStoryboard(HINDI_ID));

    const record = await mixer.mix(HINDI_ID);
    expect(record.hasMusic).toBe(true);
    expect(Math.abs(record.lufs - -14)).toBeLessThan(1.5);

    const stems = path.join(root, "editing", "stems");
    const voice = await measureLoudness(path.join(stems, "voice.wav"));
    const bed = await measureLoudness(path.join(stems, "music.wav"));
    expect(voice.lufs - bed.lufs).toBeGreaterThan(14);
  }, 180_000);
});
