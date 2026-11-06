import { describe, it, expect } from "bun:test";
import { computeShotTiming, findShotLengthIssues, rebalanceShots, type SegmentTiming, type ShotInput } from "../../src/core/timeline/shotTiming.js";
import { getCameraTransform } from "../../src/renderer/camera/cameraEffects.js";
import { CameraEffectValues } from "../../src/shared/types.js";
import { assignTracks } from "../../src/core/audio/musicLibrary.js";
import { layoutMusic } from "../../src/core/audio/mixer.js";
import { alignWordStarts } from "../../src/core/audio/tts/voiceTake.js";
import { computeCropParameters, validateCropAspect } from "../../src/core/calibration/cropMath.js";

const options = {
  fps: 30,
  speakingRateWpm: 130,
  segmentGapSeconds: 0.6,
  chapterGapSeconds: 2,
};

function evenWords(count: number, seconds: number): number[] {
  return Array.from({ length: count }, (_, i) => (i * seconds) / count);
}

function segment(id: string, words: number, seconds: number): SegmentTiming {
  return {
    segmentId: id,
    chapterId: "chapter_01",
    wordCount: words,
    voiceSeconds: seconds,
    wordStarts: evenWords(words, seconds),
  };
}

function shot(sceneId: string, segmentId: string, wordStart: number, wordEnd: number): ShotInput {
  return { sceneId, segmentId, wordStart, wordEnd, transitionType: "cut", transitionSeconds: 0 };
}

describe("Shot timing", () => {
  it("makes a 3 s voice clip a short scene, not an estimate-length one", () => {
    const timing = computeShotTiming([segment("a", 40, 3)], [shot("s1", "a", 0, 40)], options);
    expect(timing.totalFrames).toBeLessThan(150);
    expect(timing.shots[0]!.durationFrames).toBeGreaterThanOrEqual(90);
  });

  it("flags a shot over five seconds", () => {
    const timing = computeShotTiming([segment("a", 40, 12)], [shot("s1", "a", 0, 40)], options);
    const issues = findShotLengthIssues(timing, [shot("s1", "a", 0, 40)], { fps: 30, maxSeconds: 5, minSeconds: 0.75 });
    expect(issues.length).toBe(1);
  });

  it("rebalances uneven shots with no LLM, and stays under 150 frames", () => {
    const shots = [shot("s1", "a", 0, 34), shot("s2", "a", 34, 40), shot("s3", "a", 40, 60)];
    const rebalance = { ...options, maxShotSeconds: 5, minShotSeconds: 0.75 } as any;
    const result = rebalanceShots([segment("a", 60, 12)], shots, rebalance);
    expect(result.unresolved.length).toBe(0);

    const moved = shots.map((s) => {
      const move = result.moves.find((m) => m.sceneId === s.sceneId);
      return { ...s, wordStart: move?.wordStart ?? s.wordStart };
    });
    moved.forEach((s, i) => (s.wordEnd = moved[i + 1]?.wordStart ?? 60));
    // moved shots keep their order, so ends follow the next start.
    const timing = computeShotTiming([segment("a", 60, 12)], moved, options);
    for (const s of timing.shots) {
      expect(s.durationFrames).toBeLessThanOrEqual(150);
      expect(s.durationFrames).toBeGreaterThanOrEqual(23);
    }
  });

  it("fits a real Edge TTS take with uneven words and a long pause", () => {
    const frames = "2 5 22 42 55 59 63 104 111 114 158 193 204 209 224 248 253 287 304 308 323 326 332 357 368 377 401 406 409 446 454 473 480 501 505 508 550 563 569 593 602 605 622 634 637 644 665 675 678";
    const wordStarts = frames.split(" ").map((f) => Number(f) / 30);
    const seg = { segmentId: "a", chapterId: "c", wordCount: 49, voiceSeconds: 23.27, wordStarts };
    const shots = [0, 9, 18, 27, 36, 45].map((w, i, all) => shot(`s${i}`, "a", w, all[i + 1] ?? 49));
    const limits = { ...options, maxShotSeconds: 5, minShotSeconds: 0.75 };

    const result = rebalanceShots([seg], shots, limits);
    expect(result.unresolved).toEqual([]);

    const moved = shots.map((s) => ({ ...s, wordStart: result.moves.find((m) => m.sceneId === s.sceneId)?.wordStart ?? s.wordStart }));
    for (const s of computeShotTiming([seg], moved, options).shots) {
      expect(s.durationFrames).toBeLessThanOrEqual(150);
      expect(s.durationFrames).toBeGreaterThanOrEqual(23);
    }
  });

  it("names the image needed when moving words cannot help", () => {
    const rebalance = { ...options, maxShotSeconds: 5, minShotSeconds: 0.75 } as any;
    const result = rebalanceShots([segment("a", 60, 20)], [shot("s1", "a", 0, 60)], rebalance);
    expect(result.unresolved[0]?.sceneId).toBe("s1");
  });

  it("aligns word timing when TTS splits a word differently", () => {
    const words = [0, 1, 2, 3].map((s) => ({ word: "w", start: s, end: s + 0.5 }));
    expect(alignWordStarts(words, 4)).toEqual([0, 1, 2, 3]);
    expect(alignWordStarts(words, 2)).toEqual([0, 2]);
    expect(alignWordStarts([], 2)).toBeNull();
  });
});

