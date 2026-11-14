import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createSample, SAMPLE_ID, SAMPLE_SEGMENTS, type SampleProject } from "../fixtures-sample.js";
import { createTestAudio, createTestImage } from "../fixtures.js";
import { AssetManager } from "../../src/core/assets/assetManager.js";
import { CalibrationManager } from "../../src/core/calibration/calibrationManager.js";
import { AudioManager } from "../../src/core/audio/audioManager.js";
import { VoiceManager } from "../../src/core/audio/voiceManager.js";
import { MusicLibrary } from "../../src/core/audio/musicLibrary.js";
import { AudioMixer } from "../../src/core/audio/mixer.js";
import { TimelineCompiler } from "../../src/core/timeline/timelineCompiler.js";
import { JobManager } from "../../src/core/jobs/jobManager.js";
import { RenderService } from "../../src/core/render/renderService.js";
import { splitWords } from "../../src/core/script/scriptFormat.js";
import { PublishManager } from "../../src/core/publish/publishManager.js";
import { StageGraph } from "../../src/core/pipeline/stageGraph.js";

const COLORS = ["navy", "teal", "maroon", "olive", "purple", "gray"];

function probe(file: string) {
  const out = spawnSync("ffprobe", [
    "-v", "error", "-count_packets", "-show_entries",
    "stream=codec_type,codec_name,width,height,pix_fmt,color_space,nb_read_packets", "-of", "json", file,
  ]);
  return JSON.parse(out.stdout.toString()).streams as Record<string, any>[];
}

