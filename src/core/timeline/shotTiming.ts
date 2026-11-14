import { framesToSeconds } from "./timeMath.js";

export interface SegmentTiming {
  segmentId: string;
  chapterId: string;
  wordCount: number;
  /** Measured voice length. Null means timing comes from a word-count estimate. */
  voiceSeconds: number | null;
  /** Start of each word in seconds, from the voice's word timings. */
  wordStarts: number[] | null;
}

export interface ShotInput {
  sceneId: string;
  segmentId: string;
  wordStart: number | null;
  wordEnd: number | null;
  transitionType: string;
  transitionSeconds: number;
  allowShort?: boolean;
}

export interface TimedShot {
  sceneId: string;
  /** Where this shot takes over, in frames. */
  boundaryFrame: number;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  transitionFrames: number;
  overlapFrames: number;
  fadeOutFrames: number;
}

export interface TimedSegment {
  segmentId: string;
  chapterId: string;
  startFrame: number;
  voiceFrames: number;
  endFrame: number;
  estimated: boolean;
}

export interface TimingOptions {
  fps: number;
  speakingRateWpm: number;
  segmentGapSeconds: number;
  chapterGapSeconds: number;
}

export interface TimingResult {
  shots: TimedShot[];
  segments: TimedSegment[];
  totalFrames: number;
}

/** Start of a word in seconds, inside its segment. */
function wordStartSeconds(segment: SegmentTiming, voiceSeconds: number, wordIndex: number): number {
  const fromVoice = segment.wordStarts?.[wordIndex];
  if (fromVoice !== undefined) return fromVoice;
  return segment.wordCount > 0 ? (wordIndex / segment.wordCount) * voiceSeconds : 0;
}

export function estimateSeconds(wordCount: number, wpm: number): number {
  return (wordCount / wpm) * 60;
}

/**
 * Times every shot from the narration. Voice decides segment length, word
 * starts decide shot boundaries, and every value is a whole frame. A dissolve
 * extends the outgoing shot past the boundary, so it can never eat narration
 * or the gap after it.
 */
export function computeShotTiming(
  segments: SegmentTiming[],
  shots: ShotInput[],
  options: TimingOptions
): TimingResult {
  const { fps } = options;
  const shotsBySegment = new Map<string, ShotInput[]>();
  for (const shot of shots) {
    const list = shotsBySegment.get(shot.segmentId) ?? [];
    list.push(shot);
    shotsBySegment.set(shot.segmentId, list);
  }

  const timedSegments: TimedSegment[] = [];
  const boundaries: { shot: ShotInput; boundaryFrame: number }[] = [];
  let cursor = 0;

  segments.forEach((segment, i) => {
    const estimated = segment.voiceSeconds === null;
    const voiceSeconds = segment.voiceSeconds ?? estimateSeconds(segment.wordCount, options.speakingRateWpm);
    const voiceFrames = Math.max(1, Math.ceil(voiceSeconds * fps));
    const next = segments[i + 1];
    const gapSeconds =
      next && next.chapterId !== segment.chapterId ? options.chapterGapSeconds : options.segmentGapSeconds;
    const endFrame = cursor + voiceFrames + Math.round(gapSeconds * fps);

    timedSegments.push({
      segmentId: segment.segmentId,
      chapterId: segment.chapterId,
      startFrame: cursor,
      voiceFrames,
      endFrame,
      estimated,
    });

    const segmentShots = shotsBySegment.get(segment.segmentId) ?? [];
    segmentShots.forEach((shot, shotIndex) => {
      let offsetSeconds: number;
      if (shotIndex === 0) offsetSeconds = 0;
      else if (shot.wordStart === null) offsetSeconds = (shotIndex / segmentShots.length) * voiceSeconds;
      else offsetSeconds = wordStartSeconds(segment, voiceSeconds, shot.wordStart);
      boundaries.push({ shot, boundaryFrame: cursor + Math.round(offsetSeconds * fps) });
    });

    cursor = endFrame;
  });

  const timedShots: TimedShot[] = boundaries.map(({ shot, boundaryFrame }, i) => {
    const nextBoundary = boundaries[i + 1]?.boundaryFrame ?? cursor;
    const room = nextBoundary - boundaryFrame;
    const isFirst = i === 0;
    const wantFrames = shot.transitionType === "cut" || isFirst && shot.transitionType === "cross_dissolve"
      ? 0
      : Math.round(shot.transitionSeconds * fps);
    return {
      sceneId: shot.sceneId,
      boundaryFrame,
      startFrame: boundaryFrame,
      endFrame: nextBoundary,
      durationFrames: room,
      transitionFrames: Math.min(wantFrames, Math.max(0, Math.floor(room * 0.4))),
      overlapFrames: 0,
      fadeOutFrames: 0,
    };
  });

  for (let i = 1; i < timedShots.length; i++) {
    const outgoing = timedShots[i - 1]!;
    const incoming = timedShots[i]!;
    const type = boundaries[i]!.shot.transitionType;
    if (type === "cross_dissolve") {
      // Outgoing picture keeps playing underneath the dissolve.
      incoming.overlapFrames = incoming.transitionFrames;
      outgoing.endFrame += incoming.overlapFrames;
      outgoing.durationFrames += incoming.overlapFrames;
    } else if (type === "fade_black" || type === "fade_white") {
      outgoing.fadeOutFrames = Math.min(incoming.transitionFrames, Math.floor(outgoing.durationFrames * 0.4));
    }
  }

  return { shots: timedShots, segments: timedSegments, totalFrames: cursor };
}

