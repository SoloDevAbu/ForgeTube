import crypto from "node:crypto";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import type { CompiledScene, RenderManifest } from "../schemas/renderManifest.js";

export interface RenderChunk {
  id: string;
  firstFrame: number;
  /** Inclusive, as Remotion's frameRange expects. */
  lastFrame: number;
  frames: number;
  hash: string;
}

export interface QualityProfile {
  name: string;
  scale: number;
  crf: number;
  x264Preset: string;
  jpegQuality: number;
  concurrencyFactor: number;
}

export const PROFILES: Record<"final" | "draft", QualityProfile> = {
  final: { name: "final", scale: 1, crf: 17, x264Preset: "slow", jpegQuality: 96, concurrencyFactor: 1 },
  draft: { name: "draft", scale: 0.5, crf: 26, x264Preset: "veryfast", jpegQuality: 80, concurrencyFactor: 1.5 },
};

const TARGET_CHUNK_FRAMES = 1800;

/** Identity of an image: changes when the file does. */
function imageKey(projectRoot: string, relativePath: string): string {
  const full = path.join(projectRoot, relativePath);
  if (!existsSync(full)) return `${relativePath}:missing`;
  const stat = statSync(full);
  return `${relativePath}:${stat.size}:${Math.round(stat.mtimeMs)}`;
}

function hashRange(
  manifest: RenderManifest,
  scenes: CompiledScene[],
  first: number,
  last: number,
  profile: QualityProfile,
  rendererHash: string,
  projectRoot: string
): string {
  // Frames are relative, so a timing change earlier in the film keeps this chunk.
  const content = scenes
    .filter((s) => s.startFrame <= last && s.endFrame > first)
    .map((s) => ({
      start: s.startFrame - first,
      end: s.endFrame - first,
      image: imageKey(projectRoot, s.imagePath),
      fit: s.fit,
      crop: s.crop,
      camera: s.camera,
      transition: s.transition,
    }));
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        content,
        frames: last - first + 1,
        size: [manifest.width, manifest.height, manifest.fps],
        profile,
        rendererHash,
      })
    )
    .digest("hex")
    .slice(0, 24);
}

/**
 * Splits the film at scene boundaries, restarting at each chapter, so a change
 * inside a chapter leaves the other chapters' chunks valid.
 */
export function planChunks(
  manifest: RenderManifest,
  profile: QualityProfile,
  rendererHash: string,
  projectRoot: string
): RenderChunk[] {
  const starts: number[] = [0];
  let chapter = manifest.scenes[0]?.chapterId;
  let groupStart = 0;

  for (const scene of manifest.scenes.slice(1)) {
    const newChapter = scene.chapterId !== chapter;
    if (newChapter || scene.startFrame - groupStart >= TARGET_CHUNK_FRAMES) {
      starts.push(scene.startFrame);
      groupStart = scene.startFrame;
      chapter = scene.chapterId;
    }
  }

  return starts.map((first, i) => {
    const last = (starts[i + 1] ?? manifest.totalDurationFrames) - 1;
    return {
      id: `chunk_${String(i + 1).padStart(3, "0")}`,
      firstFrame: first,
      lastFrame: last,
      frames: last - first + 1,
      hash: hashRange(manifest, manifest.scenes, first, last, profile, rendererHash, projectRoot),
    };
  });
}

export function planSceneChunk(
  manifest: RenderManifest,
  scene: CompiledScene,
  profile: QualityProfile,
  rendererHash: string,
  projectRoot: string
): RenderChunk {
  const last = Math.min(scene.endFrame, manifest.totalDurationFrames) - 1;
  return {
    id: scene.sceneId,
    firstFrame: scene.startFrame,
    lastFrame: last,
    frames: last - scene.startFrame + 1,
    hash: hashRange(manifest, manifest.scenes, scene.startFrame, last, profile, rendererHash, projectRoot),
  };
}
