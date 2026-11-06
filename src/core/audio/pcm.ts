import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { AssetError } from "../../shared/errors.js";

export const SAMPLE_RATE = 48_000;

/** Decodes any audio file to mono 32-bit float samples. */
export function decodeMono(file: string, sampleRate = SAMPLE_RATE): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      ["-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", String(sampleRate), "pipe:1"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf-8")));
    child.on("error", (err) => reject(new AssetError(`Failed to spawn ffmpeg: ${err.message}`)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new AssetError(`Could not decode ${file}: ${stderr.slice(-400)}`));
      const buffer = Buffer.concat(chunks);
      // Copy, because the concatenated buffer may not be 4-byte aligned.
      const samples = new Float32Array(buffer.length / 4);
      Buffer.from(samples.buffer).set(buffer.subarray(0, samples.length * 4));
      resolve(samples);
    });
  });
}

/** Writes a mono 32-bit float WAV. */
export async function writeWavMono(file: string, samples: Float32Array, sampleRate = SAMPLE_RATE): Promise<void> {
  const dataBytes = samples.length * 4;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVEfmt ", 8, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(dataBytes, 40);

  await fs.mkdir(path.dirname(file), { recursive: true });
  const body = Buffer.from(samples.buffer, samples.byteOffset, dataBytes);
  await fs.writeFile(file, Buffer.concat([header, body]));
}

/** Adds samples into a stem, ignoring anything past its end. */
export function mixInto(stem: Float32Array, samples: Float32Array, offset: number, gain = 1): void {
  const end = Math.min(stem.length, offset + samples.length);
  for (let i = Math.max(0, offset); i < end; i++) stem[i]! += samples[i - offset]! * gain;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