export interface ShotLengthIssue {
  sceneId: string;
  kind: "too_long" | "too_short";
  seconds: number;
}

export function findShotLengthIssues(
  timing: TimingResult,
  shots: ShotInput[],
  limits: { fps: number; maxSeconds: number; minSeconds: number }
): ShotLengthIssue[] {
  const allowShort = new Map(shots.map((s) => [s.sceneId, s.allowShort ?? false]));
  const maxFrames = Math.round(limits.maxSeconds * limits.fps);
  const minFrames = Math.round(limits.minSeconds * limits.fps);
  const issues: ShotLengthIssue[] = [];
  for (const shot of timing.shots) {
    const seconds = framesToSeconds(shot.durationFrames, limits.fps);
    if (shot.durationFrames > maxFrames) issues.push({ sceneId: shot.sceneId, kind: "too_long", seconds });
    else if (shot.durationFrames < minFrames && !allowShort.get(shot.sceneId)) {
      issues.push({ sceneId: shot.sceneId, kind: "too_short", seconds });
    }
  }
  return issues;
}

export interface RebalanceResult {
  /** New wordStart per scene. Every shot but the first in a segment can move. */
  moves: { sceneId: string; wordStart: number }[];
  unresolved: { sceneId: string; segmentId: string; seconds: number; suggestion: string }[];
}

const SHORT_SHOT_PENALTY = 1000;

/**
 * Finds word boundaries that keep every shot within the limit, moving them as
 * few words as possible. A short shot is allowed only when nothing else fits.
 * Returns null when no choice of boundaries works.
 */