describe("Camera coverage", () => {
  it("never exposes an edge for any effect, frame or intensity", () => {
    const duration = 150;
    for (const effect of CameraEffectValues) {
      for (const intensity of [0, 0.03, 0.08, 0.15, 0.25]) {
        for (const frame of [0, 1, 37, 75, 149, 150]) {
          const t = getCameraTransform(effect, intensity, frame, duration);
          const edgeX = t.scale * (0.5 - Math.abs(t.translateXPercent) / 100);
          const edgeY = t.scale * (0.5 - Math.abs(t.translateYPercent) / 100);
          expect(t.scale).toBeGreaterThanOrEqual(1 - 1e-9);
          expect(edgeX).toBeGreaterThanOrEqual(0.5 - 1e-9);
          expect(edgeY).toBeGreaterThanOrEqual(0.5 - 1e-9);
        }
      }
    }
  });
});

describe("Music plan", () => {
  it("follows the mood ranking and never repeats a track back to back", () => {
    const picks = assignTracks([
      { chapterId: "c1", mood: "dark", ranked: ["dark.wav", "bright.wav"] },
      { chapterId: "c2", mood: "dark", ranked: ["dark.wav", "bright.wav"] },
      { chapterId: "c3", mood: "dark", ranked: ["dark.wav", "bright.wav"] },
    ]);
    expect(picks.map((p) => p.file)).toEqual(["dark.wav", "bright.wav", "dark.wav"]);
  });

  it("keeps a hand-picked track, and reuses the only track when there is one", () => {
    const picks = assignTracks([
      { chapterId: "c1", mood: "", ranked: ["a.wav", "b.wav"], locked: "b.wav" },
      { chapterId: "c2", mood: "", ranked: ["only.wav"] },
      { chapterId: "c3", mood: "", ranked: ["only.wav"] },
    ]);
    expect(picks.map((p) => p.file)).toEqual(["b.wav", "only.wav", "only.wav"]);
  });

  it("loops short beds with overlapping pieces and sets gain from loudness", () => {
    const entry = { chapterId: "c", mood: "", file: "a.wav", kind: "music" as const, lufs: -13, durationSeconds: 30, locked: false };
    const pieces = layoutMusic([{ chapterStart: 0, chapterEnd: 70, entry }], { musicLufs: -23, crossfadeSeconds: 3 });
    expect(pieces.length).toBe(3);
    expect(pieces[1]!.startSeconds).toBeLessThan(pieces[0]!.startSeconds + 30);
    expect(pieces[0]!.gainDb).toBe(-10);
    const last = pieces.at(-1)!;
    expect(last.startSeconds + last.lengthSeconds).toBeCloseTo(71.5, 1);
  });
});

describe("Crop math", () => {
  it("zooms and positions cover crops inside the image at 16:9", () => {
    const p = computeCropParameters({
      sourceWidth: 1920,
      sourceHeight: 1080,
      targetWidth: 1920,
      targetHeight: 1080,
      fit: "cover",
      zoom: 1.1,
      position: { x: 0, y: 0.5 },
    });
    expect(p.normalizedCrop.x).toBe(0);
    expect(p.normalizedCrop.width).toBeCloseTo(1 / 1.1, 3);
    expect(p.normalizedCrop.width + p.normalizedCrop.x).toBeLessThanOrEqual(1);
  });

  it("refuses a manual crop that would stretch the image", () => {
    expect(() => validateCropAspect({ x: 0, y: 0, width: 1, height: 0.5 }, 1920, 1080, 16 / 9)).toThrow();
  });
});
