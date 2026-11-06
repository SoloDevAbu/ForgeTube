import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import type { RenderManifest } from "../schemas/renderManifest.js";
import { inspectMedia } from "../assets/mediaInspector.js";
import { framesToSeconds } from "../timeline/timeMath.js";
import { RenderError } from "../../shared/errors.js";

/**
 * Checks if the rendered video has an active audio stream.
 * If audio is configured in the manifest but missing in the Remotion output,
 * mixes the audio tracks using FFmpeg and muxes them into the final video file.
 */
export async function ensureAudioMuxed(
  videoPath: string,
  manifest: RenderManifest,
  projectRoot: string
): Promise<void> {
  const meta = await inspectMedia(videoPath);
  const hasAudioStream = (meta.channels && meta.channels > 0) || false;

  const audioEvents = [
    ...manifest.audio.voiceTracks.map((v) => ({
      file: path.join(projectRoot, v.file),
      delayMs: Math.round(framesToSeconds(v.startFrame, manifest.fps) * 1000),
      volume: v.volume,
    })),
    ...manifest.audio.soundEffects.map((s) => ({
      file: path.join(projectRoot, s.file),
      delayMs: Math.round(framesToSeconds(s.startFrame, manifest.fps) * 1000),
      volume: s.volume,
    })),
    ...manifest.audio.musicBeds.map((m) => ({
      file: path.join(projectRoot, m.file),
      delayMs: Math.round(framesToSeconds(m.startFrame, manifest.fps) * 1000),
      volume: m.volume,
    })),
  ].filter((a) => existsSync(a.file));

  if (hasAudioStream || audioEvents.length === 0) {
    return;
  }

  // Build FFmpeg complex filter to delay, scale volume, and mix audio tracks
  const args: string[] = ["-y", "-i", videoPath];
  for (const a of audioEvents) {
    args.push("-i", a.file);
  }

  // Filter complex: delay and volume for each audio input
  const filterParts: string[] = [];
  const mixInputs: string[] = [];

  for (let i = 0; i < audioEvents.length; i++) {
    const inputIdx = i + 1; // 0 is video
    const a = audioEvents[i]!;
    const label = `a${i}`;
    filterParts.push(
      `[${inputIdx}:a]adelay=${a.delayMs}|${a.delayMs},volume=${a.volume}[${label}]`
    );
    mixInputs.push(`[${label}]`);
  }

  filterParts.push(
    `${mixInputs.join("")}amix=inputs=${audioEvents.length}:duration=longest:dropout_transition=2,apad,volume=${manifest.audio.masterVolume}[aout]`
  );

  const tempMuxPath = path.join(
    path.dirname(videoPath),
    `.muxed_${path.basename(videoPath)}`
  );

  args.push(
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    `${manifest.totalDurationSeconds}`,
    tempMuxPath
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new RenderError(`FFmpeg audio muxing failed (code ${code}): ${stderr}`));
      } else {
        resolve();
      }
    });

    child.on("error", (err) => {
      reject(new RenderError(`Failed to spawn FFmpeg for audio muxing: ${err.message}`));
    });
  });

  // Replace original video with muxed video
  try {
    await fs.unlink(videoPath);
  } catch {}
  await fs.rename(tempMuxPath, videoPath);
}

