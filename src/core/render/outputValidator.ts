import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { inspectMedia } from "../assets/mediaInspector.js";
import { runCliCommand } from "../providers/cliAdapter.js";
import { RenderError } from "../../shared/errors.js";

export interface RenderExpectation {
  frames: number;
  fps: number;
  width: number;
  height: number;
  expectAudio: boolean;
}

export interface RenderValidationResult {
  valid: boolean;
  errors: string[];
  outputPath: string;
  fileSizeBytes: number;
  durationSeconds: number;
  frames: number;
  width: number;
  height: number;
  hasAudio: boolean;
  codec: string;
  pixelFormat: string;
  colorSpace: string;
}

async function probeVideoStream(file: string) {
  const result = await runCliCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-count_packets",
    "-show_entries",
    "stream=nb_read_packets,pix_fmt,color_space,avg_frame_rate",
    "-of",
    "json",
    file,
  ]);
  if (result.exitCode !== 0) throw new RenderError(`ffprobe failed: ${result.stderr}`);
  const stream = JSON.parse(result.stdout).streams?.[0] ?? {};
  const [num, den] = String(stream.avg_frame_rate ?? "0/1").split("/").map(Number);
  return {
    frames: parseInt(stream.nb_read_packets ?? "0", 10),
    pixelFormat: String(stream.pix_fmt ?? "unknown"),
    colorSpace: String(stream.color_space ?? "unknown"),
    fps: den ? num! / den : 0,
  };
}

/**
 * Validates a rendered video against what was asked for, down to the frame.
 */
export async function validateRenderOutput(
  outputPath: string,
  expected: RenderExpectation
): Promise<RenderValidationResult> {
  if (!existsSync(outputPath)) throw new RenderError(`Rendered output file does not exist at ${outputPath}`);
  const stat = await fs.stat(outputPath);
  if (stat.size === 0) throw new RenderError(`Rendered output file is empty (0 bytes): ${outputPath}`);

  const meta = await inspectMedia(outputPath);
  const video = await probeVideoStream(outputPath);
  const errors: string[] = [];

  if (video.frames !== expected.frames) {
    errors.push(`Rendered ${video.frames} frames, expected ${expected.frames}.`);
  }
  if (Math.abs(video.fps - expected.fps) > 0.01) {
    errors.push(`Rendered ${video.fps.toFixed(3)} fps, expected ${expected.fps}.`);
  }
  if (meta.width !== expected.width || meta.height !== expected.height) {
    errors.push(`Rendered ${meta.width}x${meta.height}, expected ${expected.width}x${expected.height}.`);
  }
  if (meta.codec !== "h264") errors.push(`Rendered with ${meta.codec}, expected h264.`);
  if (video.pixelFormat !== "yuv420p") errors.push(`Pixel format is ${video.pixelFormat}, expected yuv420p.`);
  if (video.colorSpace !== "bt709") errors.push(`Colour space is ${video.colorSpace}, expected bt709.`);

  const hasAudio = (meta.channels ?? 0) > 0;
  if (expected.expectAudio && !hasAudio) errors.push("Expected an audio stream, but none was found.");

  if (errors.length > 0) {
    throw new RenderError(`Render output validation failed:\n${errors.join("\n")}`, { outputPath, errors });
  }

  return {
    valid: true,
    errors: [],
    outputPath,
    fileSizeBytes: stat.size,
    durationSeconds: meta.durationSeconds ?? 0,
    frames: video.frames,
    width: expected.width,
    height: expected.height,
    hasAudio,
    codec: meta.codec ?? "unknown",
    pixelFormat: video.pixelFormat,
    colorSpace: video.colorSpace,
  };
}
