import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";

/**
 * Creates a valid test PNG image using ffmpeg.
 */
export async function createTestImage(
  outputPath: string,
  width = 1920,
  height = 1080,
  color = "blue"
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=${width}x${height}:d=1`,
      "-frames:v",
      "1",
      "-update",
      "1",
      outputPath,
    ];
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Failed to generate test image, code ${code}`));
    });
    child.on("error", reject);
  });
}

/**
 * Creates a valid test WAV audio file using ffmpeg (sine tone).
 */
export async function createTestAudio(
  outputPath: string,
  durationSeconds = 3.0,
  frequency = 440
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:duration=${durationSeconds}`,
      "-c:a",
      "pcm_s16le",
      outputPath,
    ];
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Failed to generate test audio, code ${code}`));
    });
    child.on("error", reject);
  });
}

