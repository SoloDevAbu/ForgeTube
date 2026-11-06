import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { loadToolConfig, runCliCommand } from "../../providers/cliAdapter.js";
import { ProviderError, ValidationError } from "../../../shared/errors.js";
import { REPO_ROOT } from "../../../shared/paths.js";
import { decodeMono, SAMPLE_RATE } from "../pcm.js";
import type { VoiceSettings } from "../../schemas/project.js";
import type { VoiceWord } from "./voiceTake.js";

export interface SpeechResult {
  samples: Float32Array;
  words: VoiceWord[];
}

const EDGE_ATTEMPTS = 3;
const EDGE_TIMEOUT_MS = 120_000;

/** Online. Sends the text to Microsoft and returns audio with word timings. */
async function speakEdge(text: string, settings: VoiceSettings): Promise<SpeechResult> {
  const { python } = await loadToolConfig();
  if (!python) {
    throw new ValidationError("Python not found. Set python in forgetube.config.json. Run: video-studio doctor");
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "forgetube-tts-"));
  try {
    const textFile = path.join(dir, "text.txt");
    const mp3 = path.join(dir, "speech.mp3");
    const wordsFile = path.join(dir, "words.json");
    await fs.writeFile(textFile, text, "utf-8");

    let lastError = "";
    for (let attempt = 1; attempt <= EDGE_ATTEMPTS; attempt++) {
      const result = await runCliCommand(
        python,
        [
          path.join(REPO_ROOT, "tools", "edge_tts_words.py"),
          textFile,
          settings.voice,
          settings.rate,
          settings.pitch,
          mp3,
          wordsFile,
        ],
        { timeoutMs: EDGE_TIMEOUT_MS }
      );
      if (result.exitCode === 0) {
        const words = JSON.parse(await fs.readFile(wordsFile, "utf-8")) as VoiceWord[];
        return { samples: await decodeMono(mp3), words };
      }
      lastError = result.stderr.slice(-400);
    }
    throw new ProviderError(`Edge TTS failed after ${EDGE_ATTEMPTS} attempts: ${lastError}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Offline fallback. No word timings, so shots split by word count. */
async function speakKokoro(text: string, settings: VoiceSettings): Promise<SpeechResult> {
  let KokoroTTS: any;
  try {
    const moduleName = "kokoro-js";
    ({ KokoroTTS } = await import(moduleName));
  } catch {
    throw new ValidationError("Kokoro is not installed. Run: bun add kokoro-js");
  }

  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8" });
  const audio = await tts.generate(text, { voice: settings.voice });
  const wav = path.join(os.tmpdir(), `forgetube-kokoro-${crypto.randomUUID()}.wav`);
  await audio.save(wav);
  try {
    return { samples: await decodeMono(wav), words: [] };
  } finally {
    await fs.rm(wav, { force: true });
  }
}

export function speak(text: string, settings: VoiceSettings): Promise<SpeechResult> {
  return settings.provider === "kokoro" ? speakKokoro(text, settings) : speakEdge(text, settings);
}

export const TTS_SAMPLE_RATE = SAMPLE_RATE;