function fitShots(
  current: number[],
  wordCount: number,
  wordFrame: (word: number) => number,
  totalFrames: number,
  maxFrames: number,
  minFrames: number
): number[] | null {
  const n = current.length;
  const lengthCost = (frames: number) =>
    frames > maxFrames ? Infinity : frames < minFrames ? SHORT_SHOT_PENALTY : 0;

  // costs[i][w]: cheapest way to end up with shot i starting at word w.
  const costs = current.map(() => new Array<number>(wordCount).fill(Infinity));
  const from = current.map(() => new Array<number>(wordCount).fill(-1));
  costs[0]![0] = 0;

  for (let i = 1; i < n; i++) {
    for (let w = i; w < wordCount; w++) {
      for (let previous = i - 1; previous < w; previous++) {
        const cost =
          costs[i - 1]![previous]! +
          lengthCost(wordFrame(w) - wordFrame(previous)) +
          Math.abs(w - current[i]!);
        if (cost < costs[i]![w]!) {
          costs[i]![w] = cost;
          from[i]![w] = previous;
        }
      }
    }
  }

  let last = -1;
  let lowest = Infinity;
  for (let w = n - 1; w < wordCount; w++) {
    const cost = costs[n - 1]![w]! + lengthCost(totalFrames - wordFrame(w));
    if (cost < lowest) {
      lowest = cost;
      last = w;
    }
  }
  if (last < 0) return null;

  const starts = new Array<number>(n).fill(0);
  starts[n - 1] = last;
  for (let i = n - 1; i > 0; i--) starts[i - 1] = from[i]![starts[i]!]!;
  return starts;
}

/**
 * Moves word boundaries between neighbouring shots until each fits the limit.
 * Only segments with an over-long shot change, so working shots stay put. If a
 * segment simply has too few shots for its length, it reports how many more
 * images it needs.
 */
export function rebalanceShots(
  segments: SegmentTiming[],
  shots: ShotInput[],
  options: TimingOptions & { maxShotSeconds: number; minShotSeconds?: number }
): RebalanceResult {
  const timing = computeShotTiming(segments, shots, options);
  const durationByScene = new Map(timing.shots.map((s) => [s.sceneId, s.durationFrames]));
  const moves: RebalanceResult["moves"] = [];
  const unresolved: RebalanceResult["unresolved"] = [];
  const maxFrames = Math.round(options.maxShotSeconds * options.fps);
  const minFrames = Math.round((options.minShotSeconds ?? 0) * options.fps);

  for (const seg of timing.segments) {
    const segShots = shots.filter((s) => s.segmentId === seg.segmentId);
    if (!segShots.some((s) => (durationByScene.get(s.sceneId) ?? 0) > maxFrames)) continue;

    const segment = segments.find((s) => s.segmentId === seg.segmentId)!;
    // The same voice length the compiler uses, so both place a word on the same frame.
    const voiceSeconds = segment.voiceSeconds ?? estimateSeconds(segment.wordCount, options.speakingRateWpm);
    const wordFrame = (w: number) => Math.round(wordStartSeconds(segment, voiceSeconds, w) * options.fps);
    const totalFrames = seg.endFrame - seg.startFrame;
    const n = segShots.length;

    const starts = segShots.map((s, i) => (i === 0 ? 0 : (s.wordStart ?? 0)));
    const best = fitShots(starts, segment.wordCount, wordFrame, totalFrames, maxFrames, minFrames);
    if (best) best.forEach((w, i) => (starts[i] = w));

    const edges = [...starts.map(wordFrame), totalFrames];
    const stillLong =segShots.findIndex((_, i) => edges[i + 1]! - edges[i]! > maxFrames);
    if (stillLong >= 0) {
      const scene = segShots[stillLong]!;
      const needed = Math.ceil(totalFrames / maxFrames) - n;
      const word = Math.min(segment.wordCount - 1, Math.round(segment.wordCount * (1 - 1 / (n + 1))));
      unresolved.push({
        sceneId: scene.sceneId,
        segmentId: seg.segmentId,
        seconds: framesToSeconds(edges[stillLong + 1]! - edges[stillLong]!, options.fps),
        suggestion:
          needed > 0
            ? `${seg.segmentId} needs ${needed} more image(s); split near word ${word}`
            : `${seg.segmentId} has a pause too long for its word boundaries; add an image across it`,
      });
      continue;
    }

    segShots.forEach((shot, i) => {
      if (i > 0 && shot.wordStart !== starts[i]) moves.push({ sceneId: shot.sceneId, wordStart: starts[i]! });
    });
  }

  return { moves, unresolved };
}