describe("Pipeline from import to final render", () => {
  let sample: SampleProject;
  let tc: TimelineCompiler;
  let render: RenderService;
  let mixer: AudioMixer;
  let music: MusicLibrary;
  let voice: VoiceManager;
  let am: AssetManager;
  let cm: CalibrationManager;
  let root: string;
  let musicDir: string;

  beforeAll(async () => {
    sample = await createSample("storyboard");
    root = sample.pm.getProjectRoot(SAMPLE_ID);
    musicDir = path.join(sample.tmpDir, "music");
    process.env.FORGETUBE_MUSIC_DIR = musicDir;
    // earshot models take minutes to load; ranking has its own file-name fallback.
    process.env.FORGETUBE_EARSHOT = "";

    const audio = new AudioManager(sample.pm);
    tc = new TimelineCompiler(sample.pm, audio);
    music = new MusicLibrary(sample.pm);
    mixer = new AudioMixer(sample.pm, tc, music);
    voice = new VoiceManager(sample.pm, sample.sm, audio);
    render = new RenderService(sample.pm, tc, new JobManager(sample.pm), mixer);
    am = new AssetManager(sample.pm);
    cm = new CalibrationManager(sample.pm);
  });

  afterAll(async () => {
    delete process.env.FORGETUBE_MUSIC_DIR;
    delete process.env.FORGETUBE_EARSHOT;
    await sample.cleanup();
  });

  it("imports Flow-named images in file order and keeps originals", async () => {
    const { scenes } = await sample.stm.getStoryboard(SAMPLE_ID);
    const flow = path.join(sample.tmpDir, "flow");
    for (const [i, _scene] of scenes.entries()) {
      await createTestImage(path.join(flow, `Flow_${String(i).padStart(3, "0")}.png`), 1920, 1080, COLORS[i % COLORS.length]);
    }
    const result = await am.importImages(SAMPLE_ID, { inputPath: flow, order: true });
    expect(result.importedCount).toBe(scenes.length);
    expect(result.missingScenes).toEqual([]);
    expect(existsSync(path.join(root, "assets/generated/originals/scene_001"))).toBe(true);

    const preset = await cm.applyPreset(SAMPLE_ID, "gemini-watermark");
    expect(preset.applied).toBe(scenes.length);
    expect((await cm.generateContactSheets(SAMPLE_ID)).sheets.length).toBe(1);
    await cm.approveCalibration(SAMPLE_ID);
  }, 60_000);

  it("refuses a final render with voice missing", async () => {
    await expect(render.renderVideo(SAMPLE_ID, { mode: "final" })).rejects.toThrow();
  }, 30_000);

  it("times shots from real voice durations and keeps each within five seconds", async () => {
    const recordings = path.join(sample.tmpDir, "voice");
    for (const [segmentId, text] of Object.entries(SAMPLE_SEGMENTS)) {
      const file = path.join(recordings, `${segmentId}.wav`);
      await createTestAudio(file, Number(((splitWords(text).length / 130) * 60).toFixed(2)), 220);
      await voice.importRecording(SAMPLE_ID, file, segmentId);
    }
    const manifest = await tc.compileTimeline(SAMPLE_ID);
    expect(manifest.metadata.usesEstimatedTiming).toBe(false);
    expect(manifest.chapters.length).toBe(2);
    for (const scene of manifest.scenes) expect(scene.durationFrames).toBeLessThanOrEqual(150);
    expect((await tc.validateTimeline(SAMPLE_ID)).errors).toEqual([]);
  }, 60_000);

  it("plans music from the folder and mixes to the loudness target", async () => {
    await createTestAudio(path.join(musicDir, "dark_drones.wav"), 40, 110);
    await createTestAudio(path.join(musicDir, "reverent_strings.wav"), 40, 330);
    expect((await music.scan()).scanned.length).toBe(2);
    expect((await music.scan()).scanned.length).toBe(0);

    const plan = await music.plan(SAMPLE_ID, await sample.stm.getStoryboard(SAMPLE_ID));
    expect(plan.entries.length).toBe(2);
    expect(plan.entries[0]!.file).not.toBe(plan.entries[1]!.file);

    const record = await mixer.mix(SAMPLE_ID);
    expect(record.hasMusic).toBe(true);
    expect(Math.abs(record.lufs - -14)).toBeLessThan(1.5);
    expect(record.truePeakDb).toBeLessThanOrEqual(-1);
    expect((await mixer.mix(SAMPLE_ID)).reused).toBe(true);
    await mixer.approve(SAMPLE_ID);
  }, 180_000);

  it("renders a scene without touching the main manifest or project state", async () => {
    const manifestPath = tc.getManifestPath(SAMPLE_ID);
    const before = await fs.readFile(manifestPath, "utf-8");
    const statusBefore = (await sample.pm.loadProject(SAMPLE_ID)).status;

    const result = await render.renderVideo(SAMPLE_ID, { mode: "scene", sceneId: "scene_002" });
    expect(result.validation.frames).toBeGreaterThan(0);

    const after = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    expect(after.scenes.length).toBe(JSON.parse(before).scenes.length);
    expect((await sample.pm.loadProject(SAMPLE_ID)).status).toBe(statusBefore);
  }, 180_000);

  it("renders a final, reuses chunks, and re-muxes on an audio-only change", async () => {
    const manifest = await tc.getRenderManifest(SAMPLE_ID);
    const first = await render.renderVideo(SAMPLE_ID, { mode: "final" });
    expect(first.chunksRendered).toBeGreaterThan(0);

    const streams = probe(first.outputPath);
    const video = streams.find((s) => s.codec_type === "video")!;
    expect(Number(video.nb_read_packets)).toBe(manifest.totalDurationFrames);
    expect(video.codec_name).toBe("h264");
    expect(video.width).toBe(1920);
    expect(video.pix_fmt).toBe("yuv420p");
    expect(video.color_space).toBe("bt709");
    expect(streams.some((s) => s.codec_type === "audio")).toBe(true);
    expect((await sample.pm.loadProject(SAMPLE_ID)).status).toBe("RENDERED");

    await music.setTrack(SAMPLE_ID, manifest.chapters[0]!.chapterId, "dark_drones.wav");
    await mixer.mix(SAMPLE_ID);
    await mixer.approve(SAMPLE_ID);
    const second = await render.renderVideo(SAMPLE_ID, { mode: "final" });
    expect(second.chunksRendered).toBe(0);
    expect(second.chunksReused).toBe(first.chunksRendered + first.chunksReused);
  }, 600_000);

  it("makes three thumbnails and packs the upload files from the measured voice", async () => {
    const publish = new PublishManager(sample.pm, tc);
    const write = async (name: string, content: string) => {
      const p = path.join(sample.tmpDir, name);
      await fs.writeFile(p, content, "utf-8");
      return p;
    };
    await expect(publish.pack(SAMPLE_ID)).rejects.toThrow("publish import");

    const thumbs = await publish.makeThumbnails(
      SAMPLE_ID,
      await write(
        "thumbs.txt",
        [
          "A | img=scene_001 | THE *LOST* TOWER | layout=left | focus=0.7,0.4",
          "B | img=scene_002 | WHY IT *FELL* | layout=bottom | accent=red",
          "C | img=scene_003 | - | layout=center",
        ].join("\n")
      )
    );
    expect(thumbs.errors).toEqual([]);
    expect(thumbs.files).toHaveLength(3);
    for (const file of thumbs.files) {
      const image = probe(file)[0]!;
      expect([image.width, image.height]).toEqual([1280, 720]);
      expect((await fs.stat(file)).size).toBeLessThan(2 * 1024 * 1024);
    }
    expect(existsSync(thumbs.sheet!)).toBe(true);

    const meta = await publish.importMetadata(
      SAMPLE_ID,
      await write(
        "meta.md",
        [
          "# titles",
          "The Pharos of Alexandria: Rise and Fall of a Wonder",
          "How the Lost Tower of Alexandria Guided Ships",
          "Why Did the Lighthouse of Alexandria Fall?",
          "# description",
          "The story of the lighthouse that guided ships into Alexandria.",
          "# hashtags",
          "#Pharos #Alexandria #History",
          "# tags",
          "pharos, lighthouse of alexandria, seven wonders",
        ].join("\n")
      )
    );
    expect(meta.report.valid).toBe(true);
    expect(meta.report.warnings.join(" ")).toContain("Thumbnail A repeats the title");

    const packed = await publish.pack(SAMPLE_ID);
    const dir = publish.getPublishDir(SAMPLE_ID);
    const srt = await fs.readFile(path.join(dir, "subtitles.srt"), "utf-8");
    expect(srt.startsWith("1\n00:00:0")).toBe(true);
    expect(srt.replace(/\n/g, " ")).toContain("Long before the great harbours of the modern world,");
    const lastCue = srt.trim().split("\n\n").at(-1)!.split("\n")[1]!.split(" --> ")[1]!;
    const [h, m, s] = lastCue.replace(",", ".").split(":").map(Number) as [number, number, number];
    expect(h * 3600 + m * 60 + s).toBeLessThanOrEqual(packed.durationSeconds + 1);

    const description = await fs.readFile(path.join(dir, "description.txt"), "utf-8");
    expect(description).toContain("Sample reference on the Pharos");
    expect(description.trim().endsWith("#Pharos #Alexandria #History")).toBe(true);
    expect((await fs.readFile(path.join(dir, "titles.txt"), "utf-8")).trim().split("\n")).toHaveLength(3);
    expect(await fs.readFile(path.join(dir, "transcript.txt"), "utf-8")).not.toContain("[pause");

    const status = await new StageGraph(sample.pm).getStatus(SAMPLE_ID);
    expect(status.find((s) => s.stage === "publish")).toMatchObject({ built: true, stale: false });
  }, 300_000);
});
