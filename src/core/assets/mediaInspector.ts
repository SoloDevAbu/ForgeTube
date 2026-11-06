import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { AssetError } from "../../shared/errors.js";

export interface MediaMetadata {
  format: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  sampleRate?: number;
  channels?: number;
  codec?: string;
  fileSizeBytes: number;
  checksum: string;
}

/**
 * Computes SHA-256 checksum of a file.
 */
export async function computeFileChecksum(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Runs ffprobe on a media file to inspect technical streams and format metadata.
 */
export async function inspectMedia(filePath: string): Promise<MediaMetadata> {
  const stat = await fs.stat(filePath);
  const checksum = await computeFileChecksum(filePath);

  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height,codec_name,sample_rate,channels:format=format_name,duration,size",
      "-of",
      "json",
      filePath,
    ];

    const child = spawn("ffprobe", args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err) => {
      reject(new AssetError(`Failed to run ffprobe: ${err.message}`, { filePath, err }));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        return reject(
          new AssetError(`ffprobe failed with exit code ${code} for file ${filePath}: ${stderr}`, {
            filePath,
            stderr,
          })
        );
      }

      try {
        const parsed = JSON.parse(stdout);
        const formatInfo = parsed.format || {};
        const streams = parsed.streams || [];
        const videoStream = streams.find((s: any) => s.codec_type === "video" || s.width || s.height) || {};
        const audioStream = streams.find((s: any) => s.codec_type === "audio" || s.channels || s.sample_rate) || {};

        const duration = formatInfo.duration ? parseFloat(formatInfo.duration) : undefined;
        const width = videoStream.width ? parseInt(videoStream.width, 10) : undefined;
        const height = videoStream.height ? parseInt(videoStream.height, 10) : undefined;
        const sampleRate = audioStream.sample_rate ? parseInt(audioStream.sample_rate, 10) : undefined;
        const channels = audioStream.channels ? parseInt(audioStream.channels, 10) : undefined;
        const codec = videoStream.codec_name || audioStream.codec_name;
        const format = formatInfo.format_name || "unknown";

        resolve({
          format,
          width,
          height,
          durationSeconds: duration && !isNaN(duration) ? duration : undefined,
          sampleRate,
          channels,
          codec,
          fileSizeBytes: stat.size,
          checksum,
        });
      } catch (err: any) {
        reject(
          new AssetError(`Failed to parse ffprobe output: ${err.message}`, {
            filePath,
            stdout,
          })
        );
      }
    });
  });
}

