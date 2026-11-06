import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { inspectMedia } from "../assets/mediaInspector.js";
import type { RenderManifest } from "../schemas/renderManifest.js";
import { RenderError } from "../../shared/errors.js";

export interface RenderValidationResult {
  valid: boolean;
  errors: string[];
  outputPath: string;
  fileSizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
  codec: string;
}

/**
 * Validates a rendered video file against the compiled render manifest using FFprobe.
 */
export async function validateRenderOutput(
  outputPath: string,
  manifest: RenderManifest,
  toleranceSeconds = 1.0
): Promise<RenderValidationResult> {
  if (!existsSync(outputPath)) {
    throw new RenderError(`Rendered output file does not exist at ${outputPath}`);
  }

  const stat = await fs.stat(outputPath);
  if (stat.size === 0) {
    throw new RenderError(`Rendered output file is empty (0 bytes): ${outputPath}`);
  }

  const meta = await inspectMedia(outputPath);
  const errors: string[] = [];

  // 1. Duration check
  if (!meta.durationSeconds || meta.durationSeconds <= 0) {
    errors.push("Rendered video duration could not be determined by ffprobe.");
  } else {
    const diff = Math.abs(meta.durationSeconds - manifest.totalDurationSeconds);
    if (diff > toleranceSeconds) {
      errors.push(
        `Rendered duration (${meta.durationSeconds}s) differs from compiled duration (${manifest.totalDurationSeconds}s) by more than tolerance (${toleranceSeconds}s).`
      );
    }
  }

  // 2. Resolution check
  if (meta.width !== manifest.width || meta.height !== manifest.height) {
    errors.push(
      `Rendered resolution (${meta.width}x${meta.height}) does not match manifest resolution (${manifest.width}x${manifest.height}).`
    );
  }

  // 3. Audio stream check if audio events exist
  const expectedAudio =
    (manifest.audio.voiceTracks && manifest.audio.voiceTracks.length > 0) ||
    (manifest.audio.soundEffects && manifest.audio.soundEffects.length > 0) ||
    (manifest.audio.musicBeds && manifest.audio.musicBeds.length > 0);

  const hasAudio = (meta.channels && meta.channels > 0) || false;
  if (expectedAudio && !hasAudio) {
    errors.push("Expected audio streams in output, but ffprobe detected no audio channels.");
  }

  if (errors.length > 0) {
    throw new RenderError(`Render output validation failed:\n${errors.join("\n")}`, {
      outputPath,
      errors,
    });
  }

  return {
    valid: true,
    errors: [],
    outputPath,
    fileSizeBytes: stat.size,
    durationSeconds: meta.durationSeconds ?? 0,
    width: meta.width ?? manifest.width,
    height: meta.height ?? manifest.height,
    hasAudio,
    codec: meta.codec ?? "unknown",
  };
}

